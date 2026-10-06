import { createShare, loadShares, revokeShare } from "./cloud/api.js";
import { getLanguage, onLanguageChange, t } from "./i18n.js";

// Share dialog: create read-only links to one cloud session, copy or send them, revoke them.
const $ = (id) => document.getElementById(id);
let session = null;
let shares = [];
let busy = false;
let defaultName = "";

const formatDate = (iso) => new Intl.DateTimeFormat(getLanguage(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

function setStatus(message = "", error = false) {
  $("shareStatus").textContent = message;
  $("shareStatus").classList.toggle("error", error);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    // Older browsers and non-secure contexts: fall back to selecting the field text.
    const field = document.createElement("textarea");
    field.value = text; field.setAttribute("readonly", ""); field.style.position = "fixed"; field.style.opacity = "0";
    document.body.append(field); field.select();
    const ok = document.execCommand?.("copy") ?? false;
    field.remove();
    return ok;
  }
}

function renderList() {
  const list = $("shareList");
  $("shareListTitle").hidden = !shares.length;
  if (!shares.length) { list.innerHTML = `<li class="share-empty">${t("share.empty")}</li>`; return; }
  const canSend = typeof navigator.share === "function";
  list.innerHTML = shares.map((share) => `<li class="share-item" data-share-id="${share.id}">
    <div class="share-item-head"><strong></strong><span>${formatDate(share.createdAt)}</span></div>
    <input class="share-url" type="text" readonly value="" aria-label="${t("share.linkLabel")}" />
    <div class="share-item-actions">
      <button class="secondary" type="button" data-share-copy>${t("share.copyLink")}</button>
      ${canSend ? `<button class="secondary" type="button" data-share-send>${t("share.send")}</button>` : ""}
      <button class="share-revoke" type="button" data-share-revoke>${t("share.revoke")}</button>
    </div>
  </li>`).join("");
  // Names and URLs are set as properties, never as HTML.
  list.querySelectorAll(".share-item").forEach((item) => {
    const share = shares.find((entry) => entry.id === item.dataset.shareId);
    item.querySelector("strong").textContent = share.pilotName;
    item.querySelector(".share-url").value = share.url;
  });
}

async function refresh() {
  if (!session?.cloudId) return;
  try { shares = (await loadShares(session.cloudId)).shares; setStatus(); }
  catch (error) { shares = []; setStatus(error.message, true); }
  renderList();
}

async function create(event) {
  event.preventDefault();
  if (busy || !session?.cloudId) return;
  busy = true;
  $("shareCreateButton").disabled = true;
  setStatus();
  try {
    const { share } = await createShare(session.cloudId, $("sharePilotName").value.trim());
    shares = [share, ...shares];
    renderList();
    setStatus(t((await copyText(share.url)) ? "share.createdCopied" : "share.created"));
    $("shareList").querySelector(".share-url")?.select();
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    busy = false;
    $("shareCreateButton").disabled = false;
  }
}

async function onListClick(event) {
  const item = event.target.closest(".share-item");
  const share = item && shares.find((entry) => entry.id === item.dataset.shareId);
  if (!share) return;
  if (event.target.closest("[data-share-copy]")) {
    setStatus(t((await copyText(share.url)) ? "share.copied" : "share.copyFailed"), false);
  } else if (event.target.closest("[data-share-send]")) {
    try { await navigator.share({ title: "D3CF", text: t("share.sendText", { name: share.pilotName }), url: share.url }); }
    catch { /* dismissed */ }
  } else if (event.target.closest("[data-share-revoke]")) {
    try { await revokeShare(share.id); shares = shares.filter((entry) => entry.id !== share.id); renderList(); setStatus(t("share.revoked")); }
    catch (error) { setStatus(error.message, true); }
  }
}

export function openShareDialog(selected, email = "") {
  if (!selected?.cloudId) return;
  session = selected;
  shares = [];
  defaultName = String(email).split("@")[0].slice(0, 40);
  $("sharePilotName").value = defaultName;
  setStatus();
  renderList();
  $("shareDialog").showModal();
  void refresh();
}

export function initShare() {
  $("shareForm").addEventListener("submit", create);
  $("shareList").addEventListener("click", onListClick);
  $("shareClose").addEventListener("click", () => $("shareDialog").close());
  $("shareDialog").addEventListener("click", (event) => { if (event.target === $("shareDialog")) $("shareDialog").close(); });
  onLanguageChange(() => { if ($("shareDialog").open) renderList(); });
}
