// Animated telemetry in the landing page hero: a looping lap with clocks, pedals and speed.
export function startLandingTelemetry() {
  const sessionTime = document.getElementById("heroSessionTime");
  const lapTime = document.getElementById("heroLapTime");
  const throttle = document.getElementById("heroThrottle");
  const brake = document.getElementById("heroBrake");
  const speed = document.getElementById("heroSpeed");
  const lapNumber = document.getElementById("heroLapNumber");
  if (!sessionTime || !lapTime || !throttle || !brake || !speed) return;
  // One lap as [seconds, throttle %, brake %]; speed is integrated from the pedals in real time.
  const lapProfile = [
    [3.6, 100, 0], [1.1, 0, 92], [2.2, 35, 0], [1.4, 85, 0], [2.8, 100, 0], [.8, 0, 70], [1.9, 25, 0],
    [1.2, 70, 0], [2.4, 100, 0], [1.3, 0, 96], [2.6, 20, 0], [1.6, 80, 0], [3.4, 100, 0], [.9, 0, 64],
    [1.8, 40, 0], [2.2, 100, 0], [1, 0, 85], [2.3, 30, 0], [1.5, 90, 0], [4.2, 100, 0],
  ];
  const lapSeconds = lapProfile.reduce((total, [seconds]) => total + seconds, 0);
  const sessionOffsetMs = 12 * 60_000;
  const startedAt = performance.now();
  let lastFrame = startedAt;
  let speedKmh = 92;
  // Build text nodes once and only touch them when the visible value changes: no innerHTML or layout work per frame.
  const clock = (element) => {
    element.textContent = "";
    const main = document.createTextNode("00:00.");
    const millis = document.createElement("i");
    millis.textContent = "000";
    element.append(main, millis);
    let last = "";
    return (milliseconds) => {
      const whole = `${String(Math.floor(milliseconds / 60_000)).padStart(2, "0")}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, "0")}.`;
      if (whole !== last) { main.nodeValue = whole; last = whole; }
      millis.textContent = String(Math.floor(milliseconds % 1000)).padStart(3, "0");
    };
  };
  const channel = (element, suffix, maximum = 100) => {
    const row = element.closest(".race-channel");
    element.textContent = "";
    const value = document.createTextNode("0");
    const unit = document.createElement("i");
    unit.textContent = suffix;
    element.append(value, unit);
    let lastValue = -1;
    return (next, updateText) => {
      if (updateText && next !== lastValue) { value.nodeValue = String(next); lastValue = next; }
      row?.style.setProperty("--scale", Math.min(1, Math.max(.02, next / maximum)).toFixed(3));
    };
  };
  const setSessionClock = clock(sessionTime);
  const setLapClock = clock(lapTime);
  const setThrottle = channel(throttle, "%");
  const setBrake = channel(brake, "%");
  const setSpeed = channel(speed, "km/h", 130);
  let lastLapLabel = "";
  let lastTextPaint = 0;
  const pedalsAt = (lapPosition) => {
    let start = 0;
    for (let index = 0; index < lapProfile.length; index++) {
      const [seconds, throttleTarget, brakeTarget] = lapProfile[index];
      if (lapPosition < start + seconds) {
        const [, previousThrottle, previousBrake] = lapProfile[(index + lapProfile.length - 1) % lapProfile.length];
        const blend = Math.min(1, (lapPosition - start) / .18);
        return [previousThrottle + (throttleTarget - previousThrottle) * blend, previousBrake + (brakeTarget - previousBrake) * blend];
      }
      start += seconds;
    }
    return [lapProfile[0][1], lapProfile[0][2]];
  };
  const render = (now) => {
    const dt = Math.min(.1, (now - lastFrame) / 1000);
    lastFrame = now;
    const elapsedMs = now - startedAt;
    const lapPosition = (elapsedMs / 1000) % lapSeconds;
    const jitter = Math.sin(now / 37) * 1.5 + Math.sin(now / 13) * .8;
    const [throttleValue, brakeValue] = pedalsAt(lapPosition);
    const acceleration = throttleValue / 100 * 26 - brakeValue / 100 * 62 - speedKmh * speedKmh * .0011 - 1.5;
    speedKmh = Math.min(128, Math.max(38, speedKmh + acceleration * dt));
    const textFrame = now - lastTextPaint >= 32;
    if (textFrame) { lastTextPaint = now; setSessionClock(elapsedMs + sessionOffsetMs); setLapClock(lapPosition * 1000); }
    const lapLabel = `LAP_${String(3 + Math.floor(elapsedMs / 1000 / lapSeconds) % 10).padStart(2, "0")}`;
    if (lapNumber && lapLabel !== lastLapLabel) { lapNumber.textContent = lapLabel; lastLapLabel = lapLabel; }
    // Bars move every frame (compositor-only transform); digits refresh at ~30 fps to keep repaints cheap on phones.
    setThrottle(Math.round(Math.max(0, Math.min(100, throttleValue + (throttleValue > 5 && throttleValue < 100 ? jitter : 0)))), textFrame);
    setBrake(Math.round(Math.max(0, brakeValue + (brakeValue > 5 ? jitter : 0))), textFrame);
    setSpeed(Math.round(speedKmh), textFrame);
  };
  // The loop runs only while the live card is really on screen; otherwise it stops instead of spinning idle.
  const card = sessionTime.closest(".landing-hero")?.querySelector(".race-live-card") || document.querySelector(".race-live-card");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let onScreen = true;
  let running = false;
  const shouldRun = () => onScreen && !document.hidden && document.body.classList.contains("auth-locked")
    && !["guest-features", "guest-contact", "view-shop"].some((name) => document.body.classList.contains(name));
  const frame = (now) => {
    if (!shouldRun() || reduceMotion.matches) { running = false; return; }
    render(now);
    requestAnimationFrame(frame);
  };
  const update = () => {
    if (reduceMotion.matches) { running = false; lastFrame = performance.now(); render(lastFrame); return; }
    if (running || !shouldRun()) return;
    running = true;
    lastFrame = performance.now();
    requestAnimationFrame(frame);
  };
  if (card && "IntersectionObserver" in window) {
    new IntersectionObserver((entries) => { onScreen = entries.some((entry) => entry.isIntersecting); update(); }).observe(card);
  }
  new MutationObserver(update).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  document.addEventListener("visibilitychange", update);
  reduceMotion.addEventListener?.("change", update);
  update();
}
