"use strict";
const list = document.getElementById("list");
const connect = document.getElementById("connect");
const cancel = document.getElementById("cancel");
let strings = { title: "", scanning: "", empty: "", unnamed: "", showUnnamed: "{n}", connect: "OK", cancel: "Cancel" };
let devices = [];
let selected = null;
let showUnnamed = false;

const isLapTrace = (device) => /laptrace|racebox/i.test(device.name);

function deviceButton(device) {
  const item = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-pressed", String(device.id === selected));
  const name = document.createElement("span");
  name.textContent = device.name || strings.unnamed;
  const id = document.createElement("small");
  id.textContent = device.id;
  button.append(name, id);
  button.addEventListener("click", () => { selected = device.id; render(); });
  button.addEventListener("dblclick", () => window.picker.choose(device.id));
  item.append(button);
  return item;
}

function render() {
  if (!devices.some((device) => device.id === selected)) selected = null;
  // LapTrace devices first, then other named devices; devices without a name only on request.
  const named = devices.filter((device) => device.name)
    .sort((a, b) => Number(isLapTrace(b)) - Number(isLapTrace(a)) || a.name.localeCompare(b.name));
  const unnamed = devices.filter((device) => !device.name);
  const items = named.map(deviceButton);
  if (showUnnamed) items.push(...unnamed.map(deviceButton));
  else if (unnamed.length) {
    const item = document.createElement("li");
    const more = document.createElement("button");
    more.type = "button";
    more.className = "more";
    more.textContent = strings.showUnnamed.replace("{n}", unnamed.length);
    more.addEventListener("click", () => { showUnnamed = true; render(); });
    item.append(more);
    items.push(item);
  }
  if (!named.length && !(showUnnamed && unnamed.length)) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = strings.empty;
    items.unshift(empty);
  }
  list.replaceChildren(...items);
  connect.disabled = !selected;
}

connect.addEventListener("click", () => { if (selected) window.picker.choose(selected); });
cancel.addEventListener("click", () => window.picker.cancel());
document.addEventListener("keydown", (event) => { if (event.key === "Escape") window.picker.cancel(); });
window.picker.onDevices((next) => { devices = Array.isArray(next) ? next : []; render(); });

window.picker.strings().then((loaded) => {
  if (loaded) strings = loaded;
  document.getElementById("title").textContent = strings.title;
  document.getElementById("scanning").textContent = strings.scanning;
  connect.textContent = strings.connect;
  cancel.textContent = strings.cancel;
  render();
});
