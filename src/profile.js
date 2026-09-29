import { changePassword, deleteAccount, loadProfile, resendVerification, signOut } from "./cloud/api.js";
import { getLanguage, onLanguageChange, t } from "./i18n.js";

// Account profile page: summary, activity counters, orders, password change and account deletion.
const $ = (id) => document.getElementById(id);
let user = null;
let data = null;
let loading = null;
let callbacks = {};

const formatDate = (iso) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(getLanguage(), { dateStyle: "medium" }).format(date);
};

function setStatus(id, message = "", error = false) {
  $(id).textContent = message;
  $(id).classList.toggle("error", error);
}

function renderUser() {
  const email = user?.email ?? "";
  $("profileAvatar").textContent = email ? email[0] : "?";
  $("profileEmail").textContent = email;
  $("profileFactEmail").textContent = email || "—";
  const verified = user?.emailVerified !== false;
  $("profileVerified").textContent = t(verified ? "profile.verified" : "profile.unverified");
  $("profileVerified").classList.toggle("pending", !verified);
  $("profileVerifyNotice").hidden = !user || verified;
  $("profileSince").textContent = user?.createdAt ? formatDate(user.createdAt) : "—";
}

function renderData() {
  const stats = data?.stats;
  $("profileStatLogs").textContent = stats ? String(stats.logs) : "—";
  $("profileStatReports").textContent = stats ? String(stats.aiReports) : "—";
  $("profileStatOrders").textContent = stats ? String(stats.orders) : "—";
  const orders = data?.orders ?? [];
  $("profileOrderList").innerHTML = orders.map((order) => {
    const status = ["preorder", "awaiting_payment", "paid", "shipped", "cancelled"].includes(order.status) ? order.status : "preorder";
    return `<li><b>${order.number}</b><span>${order.quantity} × LapTrace · ${formatDate(order.createdAt)}</span><em class="${status}">${t(`profile.status.${status}`)}</em></li>`;
  }).join("");
  $("profileOrdersEmpty").hidden = !data || orders.length > 0;
}

export function setProfileUser(next) {
  user = next;
  if (!user) { data = null; renderData(); }
  renderUser();
}

export function onProfileShown() {
  document.title = t("profile.metaTitle");
  renderUser();
  renderData();
  const request = loading = loadProfile();
  request.then((loaded) => {
    if (request !== loading) return;
    data = loaded;
    if (loaded.user) user = { ...user, ...loaded.user };
    renderUser(); renderData();
    setStatus("profileAccountStatus");
  }).catch((error) => {
    if (request === loading) setStatus("profileAccountStatus", error.message || t("profile.loadError"), true);
  });
}

async function submitPassword(event) {
  event.preventDefault();
  const current = $("profileCurrentPassword").value;
  const next = $("profileNewPassword").value;
  const repeat = $("profileRepeatPassword").value;
  ["profileCurrentPassword", "profileNewPassword", "profileRepeatPassword"].forEach((id) => $(id).removeAttribute("aria-invalid"));
  const fail = (id, message) => { $(id).setAttribute("aria-invalid", "true"); $(id).focus(); setStatus("profilePasswordStatus", message, true); };
  if (!current) return fail("profileCurrentPassword", t("profile.currentPassword"));
  if (next.length < 8) return fail("profileNewPassword", t("profile.passwordShort"));
  if (next !== repeat) return fail("profileRepeatPassword", t("account.passwordMismatch"));
  $("profilePasswordSubmit").disabled = true;
  setStatus("profilePasswordStatus");
  try {
    const updated = await changePassword(current, next);
    if (updated) await callbacks.onPasswordChanged?.(updated);
    $("profilePasswordForm").reset();
    setStatus("profilePasswordStatus", t("profile.passwordChanged"));
  } catch (error) {
    setStatus("profilePasswordStatus", error.message, true);
  } finally {
    $("profilePasswordSubmit").disabled = false;
  }
}

async function resend() {
  $("profileResendButton").disabled = true;
  try {
    await resendVerification(getLanguage());
    setStatus("profileAccountStatus", t("account.verifySent"));
  } catch (error) {
    setStatus("profileAccountStatus", error.message, true);
  } finally {
    $("profileResendButton").disabled = false;
  }
}

async function removeAccount() {
  const password = await callbacks.askDialog({
    title: t("profile.deleteTitle"), message: t("profile.deleteConfirm"), confirmLabel: t("profile.deleteButton"), danger: true,
    input: { label: t("profile.deletePassword"), value: "", type: "password" },
  });
  if (!password) return;
  setStatus("profileDeleteStatus");
  try {
    await deleteAccount(password);
    await callbacks.onSignedOut();
  } catch (error) {
    setStatus("profileDeleteStatus", error.message, true);
  }
}

export function initProfile(options) {
  callbacks = options;
  $("profilePasswordForm").addEventListener("submit", submitPassword);
  $("profileResendButton").addEventListener("click", resend);
  $("profileDeleteButton").addEventListener("click", removeAccount);
  $("profileSignOutButton").addEventListener("click", async () => { await signOut(); await callbacks.onSignedOut(); });
  onLanguageChange(() => { renderUser(); renderData(); if (document.body.classList.contains("view-profile")) document.title = t("profile.metaTitle"); });
  renderUser();
}
