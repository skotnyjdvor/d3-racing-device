// Motion for the guest "Features" page: scroll reveals, counters, live pipeline, debrief playback, start lights.
const page = document.querySelector("#featuresPage");
const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const isVisible = () => document.body.classList.contains("guest-features") && document.body.classList.contains("auth-locked");

if (page) {
  const svgNs = "http://www.w3.org/2000/svg";
  const revealGroups = [
    [".fx-index a"], [".fx-head"], [".fx-node"], [".fx-blueprint"], [".fx-specs li"], [".fx-window"],
    [".fx-card"], [".fx-chat"], [".fx-steps li"], [".fx-compare > div"], [".fx-after li"], [".fx-cta"],
  ];
  const onReveal = new Map();

  revealGroups.forEach(([selector]) => {
    const parents = new Map();
    page.querySelectorAll(selector).forEach((element) => {
      const index = parents.get(element.parentElement) ?? 0;
      parents.set(element.parentElement, index + 1);
      element.classList.add("fx-reveal");
      element.style.setProperty("--d", `${Math.min(index, 8) * 90}ms`);
    });
  });

  // Blueprint: leads draw in, scanner sweeps the board.
  const blueprint = page.querySelector(".fx-blueprint svg");
  blueprint?.querySelectorAll(".fx-bp-lead").forEach((lead, index) => {
    lead.setAttribute("pathLength", "1");
    lead.style.setProperty("--d", `${300 + index * 140}ms`);
  });
  if (blueprint) {
    const scan = document.createElementNS(svgNs, "rect");
    scan.setAttribute("x", "150"); scan.setAttribute("y", "100"); scan.setAttribute("width", "220"); scan.setAttribute("height", "3");
    scan.setAttribute("class", "fx-bp-scan");
    blueprint.appendChild(scan);
  }

  // App window: cursor sweeping the speed trace.
  const trace = page.querySelector(".fx-window-trace");
  if (trace) {
    const cursor = document.createElementNS(svgNs, "line");
    cursor.setAttribute("y1", "0"); cursor.setAttribute("y2", "100"); cursor.setAttribute("class", "fx-wt-cursor");
    ["x1", "x2"].forEach((attribute) => {
      const animate = document.createElementNS(svgNs, "animate");
      animate.setAttribute("attributeName", attribute);
      animate.setAttribute("values", "0;600");
      animate.setAttribute("dur", "9s");
      animate.setAttribute("repeatCount", "indefinite");
      cursor.appendChild(animate);
    });
    trace.appendChild(cursor);
  }

  // Counters in the app window metrics.
  const metrics = [...page.querySelectorAll(".fx-window-metrics strong")];
  const formatters = [
    (t) => { const ms = Math.round(54_880 * t); return `0:${String(Math.floor(ms / 1000)).padStart(2, "0")}.<em>${String(ms % 1000).padStart(3, "0")}</em>`; },
    (t) => `−${(1.76 * t).toFixed(3)}`,
    (t) => `${(116.7 * t).toFixed(1)}<small>km/h</small>`,
    (t) => `${(2.41 * t).toFixed(2)}<small>g</small>`,
  ];
  const finalMetrics = metrics.map((element) => element.innerHTML);
  const runCounters = () => {
    if (reduceMotion) return;
    const start = performance.now();
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / 1400);
      const eased = 1 - Math.pow(1 - progress, 3);
      metrics.forEach((element, index) => { element.innerHTML = progress < 1 ? formatters[index](eased) : finalMetrics[index]; });
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  const windowElement = page.querySelector(".fx-window");
  if (windowElement) onReveal.set(windowElement, runCounters);

  // Debrief playback: rider asks, engineer "types", actions land one by one.
  const chat = page.querySelector(".fx-chat");
  if (chat) {
    const aiMessage = chat.querySelector(".fx-msg-ai");
    const typing = document.createElement("div");
    typing.className = "fx-typing";
    typing.innerHTML = "<i></i><i></i><i></i>";
    aiMessage?.before(typing);
    const sequence = [chat.querySelector(".fx-msg-rider"), typing, aiMessage, ...chat.querySelectorAll(".fx-actions li"), chat.querySelector(".fx-confidence")].filter(Boolean);
    sequence.forEach((element) => element.classList.add("fx-seq"));
    onReveal.set(chat, () => {
      const delays = [200, 900, 2100, 2700, 3100, 3500, 3900];
      sequence.forEach((element, index) => setTimeout(() => {
        element.classList.add("is-on");
        if (element === aiMessage) typing.classList.add("is-done");
      }, reduceMotion ? 0 : delays[index] ?? 4000));
    });
  }

  // Start lights above the final call to action.
  const cta = page.querySelector(".fx-cta");
  if (cta) {
    const lights = document.createElement("div");
    lights.className = "fx-lights";
    lights.setAttribute("aria-hidden", "true");
    lights.innerHTML = "<span></span><span></span><span></span><span></span><span></span>";
    cta.querySelector("h2")?.before(lights);
  }

  const observer = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-in");
      onReveal.get(entry.target)?.();
      observer.unobserve(entry.target);
    });
  }, { threshold: .18, rootMargin: "0px 0px -6% 0px" }) : null;
  page.querySelectorAll(".fx-reveal").forEach((element) => {
    if (observer && !reduceMotion) observer.observe(element);
    else { element.classList.add("is-in"); onReveal.get(element)?.(); }
  });

  // Live pipeline: packet travels S1→S5 and lights the sector it is in; process tower cycles the leader.
  const nodesList = page.querySelector(".fx-nodes");
  const nodes = [...page.querySelectorAll(".fx-node")];
  const steps = [...page.querySelectorAll(".fx-steps li")];
  let lastNode = -1;
  let lastStep = -1;
  const loop = (now) => {
    if (isVisible() && !document.hidden && !reduceMotion) {
      const progress = (now % 6000) / 6000;
      nodesList?.style.setProperty("--p", progress.toFixed(4));
      const active = Math.min(nodes.length - 1, Math.floor(progress * nodes.length));
      if (active !== lastNode) { nodes.forEach((node, index) => node.classList.toggle("is-live", index === active)); lastNode = active; }
      const step = Math.floor(now / 1800) % Math.max(1, steps.length);
      if (step !== lastStep) { steps.forEach((row, index) => row.classList.toggle("is-live", index === step)); lastStep = step; }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
