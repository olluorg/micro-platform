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

## GitHub secrets (repo → Settings → Secrets and variables → Actions)

| Secret        | Value                                                        |
| ------------- | ----------------------------------------------------------- |
| `VPS_HOST`     | VPS IP / hostname                                          |
| `VPS_USER`     | SSH user (member of the `docker` group)                    |
| `VPS_PASSWORD` | SSH password for that user                                 |
| `VPS_PORT`     | SSH port (e.g. `22`)                                        |

GHCR auth uses the built-in `GITHUB_TOKEN` — no PAT needed. If the package is
private, the VPS pulls using that token during the deploy session.

## One-time VPS setup

```bash
# Docker engine + compose plugin
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"   # re-login after this

sudo mkdir -p /opt/ollu
sudo chown "$USER" /opt/ollu

# Operator-managed env (NOT in git). See deploy/.env.example.
cat > /opt/ollu/.env <<'EOF'
GOOGLE_AUDIENCES=your-client-id.apps.googleusercontent.com
RUST_LOG=info
EOF
```

`compose.yaml` is copied automatically by each deploy; you don't place it by hand.
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

Re-deploy any previously built tag without rebuilding — on the VPS:

```bash
cd /opt/ollu
echo "OLLU_IMAGE=ghcr.io/<owner>/ollu-server:server-v0.0.9" > .env.deploy
docker compose --env-file .env --env-file .env.deploy up -d
```

## Health check

`GET /healthz` returns `ok`. Compose has a container healthcheck against it, and
the deploy job runs the same check as a smoke test before reporting success.
