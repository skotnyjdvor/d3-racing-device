# Temporary deployment on Render

Render is the primary deployment while suitable Hetzner Cloud capacity is unavailable. The Docker Compose deployment remains available for a later migration.

## Blueprint

1. In Render, open the existing Blueprint and sync the latest `main` commit. If it does not exist, create **New → Blueprint** from this repository.
2. Set `APP_ORIGIN` to `https://d3racinglab.com,https://www.d3racinglab.com,capacitor://localhost`.
3. Wait until both `laptrace` and `laptrace-db` are available and `/api/health` returns `{"ok":true}`.
4. Add `d3racinglab.com` and `www.d3racinglab.com` under the web service's Custom Domains.
5. Replace the old GitHub Pages DNS records with the records shown by Render.

No application migration will be needed when moving to Hetzner later: both targets use the same Node.js API and PostgreSQL schema.
