# D3CF Technology

Web app and API for the LapTrace telemetry logger: download sessions over Bluetooth (or upload a CSV), split them into laps and sectors, compare laps and get an AI debrief. Live at [d3cf.com](https://d3cf.com).

## Structure

- `index.html`, `styles.css`, `src/` — the single-page app (Vite). Public pages live on real paths (`/`, `/features`, `/shop`, `/contact`); the signed-in views use hashes (`/#analysis`, `/#logs`, `/#ai`, `/#profile`).
- `src/domain/` — CSV/UBX parsing, lap splitting, sectors, analysis and the track catalog.
- `src/ble/` — Web Bluetooth, Capacitor (iOS) and mock LapTrace clients.
- `server/` — Express API: accounts (JWT), log library, AI reports (OpenAI), shop pre-orders, transactional email (Resend), PostgreSQL schema.
- `tests/` — unit tests plus API end-to-end tests that run against PostgreSQL when `TEST_DATABASE_URL` is set.

## Local development

```bash
npm install
npm start
```

Opens the app on `http://127.0.0.1:4173`. `?mock=1` uses a simulated LapTrace instead of real Bluetooth. Web Bluetooth needs Chrome or Edge.

The API needs PostgreSQL: copy `.env.example` to `.env`, then run `npm run start:server`.

```bash
npm test
npm run build
```

## Deployment

`main` deploys to Render after CI passes; see [docs/render-setup.md](docs/render-setup.md) for environment variables, the shop and database backups.

## iPhone / iOS

Safari has no Web Bluetooth, so the iOS app wraps the same web build with Capacitor and uses CoreBluetooth. Build on a Mac with Xcode:

```bash
npm install
npm run ios:add
npm run ios:open
```

In Xcode pick your Apple Development Team, connect a real iPhone (Bluetooth does not work in the Simulator) and run the `App` target. After web changes run `npm run ios:sync`. `ios:add` adds the required `NSBluetoothAlwaysUsageDescription` to `Info.plist`. The app talks to `https://d3cf.com`, and the API accepts its `capacitor://localhost` origin.

App name: **D3CF**, bundle ID: `com.d3racinglab.laptrace`.
