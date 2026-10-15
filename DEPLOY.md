# Deploying OpsHub (Cloudflare frontend + Node backend)

```
Phone / browser ──► Cloudflare Workers (static web app + PWA)
                          │  HTTPS (REST + WebSocket)
                          ▼
                  Node API (Render or any Docker host) ──► PostgreSQL (Neon)
```

The web app is a fully static site, so Cloudflare serves it. The API needs a long-running Node process
(Socket.io real-time + Web Push), so it runs on a Node host. Everything is HTTPS, which phones need to
install the app and receive notifications.

You need accounts for: Cloudflare (Dharmendra's), a Postgres host (Neon free tier is fine), and a Node host
(Render below; any Docker host works).

## 1. Database (Neon)

Create a project and copy the connection string (it ends in `?sslmode=require`).

## 2. API (Render)

1. Push this folder to a GitHub repo.
2. Render → **New → Blueprint** → pick the repo (it reads `render.yaml`). Plan is **Free**. It sleeps after ~15 min idle, which delays messages and
   notifications. Fix: add a free monitor (UptimeRobot / cron-job.org) that opens `https://<your-api>/health`
   every 5 minutes. Free instances also have no Shell and a monthly hour limit; switch `plan:` to `starter` for always-on.
3. Fill the environment variables it asks for:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon connection string |
| `CLIENT_ORIGIN` and `APP_URL` | your Cloudflare site URL (step 3). Leave blank for now and set it after step 3 |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | run `cd backend && npm install && npm run vapid` locally and paste both |
| `VAPID_SUBJECT` | `mailto:you@yourcompany.com` |

   `JWT_SECRET` is generated for you. The tables are created automatically on every start.
4. When it is live, `https://<your-api>/health` must answer `{"status":"ok"}`.
5. Create the first Super Admin. Free instances have no Shell, so run this on your own computer against Neon
   (in the `backend` folder, after `npm install`):

```bash
DATABASE_URL='<neon connection string>' PGSSL=true npm run create-admin -- "Dharmendra" dharmendra@yourcompany.com "a-long-password"
```

   Do **not** run `db:seed` in production: it wipes the database.

## 3. Web app (Cloudflare, Dharmendra's account)

Run these on your own computer (Node 18+), inside the `frontend` folder:

```bash
npm install
echo NEXT_PUBLIC_API_URL=https://<your-api-url> > .env.production    # the API URL from step 2, no trailing slash
npx wrangler login        # a browser opens: sign in as Dharmendra and approve
npx wrangler whoami       # confirm it shows the right account
npm run deploy:cf         # builds the static site and uploads it
```

Wrangler prints the site URL, like `https://opshub-web.<subdomain>.workers.dev`.

Then go back to Render and set `CLIENT_ORIGIN` and `APP_URL` to that exact URL (no trailing slash) and
redeploy. Without this, the browser blocks the API (CORS error on the login page).

**Custom domain:** Cloudflare dashboard → Workers & Pages → `opshub-web` → Settings → Domains & Routes →
Add, or add `"routes": [{ "pattern": "ops.yourcompany.com", "custom_domain": true }]` to
`frontend/wrangler.jsonc`. Update `CLIENT_ORIGIN` / `APP_URL` to the new address.

## 4. Check it works

1. Open the site, sign in as the Super Admin, add departments and people from **+ Add**.
2. On a phone: open the site → **Install app** (Android) or Share → **Add to Home Screen** (iPhone, iOS 16.4+).
3. Open the installed app → bell → **Turn on alerts**, then **Send test**.
4. Have someone tag you in Messages; the phone notification should arrive with the app closed.

## Updating

- Web app: `npm run deploy:cf` in `frontend` (rebuild whenever `NEXT_PUBLIC_API_URL` changes).
- API: push to GitHub; Render redeploys.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Login page shows a network / CORS error | `CLIENT_ORIGIN` on the API does not exactly match the site URL |
| Page loads but "Cannot reach the server" | wrong `NEXT_PUBLIC_API_URL`; fix `.env.production` and redeploy the web app |
| "Turn on alerts" says push is not set up | `VAPID_*` variables missing on the API |
| No alerts on iPhone | app must be added to the Home Screen and opened from there |
| Messages arrive late | API instance is sleeping (free plan) |

## Scaling note

Real-time rooms live in the API's memory, so run **one** API instance. To run several, add the Socket.io
Redis adapter first.
