# Simulating Drime / gateway outages (dashboard error UI)

Use these steps to manually verify the dashboard blocking error + **Retry** UI.

## Prerequisites

- Gateway: `bun run start` (port from `.env`, default `8081`)
- Web UI: `bun run web:dev` → http://127.0.0.1:5173/_ui/
- Log in with `WEB_UI_PASSWORD`

## A — Drime API unavailable (recommended)

This matches production when Drime is down, times out, or refuses connections.

1. **Stop** the running gateway (`Ctrl+C` on `bun run start`).
2. In `.env`, set a dead base URL (nothing listening):

   ```env
   DRIME_API_BASE_URL=http://127.0.0.1:9
   ```

3. Start the gateway again: `bun run start`
4. Open **Dashboard** in the UI.

**Expected:** centered **Drime API unavailable**, error detail, **Retry** button. No stat cards or “Top buckets”.

5. Restore a real URL (remove the line or set `https://app.drime.cloud/api/v1`), restart gateway, click **Retry** (or refresh).

## B — Gateway not reachable

1. Stop the gateway; keep `bun run web:dev` running.
2. Reload the dashboard.

**Expected:** **Could not reach gateway** / connection error (Vite proxy `ECONNREFUSED`).

## C — Stats failure only (optional)

Harder to trigger without breaking status. Useful check: stop gateway during an in-flight stats request, or use an uninitialized workspace (`503` on `/_admin/stats` before `POST /_admin/init`).

## Quick API check (no browser)

With gateway running and scenario A active:

```bash
curl -s -b cookies.txt -c cookies.txt \
  -X POST http://127.0.0.1:8081/_admin/login \
  -H 'Content-Type: application/json' \
  -H 'Origin: http://127.0.0.1:8081' \
  -d '{"password":"YOUR_WEB_UI_PASSWORD"}'

curl -s -b cookies.txt http://127.0.0.1:8081/_admin/status \
  -H 'Origin: http://127.0.0.1:8081'
```

Look for `"reachable":false` and an `"error"` string on `drime`.
