# Apps: Android, iOS, Windows, macOS, Linux

All apps run the same web build as d3cf.com (`dist/`) and talk to the live API at `https://d3cf.com`.
Only the Bluetooth layer differs:

| Platform | Wrapper | Bluetooth | Origin the API sees |
| --- | --- | --- | --- |
| Android | Capacitor (`android/`) | `@capacitor-community/bluetooth-le` | `https://localhost` |
| iOS | Capacitor (`ios/`, Swift Package Manager) | `@capacitor-community/bluetooth-le` (CoreBluetooth) | `capacitor://localhost` |
| Windows, macOS, Linux | Electron (`desktop/`) | Web Bluetooth + the app's own device chooser | `app://d3cf` |

`server/api.mjs` always allows these origins in CORS. Sign-in uses a Bearer token, not cookies.

App name **D3CF**, app ID / bundle ID `com.d3racinglab.laptrace`.

## Building

### Desktop (on any computer with Node.js)

```bash
npm run desktop:dev     # run the app from source
npm run desktop:build   # installer for the current OS in release/
```

Windows gives `release/D3CF-Setup-<version>.exe`, macOS a `.dmg`, Linux an `.AppImage`.
`desktop/app/` is the whole app: `main.cjs` serves the web build from `desktop/app/web` (copied by
`scripts/prepare-desktop.mjs`) on `app://d3cf` and shows the Bluetooth device chooser (`picker.*`).
The installer contains no npm packages (`desktop/before-build.cjs`).

### Android

Needs JDK 21 and the Android SDK (Android Studio installs both).

```bash
npm run android:sync    # build the web app and copy it into android/
npm run android:open    # open in Android Studio, then Run on a phone
```

or from the command line: `cd android && ./gradlew assembleDebug` → `android/app/build/outputs/apk/debug/app-debug.apk`.

### iOS

Needs a Mac with Xcode 16 or newer.

```bash
npm install
npm run ios:sync
npm run ios:open
```

Pick your Apple Development Team in Xcode, connect a real iPhone (Bluetooth does not work in the Simulator) and run the `App` target.

### In the cloud (GitHub Actions)

`.github/workflows/apps.yml` builds everything without a local Android SDK or Mac:

- **Actions → Apps → Run workflow**: Android debug APK, iOS simulator compile check and the three desktop installers as downloadable artifacts.
- **Push a tag** `app-vX.Y.Z` (for example `git tag app-v0.2.0 && git push origin app-v0.2.0`): the same builds, published as a GitHub Release with that version.

## Icons and splash screens

Sources are `resources/icon.svg`, `resources/icon-foreground.svg` and `resources/splash.svg`.
After changing them run `npm run icons`: it renders the PNGs in `resources/` and regenerates every Android and iOS size.
The desktop installers use `resources/icon-only.png`.

## Publishing to the stores

These steps need accounts that only the owner can create.

### Google Play

1. Create a Google Play developer account (one-time fee).
2. Create an upload key once and keep it safe — losing it means contacting Google support:
   `keytool -genkeypair -v -keystore upload.jks -alias d3cf -keyalg RSA -keysize 2048 -validity 10000`
3. Add repository secrets (Settings → Secrets and variables → Actions):
   `ANDROID_KEYSTORE_BASE64` (the file encoded with `base64`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
4. Tagged builds then also produce a signed `.aab` — upload it in the Play Console.
   Play requires a privacy policy URL and the data-safety form (Bluetooth and location are used to find the logger).

Until then, testers can install the debug APK from a release (Android asks to allow installing from that source).

### Apple App Store / TestFlight

1. Join the Apple Developer Program.
2. Archive on a Mac (Xcode → Product → Archive) and upload to App Store Connect, then invite testers in TestFlight.
   Signing in CI is possible later with an App Store Connect API key and a distribution certificate as secrets.

### Desktop signing (optional)

Unsigned installers work, but Windows SmartScreen shows a warning and macOS asks the user to allow the app
(right-click → Open). A Windows code-signing certificate and an Apple Developer ID remove these warnings;
electron-builder picks them up from `CSC_LINK` / `CSC_KEY_PASSWORD` secrets.
