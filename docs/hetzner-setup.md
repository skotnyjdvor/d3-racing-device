# LapTrace on Hetzner

## 1. Create the server

Create a Hetzner Cloud server in Germany or Finland:

- image: Ubuntu 24.04;
- type: CX23 (x86) or CAX11 (ARM);
- authentication: SSH key;
- firewall inbound rules: TCP 22, TCP 80, TCP 443, UDP 443.

Do not expose PostgreSQL port 5432.

## 2. Install Docker

Connect over SSH and install Docker from Docker's official Ubuntu repository. Add your user to the `docker` group, then reconnect.

## 3. Deploy LapTrace

```bash
git clone https://github.com/skotnyjdvor/d3-racing-device.git
cd d3-racing-device
cp .env.example .env
nano .env
docker compose up -d --build
docker compose ps
```

Generate independent secrets for `POSTGRES_PASSWORD` and `JWT_SECRET`. The password inside `DATABASE_URL` must exactly match `POSTGRES_PASSWORD`. URL-encode it if it contains special URL characters.

## 4. Configure DNS

In the DNS panel:

- remove the four GitHub Pages A records;
- remove the old `www` CNAME to `skotnyjdvor.github.io`;
- add `A @ SERVER_IPV4`;
- add `CNAME www d3racinglab.com`;
- optionally add `AAAA @ SERVER_IPV6`.

Caddy obtains and renews HTTPS certificates automatically after DNS points to the server.

## 5. Operations

Update:

```bash
git pull
docker compose up -d --build
```

Logs and health:

```bash
docker compose logs -f app
curl https://d3racinglab.com/api/health
```

Database backups run daily and are retained for 14 days in the `postgres_backups` Docker volume. Copy them to separate storage regularly; a backup on the same server does not protect against full server loss.

For the iPhone build, set `VITE_API_URL=https://d3racinglab.com` in `.env` on the Mac before `npm run ios:sync`.
