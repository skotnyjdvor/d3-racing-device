// Runs before the page paints. Inside the native apps (Android/iOS via Capacitor, desktop via Electron)
// it switches the page to the telemetry-app layout (html.app-mode) instead of the website.
// Add ?app=1 to the URL to preview that layout in a browser.
(function () {
  var protocol = location.protocol;
  var capacitor = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
  var native = protocol === "capacitor:" || protocol === "ionic:" || protocol === "app:" || Boolean(capacitor);
  if (!native && !/[?&]app=1(&|$)/.test(location.search)) return;
  var root = document.documentElement;
  root.classList.add("app-mode");
  // Phones: draw under the status and navigation bars; the layout pads itself with env(safe-area-inset-*).
  var viewport = document.querySelector('meta[name="viewport"]');
  if (viewport && viewport.content.indexOf("viewport-fit") < 0) viewport.content += ",viewport-fit=cover";
})();
