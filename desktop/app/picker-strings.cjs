"use strict";
// Texts for the Bluetooth device chooser, in the language chosen in the app (or the OS language).
const STRINGS = {
  ru: { showUnnamed: "Показать устройства без имени ({n})", title: "Выберите LapTrace", scanning: "Поиск устройств рядом…", empty: "Пока ничего не найдено. Включите LapTrace и держите его рядом.", unnamed: "Устройство без имени", connect: "Подключить", cancel: "Отмена" },
  en: { showUnnamed: "Show unnamed devices ({n})", title: "Choose your LapTrace", scanning: "Looking for nearby devices…", empty: "Nothing found yet. Turn LapTrace on and keep it close.", unnamed: "Unnamed device", connect: "Connect", cancel: "Cancel" },
  pl: { showUnnamed: "Pokaż urządzenia bez nazwy ({n})", title: "Wybierz LapTrace", scanning: "Szukanie urządzeń w pobliżu…", empty: "Jeszcze nic nie znaleziono. Włącz LapTrace i trzymaj go blisko.", unnamed: "Urządzenie bez nazwy", connect: "Połącz", cancel: "Anuluj" },
  it: { showUnnamed: "Mostra dispositivi senza nome ({n})", title: "Scegli il tuo LapTrace", scanning: "Ricerca dei dispositivi vicini…", empty: "Ancora nessun dispositivo. Accendi LapTrace e tienilo vicino.", unnamed: "Dispositivo senza nome", connect: "Collega", cancel: "Annulla" },
};

const pickerStrings = (locale) => STRINGS[String(locale || "").slice(0, 2).toLowerCase()] ?? STRINGS.en;

module.exports = { pickerStrings };
