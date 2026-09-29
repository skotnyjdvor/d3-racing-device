import { loadShopConfig, placeOrder } from "./cloud/api.js";
import { getLanguage, onLanguageChange, t } from "./i18n.js";

// Shop page: pre-order form. Everything payment related is a stub until a provider is connected.
const $ = (id) => document.getElementById(id);
const fieldIds = ["shopName", "shopEmail", "shopPhone", "shopCountry", "shopAddress", "shopNote"];
let config = { priceCents: null, currency: "EUR", maxQuantity: 10, paymentsEnabled: false };
let configPromise = null;
let quantity = 1;
let sending = false;
let placed = null;
let user = null;

const money = (cents) => new Intl.NumberFormat(getLanguage(), { style: "currency", currency: config.currency }).format(cents / 100);
const validEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

function renderPrice() {
  const unit = config.priceCents;
  $("shopPriceValue").textContent = unit ? money(unit) : t("shop.priceSoon");
  $("shopTotalValue").textContent = unit ? money(unit * quantity) : t("shop.totalSoon");
  $("shopQtyValue").textContent = String(quantity);
  $("shopQtyLess").disabled = quantity <= 1;
  $("shopQtyMore").disabled = quantity >= config.maxQuantity;
  $("shopQtyLess").setAttribute("aria-label", t("shop.qtyLess"));
  $("shopQtyMore").setAttribute("aria-label", t("shop.qtyMore"));
}

function renderDone() {
  const done = $("shopDone");
  done.hidden = !placed;
  $("shopForm").hidden = Boolean(placed);
  if (!placed) return;
  $("shopNumber").textContent = placed.number;
  $("shopDoneText").textContent = t("shop.doneText", { email: placed.email });
}

function setStatus(message = "", error = false) {
  $("shopStatus").textContent = message;
  $("shopStatus").classList.toggle("error", error);
}

function clearInvalid() {
  fieldIds.forEach((id) => $(id).removeAttribute("aria-invalid"));
  $("shopConsent").closest(".shop-consent").classList.remove("invalid");
}

function validate(data) {
  const bad = [];
  if (data.name.length < 2) bad.push("shopName");
  if (!validEmail(data.email)) bad.push("shopEmail");
  if (data.country.length < 2) bad.push("shopCountry");
  if (data.address.length < 5) bad.push("shopAddress");
  return bad;
}

async function submit(event) {
  event.preventDefault();
  if (sending) return;
  clearInvalid();
  const data = {
    name: $("shopName").value.trim(), email: $("shopEmail").value.trim(), phone: $("shopPhone").value.trim(),
    country: $("shopCountry").value.trim(), address: $("shopAddress").value.trim(), note: $("shopNote").value.trim(),
    quantity, consent: $("shopConsent").checked, website: $("shopTrap").value, language: getLanguage(),
  };
  const bad = validate(data);
  if (bad.length) {
    bad.forEach((id) => $(id).setAttribute("aria-invalid", "true"));
    $(bad[0]).focus();
    setStatus(t("shop.invalid"), true);
    return;
  }
  if (!data.consent) {
    $("shopConsent").closest(".shop-consent").classList.add("invalid");
    $("shopConsent").focus();
    setStatus(t("shop.needConsent"), true);
    return;
  }
  sending = true;
  $("shopSubmit").disabled = true;
  $("shopSubmit").textContent = t("shop.sending");
  setStatus();
  try {
    const result = await placeOrder(data);
    // Once a payment provider is connected the API returns a hosted checkout URL; today it is always empty.
    if (result.payment?.url) { location.assign(result.payment.url); return; }
    placed = { number: result.order.number, email: data.email };
    renderDone();
    window.scrollTo({ top: 0 });
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    sending = false;
    $("shopSubmit").disabled = false;
    $("shopSubmit").textContent = t("shop.submit");
  }
}

function reset() {
  placed = null;
  quantity = 1;
  ["shopPhone", "shopAddress", "shopNote"].forEach((id) => { $(id).value = ""; });
  $("shopConsent").checked = false;
  setStatus();
  renderPrice();
  renderDone();
}

export function setShopUser(next) {
  user = next;
  if (user && !$("shopEmail").value) $("shopEmail").value = user.email;
}

// The config (price, limits, whether payments are on) is fetched the first time the shop is opened.
export function onShopShown() {
  configPromise ??= loadShopConfig()
    .then((loaded) => { config = { ...config, ...loaded }; quantity = Math.min(quantity, config.maxQuantity); renderPrice(); })
    .catch(() => {});
  renderPrice();
}

export function initShop() {
  $("shopQtyLess").addEventListener("click", () => { quantity = Math.max(1, quantity - 1); renderPrice(); });
  $("shopQtyMore").addEventListener("click", () => { quantity = Math.min(config.maxQuantity, quantity + 1); renderPrice(); });
  $("shopForm").addEventListener("submit", submit);
  fieldIds.forEach((id) => $(id).addEventListener("input", () => $(id).removeAttribute("aria-invalid")));
  $("shopConsent").addEventListener("change", () => $("shopConsent").closest(".shop-consent").classList.remove("invalid"));
  $("shopAgain").addEventListener("click", reset);
  onLanguageChange(() => { renderPrice(); renderDone(); });
  renderPrice();
}
