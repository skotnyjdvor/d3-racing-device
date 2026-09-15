# Deployment on Render

d3cf.com runs on Render as a native Node.js web service with a managed PostgreSQL database, both defined in `render.yaml`.

## Blueprint

1. In Render, open the existing Blueprint and sync the latest `main` commit. If it does not exist, create **New → Blueprint** from this repository.
2. Set `APP_ORIGIN` to `https://d3cf.com,https://www.d3cf.com,capacitor://localhost`.
3. Set `OPENAI_API_KEY` as a secret environment variable. `OPENAI_MODEL` defaults to `gpt-5.6-sol`.
4. Set `RESEND_API_KEY` (sending access for the verified `d3cf.com` domain in Resend). `MAIL_FROM` and `APP_URL` have defaults in `render.yaml`.
5. Wait until the web service and `laptrace-db` are available and `/api/health` returns `{"ok":true}`.
6. Add `d3cf.com` and `www.d3cf.com` under the web service's Custom Domains and point DNS to the records shown by Render.

## Continuous integration

GitHub Actions (`.github/workflows/ci.yml`) runs unit tests, API end-to-end tests against PostgreSQL and a production build on every push. In the service settings set **Auto-Deploy → After CI Checks Pass** so only green commits reach production.
