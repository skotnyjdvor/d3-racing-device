// Landing "AI report sample": hovering a card (or a map point) highlights its twin; until the visitor interacts
// the highlight walks through the advice on its own while the section is on screen.
const section = document.getElementById("aiSample");
const cards = [...(section?.querySelectorAll("[data-ais-card]") ?? [])];
const markers = [...(section?.querySelectorAll("[data-ais-marker]") ?? [])];

if (section && cards.length) {
  let current = -1;
  let manual = false;
  let visible = false;
  let timer = 0;

  const activate = (index) => {
    current = index;
    cards.forEach((card, i) => card.classList.toggle("active", i === index));
    markers.forEach((marker, i) => marker.classList.toggle("active", i === index));
  };
  const choose = (index) => { manual = true; window.clearInterval(timer); activate(index); };

  cards.forEach((card, index) => {
    card.addEventListener("mouseenter", () => choose(index));
    card.addEventListener("focus", () => choose(index));
    card.addEventListener("click", () => choose(index));
  });
  markers.forEach((marker, index) => {
    marker.addEventListener("mouseenter", () => choose(index));
    marker.addEventListener("click", () => choose(index));
  });

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const step = () => { if (!document.hidden) activate((current + 1) % cards.length); };
  const sync = () => {
    window.clearInterval(timer);
    if (visible && !manual && !reduceMotion.matches) { if (current < 0) activate(0); timer = window.setInterval(step, 3200); }
  };
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => { visible = entries.some((entry) => entry.isIntersecting); sync(); }, { threshold: 0.25 }).observe(section);
  } else activate(0);
}
