# D3CF Technology

Web app and API for the LapTrace telemetry logger: download sessions over Bluetooth (or upload a CSV), split them into laps and sectors, compare laps and get an AI debrief. Live at [d3cf.com](https://d3cf.com).

## Structure

- `index.html`, `styles.css`, `src/` — the single-page app (Vite). Public pages live on real paths (`/`, `/features`, `/shop`, `/contact`); the signed-in views use hashes (`/#analysis`, `/#logs`, `/#ai`, `/#profile`).
- `src/domain/` — CSV/UBX parsing, lap splitting, sectors, analysis and the track catalog.
- `src/ble/` — Web Bluetooth, Capacitor (Android, iOS) and mock LapTrace clients.
- `android/`, `ios/`, `desktop/` — the native app projects (see below).
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
npm run lint
npm test
npm run test:e2e   # browser smoke tests (Playwright, Chromium)
npm run build
```

## Deployment

`main` deploys to Render after CI passes; see [docs/render-setup.md](docs/render-setup.md) for environment variables, the shop and database backups.

## Apps: Android, iOS, Windows, macOS, Linux

The same web build ships as native apps: Capacitor for Android (`android/`) and iOS (`ios/`), Electron for the desktop (`desktop/`).

```bash
npm run desktop:build   # desktop installer for this computer, in release/
npm run android:sync    # then npm run android:open (Android Studio)
npm run ios:sync        # on a Mac, then npm run ios:open (Xcode)
```

GitHub Actions (`Apps` workflow) builds all of them in the cloud; pushing a tag `app-vX.Y.Z` publishes a release.
Building, signing and store publishing: [docs/apps.md](docs/apps.md).

App name: **D3CF**, bundle ID: `com.d3racinglab.laptrace`.
