import { onLanguageChange, t } from "./i18n.js";

const progress = document.querySelector("#demoProgress");
const path = document.querySelector("#demoTrackPath");
const marker = document.querySelector("#demoTrackMarker");
const playButton = document.querySelector("#demoPlayButton");

if (progress && path && marker && playButton) {
  const speed = document.querySelector("#demoSpeed");
  const gForce = document.querySelector("#demoGForce");
  const delta = document.querySelector("#demoDelta");
  const sector = document.querySelector("#demoSector");
  const label = document.querySelector("#demoProgressLabel");
  const insight = document.querySelector("#demoInsight");
  const cursor = document.querySelector("#demoChartCursor");
  const primaryDot = document.querySelector("#demoPrimaryDot");
  const secondaryDot = document.querySelector("#demoSecondaryDot");
  let frame = 0;
  let lastTime = 0;

  const curve = (position, phase = 0) => Math.sin(position * Math.PI * 6 + phase);
  const sectorName = (position) => position < .25 ? "T1" : position < .5 ? "T3" : position < .75 ? "T4" : "T7";
  const insightKey = (position) => position < .25 ? "landing.insightBrake" : position < .5 ? "landing.insightMid" : position < .75 ? "landing.insightExit" : "landing.insightFinal";

  function renderDemo() {
    const position = Number(progress.value) / 1000;
    const pathPoint = path.getPointAtLength(path.getTotalLength() * position);
    marker.setAttribute("transform", `translate(${pathPoint.x} ${pathPoint.y})`);

    const primarySpeed = 92 + 33 * Math.sin(position * Math.PI) + 18 * curve(position, .45);
    const comparisonSpeed = primarySpeed - (3.5 + 3.5 * Math.sin(position * Math.PI * 2));
    const lateral = 1.32 * curve(position, 1.1);
    const timeDelta = -.684 * position + .06 * Math.sin(position * Math.PI * 3);
    const x = 52 + position * 568;
    const yPrimary = 252 - Math.max(35, Math.min(140, primarySpeed)) / 140 * 205;
    const ySecondary = 252 - Math.max(35, Math.min(140, comparisonSpeed)) / 140 * 205;

    cursor.setAttribute("x1", x); cursor.setAttribute("x2", x);
    primaryDot.setAttribute("cx", x); primaryDot.setAttribute("cy", yPrimary);
    secondaryDot.setAttribute("cx", x); secondaryDot.setAttribute("cy", ySecondary);
    speed.textContent = Math.max(38, primarySpeed).toFixed(1);
    gForce.textContent = `${Math.abs(lateral).toFixed(2)} g`;
    delta.textContent = `${timeDelta <= 0 ? "−" : "+"}${Math.abs(timeDelta).toFixed(3)}`;
    sector.textContent = `${sectorName(position)} · ${Math.round(position * 100)}%`;
    label.value = `${Math.round(position * 100)}%`;
    insight.textContent = t(insightKey(position));
    progress.style.setProperty("--progress", `${position * 100}%`);
  }

  function stop() {
    cancelAnimationFrame(frame); frame = 0; lastTime = 0;
    playButton.textContent = "▶";
    playButton.setAttribute("aria-label", "Play demo");
  }

  function animate(time) {
    if (!lastTime) lastTime = time;
    const next = Number(progress.value) + (time - lastTime) * .035;
    lastTime = time;
    progress.value = next >= 1000 ? 0 : next;
    renderDemo();
    frame = requestAnimationFrame(animate);
  }

  progress.addEventListener("input", () => { if (frame) stop(); renderDemo(); });
  playButton.addEventListener("click", () => {
    if (frame) stop();
    else { playButton.textContent = "Ⅱ"; playButton.setAttribute("aria-label", "Pause demo"); frame = requestAnimationFrame(animate); }
  });
  onLanguageChange(renderDemo);
  renderDemo();
  queueMicrotask(renderDemo);
}
