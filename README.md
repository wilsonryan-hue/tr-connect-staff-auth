# staff-auth — the staff desk

This server is the working desk. From the repo root, `npm run dev` serves it at http://127.0.0.1:8787/. GitHub Pages stays the closed door. Do not commit real users.json. Deploy steps are in DEPLOY.md.

Implements GET/POST /api/staff-auth and the desk behind that login: jobs, quotes, tenders, approvals, mail, finance, invoices, workers, site notes, and job files.

## Contract

| Method | Auth | Response |
|--------|------|----------|
| GET (no auth) | none | empty book { v:1, book:{} } — no roster, no hashes |
| GET + Bearer | Authorization Bearer token | { email, name, role } or 401 |
| POST | body { email, password } | { token, email, name, role } on success; 401 / 429 on failure |

- Passwords verified with scrypt against server-side users.json (never shipped to the browser).
- Session token is an opaque server token (random). The SPA stores only the session record in localStorage (tr.desktop.session) — never a password book.
- Failed attempts are rate-limited (8 per email+IP within 15 minutes; response includes locked: true).
- No guest password-create endpoint.
- No public named staff list.

## Local prep run

From this directory: copy users.json.example to users.json (empty users array), then invoke the start script from package.json. Default listen host is loopback on port 8787, path /api/staff-auth.

Optional env: PORT (default 8787), HOST (default 127.0.0.1), CORS_ORIGIN (default star), STAFF_AUTH_USERS (path to users.json).

### Adding a user (Ryan-run, offline)

Use the hash-password script with a password Ryan supplies. Paste the printed salt and hash into a users.json entry Ryan creates locally. Do not invent credentials. Do not commit users.json. Roles: RYAN, OFFICE, WORKER.

### Point the SPA at this API

In the app folder, set the VITE_API_BASE environment variable to the staff-auth origin when running Vite. With VITE_API_BASE unset, the Vite local stub still answers /api/staff-auth for UI work — that stub is not real verification.

## Deploy later (blocked on Ryan host choice)

After Ryan picks Origin, another paid host, or hold:

1. Copy this folder (or equivalent) onto the chosen host.
2. Mount users.json out of band — never in git, never on Pages.
3. Set CORS_ORIGIN to the static app origin if SPA and API are separate.
4. Put TLS in front; prefer loopback behind a reverse proxy.
5. Point the static build with VITE_API_BASE (rebuild) or same-origin proxy to /api/staff-auth.
6. Rotate any credentials that ever lived in the old public staff-auth.json on Pages.

Do not start a new Connect repo. Do not treat a Grok sandbox as the staff door.

## Phone install and client portal

- `GET /manifest.webmanifest`, `/icon-192.png`, `/icon-512.png`, `/apple-touch-icon.png`, and `/install` are the phone install. The name is Treun Roc Connect. The short name is TR Connect.
- `GET /portal` is the client shell. It stays blocked.
- `GET /api/portal` and `GET /api/portal/*` are gated stubs. They do not read the job book. Unsigned is 401. A staff session is 403. There is no client login.
- Staff Client view remains `#/client` and says STAFF PREVIEW.

## Door (2026-09-09)

- Pages door stays **CLOSED** until `/api` is live (re-closed `48f5830`).
- Do not push to wilsonryan-hue/tr-connect; do not publish SPA with VITE_API_BASE until API live.
- Health: GET /health and GET /api/health.
- Rate-limit headers on auth failures: Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset.
- CORS_ORIGIN env: comma allow-list (default * for prep only).
- Unauthenticated GET /api/staff-auth returns empty book only — never leaks roster.


## Deploy-ready (2026-09-17)

- `Dockerfile` — Node 20 alpine; listens `HOST`/`PORT` (default `0.0.0.0:8787` in image)
- `Procfile` — `web: node src/server.js` (Heroku/Railway-style)
- Mount or inject `users.json` at runtime (`STAFF_AUTH_USERS`); never bake into image
- Set `CORS_ORIGIN=https://connect.treunroccontracts.com`
- After TLS URL is live: set Pages `live.json` `api_base` to that origin (no trailing slash)
- Prove: `node scripts/prove-p0.mjs` locally; then curl live `/health` + empty-book GET
- Full oneshot: `/workspace/ops/TR-STAFF-AUTH-DEPLOY-ONESHOT-2026-09-17.md`


## P1 tenancy (2026-09-17)

- Every user may include `tenantId` (default **`treunroc`** if omitted).
- `POST /api/staff-auth` and Bearer `GET` return `tenantId` on the session payload.
- **Tenant B path:** add users with a different `tenantId` (e.g. `acme-contracts`) on the same server/users.json — no code fork. Desk data isolation comes later (jobs rows must carry the same tenantId).
- Never commit real users.json.

## TR Bot desk chat (2026-09-21)

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/tr-bot/messages` | Staff Bearer token. `{ threadId?, staffName?, staffEmail?, text }` → `{ threadId, messages }` |
| GET | `/api/tr-bot/messages?threadId=` | Staff Bearer token. Thread transcript |
| POST | `/api/tr-bot/reply` | `{ threadId, text, secret }` — secret must match `TR_BOT_REPLY_SECRET` (prep default `tr-desk-local`) |

The desk toolbar shows Handed off when the note is stored. It does not invent a reply. Env: `TR_BOT_WEBHOOK_URL` (optional fire-and-forget), `TR_BOT_REPLY_SECRET`, optional `TR_BOT_THREADS_PATH`. The thread file follows `DATA_DIR` when that is set. Store default: `data/tr-bot-threads.json` (gitignored).

