export const SUPPORTED_LANGUAGES = ["ru", "en", "pl"];

const translations = {
  ru: {
    "status.disconnected": "LapTrace не подключён", "status.searching": "Поиск LapTrace…", "status.connectFailed": "Подключение не выполнено",
    "hero.kicker": "АНАЛИЗ ПАМЯТИ LAPTRACE", "hero.title": "Лог с устройства.", "hero.accent": "Сразу в разбор.",
    "hero.copy": "Подключитесь после заезда, скачайте сохранённую телеметрию по Bluetooth и выберите нужную сессию. Файлы и ручной импорт не нужны.",
    "action.connect": "Подключить LapTrace", "action.disconnect": "Отключить LapTrace", "action.start": "Начать запись", "action.stop": "Остановить запись",
    "action.download": "Скачать сохранённые сессии", "action.cancel": "Отменить", "action.unlock": "Разблокировать",
    "device.gps": "GPS", "device.battery": "Батарея", "device.free": "Свободно", "device.memory": "память устройства",
    "device.used": "Занято памяти", "device.records": "Записей", "device.waiting": "ожидание данных", "device.satellites": "{count} спутников",
    "device.fix": "3D FIX", "device.noFix": "НЕТ FIX", "device.charging": "заряжается", "device.batteryPower": "от батареи", "device.inputVoltage": "входное напряжение",
    "memory.protected": "Память защищена кодом", "memory.code": "Код", "memory.remaining": "{records} записей · ~{time} при 25 Гц",
    "hint.initial": "Устройство должно быть включено, находиться рядом и не быть подключено к телефону.", "hint.mock": "Активен тестовый BLE-адаптер.",
    "summary.sessions": "Сессии", "summary.loadFirst": "сначала скачайте память", "summary.duration": "Длительность", "summary.selected": "выбранная сессия",
    "summary.maxSpeed": "Макс. скорость", "summary.frequency": "Частота", "unit.speed": "км/ч", "unit.hz": "Гц",
    "track.kicker": "ТРАЕКТОРИЯ", "track.empty": "Нет загруженной сессии", "track.slower": "медленнее", "track.faster": "быстрее", "track.canvasEmpty": "Здесь появится траектория из памяти LapTrace",
    "sessions.kicker": "ПАМЯТЬ УСТРОЙСТВА", "sessions.title": "Сохранённые сессии", "sessions.empty": "После загрузки здесь появятся отдельные записи.", "sessions.item": "Сессия {id}", "sessions.points": "{count} точек",
    "telemetry.kicker": "ТЕЛЕМЕТРИЯ", "telemetry.speed": "Скорость", "insights.kicker": "ИНЖЕНЕРНЫЙ РАЗБОР", "insights.title": "Что видно в данных", "insights.empty": "Скачайте лог с LapTrace, чтобы получить первичный разбор.",
    "ai.title": "Контекст для AI-инженера", "ai.copy": "Приложение агрегирует выбранную BLE-сессию: скорость, нагрузки, качество GPS и временную структуру. Сырой поток остаётся локально.",
    "ai.placeholder": "Например: какие три особенности этой сессии стоит проверить?", "ai.button": "Скопировать AI-контекст", "ai.first": "Сначала скачайте и выберите сессию.", "footer.noData": "Нет данных",
    "progress.preparing": "Подготовка…", "progress.records": "{received} / {expected} записей", "progress.done": "Готово: {count} сесс.",
    "state.connected": "{name} · подключён", "state.ready": "{name} · готов", "state.reading": "{name} · чтение памяти", "state.downloading": "{name} · загрузка", "state.loaded": "{name} · данные загружены",
    "state.recording": "{name} · идёт запись", "state.stopped": "{name} · запись остановлена", "hint.recording": "Запись идёт во внутреннюю память устройства.", "hint.ready": "Память готова. Модель: {model}.",
    "error.notSelected": "Устройство не выбрано. Включите LapTrace, закройте его приложение на телефоне и выберите LapTrace в списке BLE-устройств.",
    "error.network": "Не удалось установить BLE-соединение. LapTrace может быть подключён к телефону или другому приложению.", "error.security": "Браузер заблокировал Bluetooth. Откройте приложение в Chrome или Edge по адресу localhost.",
    "insight.fastest": "Лучший круг — №{lap}; разброс до самого медленного круга составляет {delta} с.", "insight.braking": "Самое сильное продольное замедление на круге №{lap}: {value} g. Знак зависит от ориентации устройства.", "insight.lateral": "Пиковая боковая нагрузка — {value} g на круге №{lap}.", "insight.qualityGood": "Поток ровный: {hz} Гц, разрывов длиннее {gap} мс не обнаружено.", "insight.qualityBad": "Обнаружено {count} разрывов потока; проверьте качество записи.",
  },
  en: {
    "status.disconnected": "LapTrace disconnected", "status.searching": "Searching for LapTrace…", "status.connectFailed": "Connection failed",
    "hero.kicker": "LAPTRACE MEMORY ANALYSIS", "hero.title": "Device log.", "hero.accent": "Ready for analysis.", "hero.copy": "Connect after the run, download the recorded telemetry over Bluetooth, and choose a session. No files or manual imports required.",
    "action.connect": "Connect LapTrace", "action.disconnect": "Disconnect LapTrace", "action.start": "Start recording", "action.stop": "Stop recording", "action.download": "Download saved sessions", "action.cancel": "Cancel", "action.unlock": "Unlock",
    "device.gps": "GPS", "device.battery": "Battery", "device.free": "Free", "device.memory": "device memory", "device.used": "Memory used", "device.records": "Records", "device.waiting": "waiting for data", "device.satellites": "{count} satellites", "device.fix": "3D FIX", "device.noFix": "NO FIX", "device.charging": "charging", "device.batteryPower": "on battery", "device.inputVoltage": "input voltage",
    "memory.protected": "Memory is code-protected", "memory.code": "Code", "memory.remaining": "{records} records · ~{time} at 25 Hz", "hint.initial": "The device must be powered on, nearby, and disconnected from the phone.", "hint.mock": "Test BLE adapter is active.",
    "summary.sessions": "Sessions", "summary.loadFirst": "download memory first", "summary.duration": "Duration", "summary.selected": "selected session", "summary.maxSpeed": "Max speed", "summary.frequency": "Sample rate", "unit.speed": "km/h", "unit.hz": "Hz",
    "track.kicker": "TRACK", "track.empty": "No session loaded", "track.slower": "slower", "track.faster": "faster", "track.canvasEmpty": "The LapTrace track will appear here",
    "sessions.kicker": "DEVICE MEMORY", "sessions.title": "Saved sessions", "sessions.empty": "Downloaded recordings will appear here.", "sessions.item": "Session {id}", "sessions.points": "{count} points",
    "telemetry.kicker": "TELEMETRY", "telemetry.speed": "Speed", "insights.kicker": "ENGINEERING REVIEW", "insights.title": "What the data shows", "insights.empty": "Download a LapTrace log to generate the initial review.",
    "ai.title": "AI engineer context", "ai.copy": "The app aggregates the selected BLE session: speed, forces, GPS quality, and timing. Raw telemetry stays local.", "ai.placeholder": "For example: which three aspects of this session should I review?", "ai.button": "Copy AI context", "ai.first": "Download and select a session first.", "footer.noData": "No data",
    "progress.preparing": "Preparing…", "progress.records": "{received} / {expected} records", "progress.done": "Done: {count} session(s)",
    "state.connected": "{name} · connected", "state.ready": "{name} · ready", "state.reading": "{name} · reading memory", "state.downloading": "{name} · downloading", "state.loaded": "{name} · data loaded", "state.recording": "{name} · recording", "state.stopped": "{name} · recording stopped", "hint.recording": "Recording to the device memory.", "hint.ready": "Memory ready. Model: {model}.",
    "error.notSelected": "No device selected. Turn on LapTrace, close its phone app, and select LapTrace from the BLE device list.", "error.network": "BLE connection failed. LapTrace may be connected to a phone or another app.", "error.security": "Bluetooth was blocked by the browser. Open the app in Chrome or Edge on localhost.",
    "insight.fastest": "Fastest lap: #{lap}; spread to the slowest lap is {delta} s.", "insight.braking": "Strongest longitudinal deceleration on lap #{lap}: {value} g. The sign depends on device orientation.", "insight.lateral": "Peak lateral load: {value} g on lap #{lap}.", "insight.qualityGood": "Stable stream: {hz} Hz with no gaps longer than {gap} ms.", "insight.qualityBad": "Detected {count} stream gaps; check recording quality.",
  },
  pl: {
    "status.disconnected": "LapTrace rozłączony", "status.searching": "Wyszukiwanie LapTrace…", "status.connectFailed": "Nie udało się połączyć",
    "hero.kicker": "ANALIZA PAMIĘCI LAPTRACE", "hero.title": "Log z urządzenia.", "hero.accent": "Gotowy do analizy.", "hero.copy": "Połącz się po przejeździe, pobierz zapisaną telemetrię przez Bluetooth i wybierz sesję. Bez plików i ręcznego importu.",
    "action.connect": "Połącz LapTrace", "action.disconnect": "Rozłącz LapTrace", "action.start": "Rozpocznij zapis", "action.stop": "Zatrzymaj zapis", "action.download": "Pobierz zapisane sesje", "action.cancel": "Anuluj", "action.unlock": "Odblokuj",
    "device.gps": "GPS", "device.battery": "Bateria", "device.free": "Wolne", "device.memory": "pamięć urządzenia", "device.used": "Zajęta pamięć", "device.records": "Rekordy", "device.waiting": "oczekiwanie na dane", "device.satellites": "Satelity: {count}", "device.fix": "3D FIX", "device.noFix": "BRAK FIX", "device.charging": "ładowanie", "device.batteryPower": "z baterii", "device.inputVoltage": "napięcie wejściowe",
    "memory.protected": "Pamięć zabezpieczona kodem", "memory.code": "Kod", "memory.remaining": "{records} rekordów · ~{time} przy 25 Hz", "hint.initial": "Urządzenie musi być włączone, znajdować się w pobliżu i nie być połączone z telefonem.", "hint.mock": "Aktywny jest testowy adapter BLE.",
    "summary.sessions": "Sesje", "summary.loadFirst": "najpierw pobierz pamięć", "summary.duration": "Czas", "summary.selected": "wybrana sesja", "summary.maxSpeed": "Prędkość maks.", "summary.frequency": "Częstotliwość", "unit.speed": "km/h", "unit.hz": "Hz",
    "track.kicker": "TOR", "track.empty": "Brak wczytanej sesji", "track.slower": "wolniej", "track.faster": "szybciej", "track.canvasEmpty": "Tutaj pojawi się tor z pamięci LapTrace",
    "sessions.kicker": "PAMIĘĆ URZĄDZENIA", "sessions.title": "Zapisane sesje", "sessions.empty": "Pobrane nagrania pojawią się tutaj.", "sessions.item": "Sesja {id}", "sessions.points": "{count} punktów",
    "telemetry.kicker": "TELEMETRIA", "telemetry.speed": "Prędkość", "insights.kicker": "ANALIZA INŻYNIERSKA", "insights.title": "Co pokazują dane", "insights.empty": "Pobierz log LapTrace, aby utworzyć wstępną analizę.",
    "ai.title": "Kontekst dla inżyniera AI", "ai.copy": "Aplikacja agreguje wybraną sesję BLE: prędkość, przeciążenia, jakość GPS i czas. Surowe dane pozostają lokalnie.", "ai.placeholder": "Na przykład: które trzy aspekty tej sesji warto sprawdzić?", "ai.button": "Kopiuj kontekst AI", "ai.first": "Najpierw pobierz i wybierz sesję.", "footer.noData": "Brak danych",
    "progress.preparing": "Przygotowanie…", "progress.records": "{received} / {expected} rekordów", "progress.done": "Gotowe: {count} sesji",
    "state.connected": "{name} · połączono", "state.ready": "{name} · gotowy", "state.reading": "{name} · odczyt pamięci", "state.downloading": "{name} · pobieranie", "state.loaded": "{name} · dane pobrane", "state.recording": "{name} · trwa zapis", "state.stopped": "{name} · zapis zatrzymany", "hint.recording": "Trwa zapis do pamięci urządzenia.", "hint.ready": "Pamięć gotowa. Model: {model}.",
    "error.notSelected": "Nie wybrano urządzenia. Włącz LapTrace, zamknij aplikację w telefonie i wybierz LapTrace z listy BLE.", "error.network": "Połączenie BLE nie powiodło się. LapTrace może być połączony z telefonem lub inną aplikacją.", "error.security": "Bluetooth został zablokowany przez przeglądarkę. Otwórz aplikację w Chrome lub Edge na localhost.",
    "insight.fastest": "Najszybsze okrążenie: #{lap}; różnica do najwolniejszego wynosi {delta} s.", "insight.braking": "Najsilniejsze opóźnienie wzdłużne na okrążeniu #{lap}: {value} g. Znak zależy od orientacji urządzenia.", "insight.lateral": "Maksymalne przeciążenie boczne: {value} g na okrążeniu #{lap}.", "insight.qualityGood": "Stabilny strumień: {hz} Hz, bez przerw dłuższych niż {gap} ms.", "insight.qualityBad": "Wykryto {count} przerw w strumieniu; sprawdź jakość nagrania.",
  },
};

let language = "ru";
try {
  const saved = localStorage.getItem("d3-language");
  const browser = navigator.language?.slice(0, 2);
  language = SUPPORTED_LANGUAGES.includes(saved) ? saved : SUPPORTED_LANGUAGES.includes(browser) ? browser : "ru";
} catch {}

const listeners = new Set();
export const getLanguage = () => language;
export function t(key, values = {}) {
  const template = translations[language]?.[key] ?? translations.ru[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? `{${name}}`);
}
export function applyTranslations(root = typeof document !== "undefined" ? document : null) {
  if (!root) return;
  document.documentElement.lang = language;
  root.querySelectorAll("[data-i18n]").forEach((element) => { element.textContent = t(element.dataset.i18n); });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((element) => { element.placeholder = t(element.dataset.i18nPlaceholder); });
  const selector = root.querySelector("#languageSelect");
  if (selector) selector.value = language;
}
export function setLanguage(next) {
  if (!SUPPORTED_LANGUAGES.includes(next)) return;
  language = next;
  try { localStorage.setItem("d3-language", next); } catch {}
  applyTranslations();
  listeners.forEach((listener) => listener(next));
}
export function onLanguageChange(listener) { listeners.add(listener); return () => listeners.delete(listener); }
