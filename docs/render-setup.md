# LapTrace on Render

The repository includes a Render Blueprint in `render.yaml`. It creates:

- `laptrace`: Node.js web service that serves the Vite app and `/api`;
- `laptrace-db`: private Render PostgreSQL database in Frankfurt;
- generated `JWT_SECRET` and an internal `DATABASE_URL` connection.

## First deployment

1. In Render, choose **New → Blueprint** and connect the GitHub repository.
2. Keep `render.yaml` as the Blueprint path and apply it.
3. When prompted for `APP_ORIGIN`, enter `https://d3racinglab.com,capacitor://localhost` so both the website and iPhone app can call the API.
4. Open the `laptrace` web service and add `d3racinglab.com` under **Settings → Custom Domains**.
5. Update the domain DNS using the values Render shows, then verify the domain.

The database schema is applied automatically when the service starts. The health check remains unavailable until PostgreSQL is connected and migrated.

## iPhone build

For the Capacitor build, create `.env` on the Mac:

```env
VITE_API_URL=https://d3racinglab.com
```

Then run:

```bash
npm install
npm run ios:sync
```

Never put `DATABASE_URL` or `JWT_SECRET` into the Vite environment or iOS app.
