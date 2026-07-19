# D3 Racing Lab

Local-first приложение для загрузки и анализа логов LapTrace по Bluetooth. Устройство использует совместимый UART-over-BLE протокол.

## Основной сценарий

1. Подключить LapTrace после заезда.
2. Проверить GPS fix, батарею и заполнение памяти.
3. Начать/остановить standalone recording (`0xFF/0x25`).
4. При необходимости разблокировать память (`0xFF/0x30`).
5. Начать выгрузку (`0xFF/0x23`).
6. Получить history data (`0xFF/0x21`) и разделить записи по state change (`0xFF/0x26`).
7. Выбрать сессию и анализировать её локально.

CSV не является пользовательским источником данных. Он используется только как fixture автоматических тестов и BLE-эмулятора.

## Запуск

```powershell
npm start
```

Откройте `http://127.0.0.1:4173` в Chrome или Edge. Web Bluetooth доступен только в secure context; `localhost` считается безопасным контекстом.

Тестовый режим без устройства: `http://127.0.0.1:4173/?mock=1`.

```powershell
npm test
```

## Реализовано

- BLE UART и потоковый UBX parser с checksum;
- статус, защита и разблокировка памяти;
- start/stop записи на 25 Гц с ожиданием GPS fix;
- live-индикаторы GPS, спутников, батареи/напряжения и свободной памяти;
- загрузка, прогресс и отмена history dump;
- разделение нескольких записей в памяти;
- выбор сессии, GPS-трасса, скорость и IMU-метрики;
- агрегированный контекст для будущего AI-инженера.
- локализация интерфейса: русский, английский и польский с сохранением выбора.

## iPhone / iOS

В iOS-приложении используется нативный CoreBluetooth через Capacitor, потому что Safari не предоставляет Web Bluetooth. Сборка iOS выполняется на Mac с установленными Xcode и Node.js:

```bash
npm install
npm run ios:add
npm run ios:open
```

После открытия Xcode выберите Apple Development Team, подключите настоящий iPhone и запустите target `App`. Bluetooth не работает в iOS Simulator. После изменений веб-интерфейса выполняйте:

```bash
npm run ios:sync
```

Bundle ID приложения: `com.d3racinglab.laptrace`. Скрипт `ios:add` автоматически добавляет обязательное разрешение `NSBluetoothAlwaysUsageDescription` в `Info.plist`.
