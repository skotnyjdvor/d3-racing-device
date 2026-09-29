// Public pages live on real paths so search engines can index them; the signed-in app views
// (#analysis, #logs, #ai, #profile) stay on hashes under "/".
export const PAGE_PATHS = { features: "/features", shop: "/shop", contact: "/contact" };
const PATH_PAGES = Object.fromEntries(Object.entries(PAGE_PATHS).map(([page, path]) => [path, page]));

export const currentPage = () => PATH_PAGES[location.pathname.replace(/\/+$/, "")] ?? null;

// Old links (/#features, /#shop, /#contact) move to their real paths without a reload.
export function upgradeLegacyHash() {
  const page = location.hash.slice(1);
  if (!PAGE_PATHS[page] || currentPage()) return false;
  history.replaceState(null, "", PAGE_PATHS[page] + location.search);
  return true;
}

export function navigate(url, { replace = false } = {}) {
  if (url === location.pathname + location.search + location.hash) return;
  history[replace ? "replaceState" : "pushState"](null, "", url);
  window.dispatchEvent(new Event("routechange"));
}

// Same-document links to "/", "/features" … are handled here instead of reloading the page.
export function interceptLinks() {
  document.addEventListener("click", (event) => {
    const link = event.target.closest?.("a[href^='/']");
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target) return;
    const url = new URL(link.href);
    if (url.origin !== location.origin || !(url.pathname === "/" || PATH_PAGES[url.pathname])) return;
    event.preventDefault();
    navigate(url.pathname + url.hash);
  });
}
