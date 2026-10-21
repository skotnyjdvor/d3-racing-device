// Account dialog (sign in, register, password recovery), links from emails and friend invites, and the
// guest trial that analyses a CSV without an account.
import { cloudConfigured, renameLog, requestPasswordReset, resendVerification, resetPassword, saveLog, signIn, signOut, signUp, verifyEmail } from "./cloud/api.js";
import { parseRaceBoxCsv } from "./domain/csv.js";
import { getLanguage } from "./i18n.js";
import { acceptInviteFlow } from "./stats.js";

export function createAccount(ctx) {
  const {
    state, elements, t, testMode, appMode, showView, applyUser, renderSessions, selectSession,
  } = ctx;
  let accountMode = "signin";

  function setAccountMessage(message = "", error = false) {
    elements.accountMessage.textContent = message;
    elements.accountMessage.classList.toggle("error", error);
  }

  // A guest who opened a shared link sees the app (read-only) without an account, like in the CSV trial.
  function viewingShared() { return state.sessions.some((session) => session.source === "shared"); }
  function updateAccess() {
    const unlocked = Boolean(state.user) || testMode || (!appMode && (state.trial || viewingShared()));
    document.body.classList.toggle("auth-locked", !unlocked);
    elements.authGate.hidden = unlocked;
    renderTrialBanner();
  }

  function renderTrialBanner() {
    const guest = !state.user && (state.trial || viewingShared());
    elements.trialBanner.hidden = !guest;
    if (!guest) return;
    const shared = state.selectedSession?.source === "shared" && state.rival;
    elements.trialBannerTitle.textContent = shared ? t("share.bannerTitle", { name: state.rival.name }) : t("trial.bannerTitle");
    elements.trialBannerText.textContent = t(shared ? "share.bannerText" : "trial.bannerText");
    elements.trialUploadButton.hidden = !shared;
  }

  // Guest trial: a CSV is parsed in the browser and analysed without an account; nothing leaves the device
  // until the visitor registers, at which point the log is saved to the new account.
  const TRIAL_MAX_BYTES = 60 * 1024 * 1024;
  function setTrialStatus(message = "", error = false) {
    for (const status of [elements.trialStatus, elements.appTrialStatus]) {
      status.textContent = message;
      status.classList.toggle("error", error);
    }
  }

  async function startTrial(file) {
    if (!file) return;
    if (!/\.csv$/i.test(file.name) && file.type !== "text/csv") return setTrialStatus(t("trial.notCsv"), true);
    if (file.size > TRIAL_MAX_BYTES) return setTrialStatus(t("trial.tooLarge"), true);
    setTrialStatus(t("trial.reading"));
    elements.trialButton.disabled = true;
    try {
      const points = parseRaceBoxCsv(await file.text());
      if (!points.length) throw new Error("empty log");
      const session = { id: `trial-${Date.now()}`, title: file.name.replace(/\.csv$/i, "").slice(0, 100) || t("trial.bannerTitle"), source: "trial", deviceName: "LapTrace", startedAt: points[0].time, endedAt: points.at(-1).time, points };
      state.trial = true;
      state.sessions = [session, ...state.sessions.filter((item) => item.source !== "trial")];
      updateAccess();
      renderSessions();
      if (!await selectSession(session.id)) throw new Error("selection failed");
      showView("analysis");
      window.scrollTo(0, 0);
      setTrialStatus();
    } catch {
      endTrial();
      setTrialStatus(t("trial.error"), true);
    } finally {
      elements.trialButton.disabled = false;
      elements.trialInput.value = "";
    }
  }

  function endTrial() {
    state.trial = false;
    state.sessions = state.sessions.filter((session) => session.source !== "trial" && session.source !== "shared");
    state.rival = null; state.comparisonRival = false; state.comparisonSource = null;
    if (state.selectedSession?.source === "trial" || state.selectedSession?.source === "shared") { state.selectedSession = null; state.analysis = null; state.sectors = null; }
    updateAccess();
    renderSessions();
  }

  // Called right after sign-up/sign-in: the visitor asked to keep the trial log, so it goes to their account.
  async function saveTrialLogs() {
    const sessions = state.sessions.filter((session) => session.source === "trial" && !session.cloudId);
    state.trial = false;
    if (!sessions.length || !state.user) return;
    try {
      for (const session of sessions) {
        session.cloudId = await saveLog(session, "LapTrace");
        if (session.cloudId) await renameLog(session.cloudId, session.title);
      }
      if (sessions.includes(state.selectedSession)) {
        elements.analyzeAiButton.disabled = !state.analysis?.laps.length;
        elements.copyStatus.textContent = t("ai.ready");
      }
      setAccountMessage(t("trial.saved"));
    } catch (error) { setAccountMessage(error.message, true); }
  }

  const ACCOUNT_MODES = {
    signin: { title: "account.title", copy: "account.copy", submit: "account.signIn" },
    register: { title: "account.registerTitle", copy: "account.registerCopy", submit: "account.create" },
    forgot: { title: "account.forgotTitle", copy: "account.forgotCopy", submit: "account.sendLink" },
    reset: { title: "account.resetTitle", copy: "account.resetCopy", submit: "account.savePassword" },
  };
  let resetToken = "";

  function setAccountMode(mode) {
    accountMode = ACCOUNT_MODES[mode] ? mode : "signin";
    const registering = accountMode === "register";
    const recovering = accountMode === "forgot" || accountMode === "reset";
    const labels = ACCOUNT_MODES[accountMode];
    elements.accountSignInTab.parentElement.hidden = recovering;
    elements.accountSignInTab.classList.toggle("active", accountMode === "signin");
    elements.accountRegisterTab.classList.toggle("active", registering);
    elements.accountSignInTab.setAttribute("aria-selected", String(accountMode === "signin"));
    elements.accountRegisterTab.setAttribute("aria-selected", String(registering));
    elements.accountEmail.closest("label").hidden = accountMode === "reset";
    elements.accountEmail.required = accountMode !== "reset";
    elements.accountPassword.closest("label").hidden = accountMode === "forgot";
    elements.accountPassword.required = accountMode !== "forgot";
    elements.accountConfirmLabel.hidden = !(registering || accountMode === "reset");
    elements.accountPasswordConfirm.required = registering || accountMode === "reset";
    elements.accountPassword.autocomplete = accountMode === "signin" ? "current-password" : "new-password";
    elements.accountForgotButton.hidden = accountMode !== "signin";
    elements.accountBackButton.hidden = !recovering;
    elements.accountDialogTitle.textContent = t(labels.title);
    elements.accountDialogCopy.textContent = t(labels.copy);
    elements.accountSubmitButton.textContent = t(labels.submit);
    elements.accountPassword.classList.remove("invalid");
    elements.accountPasswordConfirm.classList.remove("invalid");
    elements.accountPasswordConfirm.setCustomValidity("");
    setAccountMessage("");
  }

  function openAccountDialog(mode = "signin") {
    renderAccount();
    if (!state.user) setAccountMode(mode);
    elements.accountDialog.showModal();
  }

  function renderAccount() {
    const email = state.user?.email ?? "";
    elements.accountGuest.hidden = Boolean(state.user);
    elements.accountMember.hidden = !state.user;
    elements.accountLabel.textContent = email || t("account.signIn");
    elements.accountAvatar.textContent = email ? email[0] : "?";
    elements.accountUserEmail.textContent = email;
    elements.cloudLogStatus.textContent = state.user ? t("account.logs", { count: state.cloudLogs.length }) : "";
    elements.accountVerifyNotice.hidden = !state.user || state.user.emailVerified !== false;
    if (!cloudConfigured) {
      setAccountMessage(t("account.notConfigured"), true);
      elements.accountForm.querySelectorAll("input, button").forEach((element) => { element.disabled = true; });
    }
    updateAccess();
  }

  async function submitAccount(action) {
    const email = elements.accountEmail.value.trim();
    const password = elements.accountPassword.value;
    if (accountMode === "forgot") return submitPasswordResetRequest(email);
    if ((accountMode === "register" || accountMode === "reset") && password !== elements.accountPasswordConfirm.value) {
      elements.accountPassword.classList.add("invalid");
      elements.accountPasswordConfirm.classList.add("invalid");
      elements.accountPasswordConfirm.setCustomValidity(t("account.passwordMismatch"));
      elements.accountPasswordConfirm.reportValidity();
      setAccountMessage(t("account.passwordMismatch"), true);
      return;
    }
    setAccountMessage("");
    elements.accountSubmitButton.disabled = true;
    elements.accountSubmitButton.textContent = t("account.working");
    try {
      const user = accountMode === "reset" ? await resetPassword(resetToken, password)
        : accountMode === "register" ? await action(email, password, getLanguage())
        : await action(email, password);
      if (accountMode === "reset") { resetToken = ""; history.replaceState(null, "", location.pathname + location.search); }
      if (user) {
        await applyUser(user);
        elements.accountForm.reset();
        elements.accountDialog.close();
      }
      else setAccountMessage(t("account.confirm"));
    } catch (error) { setAccountMessage(error.message, true); }
    finally {
      elements.accountSubmitButton.disabled = false;
      elements.accountSubmitButton.textContent = t(ACCOUNT_MODES[accountMode].submit);
    }
  }

  async function submitPasswordResetRequest(email) {
    setAccountMessage("");
    elements.accountSubmitButton.disabled = true;
    elements.accountSubmitButton.textContent = t("account.working");
    try {
      await requestPasswordReset(email, getLanguage());
      setAccountMessage(t("account.linkSent"));
    } catch (error) { setAccountMessage(error.message, true); }
    finally {
      elements.accountSubmitButton.disabled = false;
      elements.accountSubmitButton.textContent = t(ACCOUNT_MODES[accountMode].submit);
    }
  }

  // Open "#friend=<token>": signed-out visitors sign in first (the token waits), then the invitation is confirmed.
  let pendingFriendToken = null;
  async function handleFriendLink() {
    const match = location.hash.match(/^#friend=([A-Za-z0-9_-]{32,64})$/);
    if (match) { pendingFriendToken = match[1]; history.replaceState(null, "", location.pathname + location.search + "#profile"); }
    if (!pendingFriendToken) return;
    if (!state.user) {
      if (!elements.accountDialog.open) openAccountDialog("signup");
      setAccountMessage(t("invite.signIn"));
      return;
    }
    const token = pendingFriendToken;
    pendingFriendToken = null;
    if (await acceptInviteFlow(token)) showView("profile", true);
  }

  async function handleAuthLink() {
    const match = location.hash.match(/^#(reset|verify)=([A-Za-z0-9_-]{32,128})$/);
    if (!match) return;
    const [, kind, token] = match;
    history.replaceState(null, "", location.pathname + location.search);
    if (kind === "reset") {
      resetToken = token;
      elements.accountForm.reset();
      renderAccount();
      elements.accountGuest.hidden = false;
      elements.accountMember.hidden = true;
      setAccountMode("reset");
      if (!elements.accountDialog.open) elements.accountDialog.showModal();
      return;
    }
    try {
      const user = await verifyEmail(token);
      if (state.user && state.user.id === user.id) { state.user = { ...state.user, emailVerified: true }; renderAccount(); }
      openAccountDialog("signin");
      setAccountMessage(t("account.verified"));
    } catch (error) {
      openAccountDialog("signin");
      setAccountMessage(error.message, true);
    }
  }

  elements.trialButton.addEventListener("click", () => elements.trialInput.click());
  elements.trialInput.addEventListener("change", () => startTrial(elements.trialInput.files?.[0]));
  elements.trialRegisterButton.addEventListener("click", () => openAccountDialog("register"));
  elements.trialUploadButton.addEventListener("click", () => elements.trialInput.click());
  // Dropping a CSV anywhere on the landing hero starts the trial too.
  {
    let depth = 0;
    const hero = elements.landingHero;
    const isFileDrag = (event) => [...(event.dataTransfer?.types || [])].includes("Files");
    hero.addEventListener("dragenter", (event) => { if (!isFileDrag(event)) return; depth += 1; hero.classList.add("dragging"); });
    hero.addEventListener("dragleave", () => { depth = Math.max(0, depth - 1); if (!depth) hero.classList.remove("dragging"); });
    hero.addEventListener("dragover", (event) => { if (isFileDrag(event)) event.preventDefault(); });
    hero.addEventListener("drop", (event) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      depth = 0; hero.classList.remove("dragging");
      void startTrial(event.dataTransfer.files?.[0]);
    });
  }
  elements.accountButton.addEventListener("click", () => (state.user ? showView("profile") : openAccountDialog("signin")));
  elements.gateAccountButton.addEventListener("click", () => openAccountDialog("register"));
  elements.demoAccountButton.addEventListener("click", () => openAccountDialog("register"));
  elements.aiSampleAccountButton.addEventListener("click", () => openAccountDialog("register"));
  elements.accountSignInTab.addEventListener("click", () => setAccountMode("signin"));
  elements.accountRegisterTab.addEventListener("click", () => setAccountMode("register"));
  elements.accountForgotButton.addEventListener("click", () => setAccountMode("forgot"));
  elements.accountBackButton.addEventListener("click", () => { resetToken = ""; setAccountMode("signin"); });
  elements.accountResendButton.addEventListener("click", async () => {
    elements.accountResendButton.disabled = true;
    try {
      const result = await resendVerification(getLanguage());
      if (result.alreadyVerified) { state.user = { ...state.user, emailVerified: true }; renderAccount(); setAccountMessage(t("account.verified")); }
      else setAccountMessage(t("account.verifySent"));
    } catch (error) { setAccountMessage(error.message, true); }
    finally { elements.accountResendButton.disabled = false; }
  });
  elements.accountPasswordConfirm.addEventListener("input", () => {
    elements.accountPassword.classList.remove("invalid");
    elements.accountPasswordConfirm.classList.remove("invalid");
    elements.accountPasswordConfirm.setCustomValidity("");
  });
  elements.accountClose.addEventListener("click", () => elements.accountDialog.close());
  elements.accountDialog.addEventListener("click", (event) => { if (event.target === elements.accountDialog) elements.accountDialog.close(); });
  elements.accountForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitAccount(accountMode === "register" ? signUp : signIn);
  });
  elements.logoutButton.addEventListener("click", async () => { try { await signOut(); await applyUser(null); } catch (error) { setAccountMessage(error.message, true); } });

  return { setAccountMessage, updateAccess, renderTrialBanner, endTrial, saveTrialLogs, openAccountDialog, renderAccount, handleAuthLink, handleFriendLink, pendingFriendInvite: () => Boolean(pendingFriendToken) };
}
