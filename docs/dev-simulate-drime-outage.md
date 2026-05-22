# Simulating Drime / gateway outages (dashboard error UI)

Use these steps to manually verify the dashboard blocking error + **Retry** UI.

## Prerequisites

- Gateway: `bun run start` (port from `.env`, default `8081`)
- Web UI: `bun run web:dev` → http://127.0.0.1:5173/_ui/
- Log in with `WEB_UI_PASSWORD`

## A — Drime API unavailable (recommended)

The gateway **starts even when Drime is down** (workspace id may be `null` until Drime is reachable again). Status still calls Drime on each request and reports `reachable: false`.

1. In `.env`, point Drime at a closed port (nothing listening):

   ```env
   DRIME_API_BASE_URL=http://127.0.0.1:9
   ```

   Keep your real `DRIME_API_KEY` and `WEB_UI_PASSWORD`. You do **not** need to change `DRIME_GATEWAY_WORKSPACE_ID` for this test.

2. Start (or restart) the gateway: `bun run start`  
   You may see a **warn** log: `gateway workspace not resolved at startup` — that is expected.

3. Open **Dashboard** in the UI.

**Expected:** centered **Drime API unavailable**, error detail (e.g. connection refused), **Retry** button. No stat cards or “Top buckets”.

4. Restore Drime: remove the line or set `DRIME_API_BASE_URL=https://app.drime.cloud/api/v1`, restart the gateway, click **Retry**.

## B — Gateway not reachable

1. Stop the gateway; keep `bun run web:dev` running.
2. Reload the dashboard.

**Expected:** **Could not reach gateway** / connection error (Vite proxy `ECONNREFUSED`).

## C — Stats failure only (optional)

With Drime up but workspace not initialized (`gatewayWorkspaceId` null and no init), `GET /_admin/stats` returns **503** while status may still load — dashboard shows **Could not load workspace stats**.

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
