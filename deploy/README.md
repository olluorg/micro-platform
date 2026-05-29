# Server deployment

CI builds a Docker image from `server/Dockerfile`, pushes it to GHCR, then SSHes
into the VPS to `docker compose pull && up`. TLS is terminated by the existing
reverse proxy on the host; the container is published only on `127.0.0.1:8080`.

Workflow: [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml).
Trigger: push a `server-v*` tag (e.g. `server-v0.1.0`), or run it manually
(`workflow_dispatch`). This is intentionally separate from the SDK `v*` tag in
`release.yml`, so SDK releases don't redeploy the server.

```bash
git tag server-v0.1.0 && git push origin server-v0.1.0
```

## GitHub config (repo → Settings → Secrets and variables → Actions)

All configuration lives in GitHub — nothing is hand-placed on the VPS. The
deploy job renders `/opt/ollu/.env` from these on every run.

**Secrets:**

| Secret         | Value                                   |
| -------------- | --------------------------------------- |
| `VPS_HOST`     | VPS IP / hostname                       |
| `VPS_USER`     | SSH user (member of the `docker` group) |
| `VPS_PASSWORD` | SSH password for that user              |
| `VPS_PORT`     | SSH port (e.g. `22`)                    |

**Variables:**

| Variable           | Value                                                            |
| ------------------ | ---------------------------------------------------------------- |
| `GOOGLE_AUDIENCES` | Comma-separated Google OAuth client_id(s) (public, not a secret) |
| `RUST_LOG`         | Optional log filter; defaults to `info` if unset                 |
| `HOST_PORT`        | Optional loopback port published on the VPS; defaults to `8080`. Point the reverse proxy at this port. |

`GOOGLE_AUDIENCES` is a public client_id, so it's a Variable. To keep it as a
Secret instead, set the secret and change `vars.GOOGLE_AUDIENCES` →
`secrets.GOOGLE_AUDIENCES` in `deploy.yml`. GHCR auth uses the built-in
`GITHUB_TOKEN` — no PAT needed.

## One-time VPS setup

```bash
# Docker engine + compose plugin — that's the entire host prep.
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"   # re-login after this
```

`/opt/ollu` is created by the deploy job, `compose.yaml` is copied there, and
`.env` is rendered from GitHub config — you don't place any files by hand.
SQLite data lives in the named volume `ollu-data` and survives redeploys.

## Reverse proxy

The server speaks HTTP on `127.0.0.1:8080` and exposes a WebSocket at
`/sync/socket` (the WS auth token is passed as a query param, so no custom
headers are required). Make sure the proxy forwards the upgrade. Caddy example:

```
api.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

nginx example:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;   # keep long-lived sync sockets open
}
```

## Rollback

Re-run the deploy workflow against an older tag from the Actions UI
(**Deploy server → Run workflow**, pick the ref), or pin an already-built image
directly on the VPS:

```bash
cd /opt/ollu
sed -i 's#^OLLU_IMAGE=.*#OLLU_IMAGE=ghcr.io/<owner>/ollu-server:server-v0.0.9#' .env
docker compose --env-file .env up -d
```

## Health check

`GET /healthz` returns `ok`. Compose has a container healthcheck against it, and
the deploy job runs the same check as a smoke test before reporting success.
