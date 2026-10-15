# OpsHub: Internal Operations & Communication Portal

Next.js + Express + PostgreSQL + Socket.io implementation of the OpsHub BRD.

| BRD module | Where |
|---|---|
| Communication (global / targeted / cross-dept, notifications, history) | `/messages`, `backend/src/routes/messages.js`, Socket.io |
| Worklog (goals, status, EOD note, timestamps) | `/worklog`, `backend/src/routes/goals.js`, `eod.js` |
| Control Room (pies, comparison bars, progress, blocked > 24h, EOD feed, filters) | `/analytics`, `backend/src/routes/analytics.js` |
| RBAC (Super Admin / Dept Head / Employee) | `backend/src/middleware/auth.js`, `utils.js#canAccessUser` |
| User and department management | `/admin`, `routes/users.js`, `routes/departments.js` |

## Run it locally

Requirements: Node 18+, PostgreSQL 14+ (or Docker).

```bash
# 1. Database (skip if you already have Postgres)
docker compose up -d

# 2. API
cd backend
cp .env.example .env          # set JWT_SECRET for anything beyond local dev
npm install
npm run db:init               # creates tables
npm run db:seed               # OPTIONAL demo data (wipes tables first)
npm run dev                   # http://localhost:4000

# 3. Web app (new terminal)
cd frontend
cp .env.local.example .env.local
npm install
npm run dev                   # http://localhost:3000
```

Without the seed, create the first Super Admin manually:

```bash
npm run create-admin -- "Your Name" you@company.com "a-long-password"
```

### Demo logins (seed data only)

Seeding uses the password you provide, or generates random ones and prints them once:

```bash
ADMIN_PASSWORD='choose-a-password' STAFF_PASSWORD='choose-another' npm run db:seed
```

| Role | Email |
|---|---|
| Super Admin | admin@opshub.example |
| Dept Head (Sales) | anita.desai@opshub.example |
| Dept Head (Tech) | vikram.singh@opshub.example |
| Employee (Sales) | rahul.verma@opshub.example |
| Employee (Tech) | arjun.nair@opshub.example |

Other seeded people follow the same pattern: `firstname.lastname@opshub.example`.

## Permissions

| Action | Super Admin | Dept Head | Employee |
|---|---|---|---|
| Global broadcast | yes | no | no |
| Message any department or person | yes | yes | yes |
| Own goals and EOD note | yes | yes | yes |
| View / set goals for others | anyone | own department | no |
| Control Room analytics | all departments | own department only | no |
| Manage users and departments | yes | no | no |

## Goals are never deleted

Once a goal is added it can be **edited** or marked **Cancelled**, but not deleted (the API answers `DELETE /api/goals/:id` with 405). Cancelled goals stay on record and are shown separately; they do not count as pending or lower a completion rate.

## Adding departments and people

- **Super Admin:** `+ Add` menu in the top bar (Department / Person), or the Admin page. Can manage everyone.
- **Dept Head:** `My Team` page / `+ Add team member`. Adds Employees to their **own** department only.

## Phone app (PWA) and notifications

OpsHub is an installable PWA: it opens full-screen like a native app and can notify you when the app is closed.

1. Generate VAPID keys once: `cd backend && npm run vapid`, put them in `backend/.env` (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`) and restart the API. Run `npm run db:init` once to add the subscriptions table.
2. Serve the app over **HTTPS** (browsers only allow install and push on HTTPS; `localhost` is exempt).
3. On the phone: open the site, tap **Install app** (Android/Chrome) or Share → **Add to Home Screen** (iPhone, iOS 16.4+, required for push on iPhone). Open it, tap the bell, then **Turn on alerts**.

Every message that tags someone is pushed to that person's registered devices. Logging out removes that user's alerts from the device, so a shared phone never shows someone else's messages.

- **In-app, real-time:** Socket.io shows a toast + bell update instantly while the app is open. Missed ones load on next login.
- **Email:** set `SMTP_*` in `backend/.env`. Leave `SMTP_HOST` empty to disable.

## Verify

```bash
export ADMIN_PASSWORD=... STAFF_PASSWORD=...   # any values you choose
cd backend && npm run db:seed && npm run dev      # terminal 1
cd backend && npm run test:smoke                  # terminal 2: 71 API checks
cd backend && npm run test:push                   # Web Push pipeline against a mock push service
cd frontend && npm run test:sw                    # service worker push / click handlers
```

## Deploying

Cloudflare (web app) + Render (API) + Neon (database): see **[DEPLOY.md](DEPLOY.md)**.

### Other hosts (AWS / DigitalOcean / GCP)

- Set `NODE_ENV=production`, a strong `JWT_SECRET`, `DATABASE_URL`, `PGSSL=true` for managed Postgres, and `CLIENT_ORIGIN` to your web URL.
- Set `NEXT_PUBLIC_API_URL` to the API URL **before** `npm run build` in `frontend`.
- Serve both behind HTTPS (required for browser push notifications). If a proxy or load balancer is in front, set `TRUST_PROXY=1` and enable WebSocket upgrades.
- Socket.io rooms live in memory. To run several API instances, add the Socket.io Redis adapter (the BRD's 99.9% availability target needs this plus a managed database).

## Known limits

- Tokens last 8 hours and are stored in `localStorage`; there is no refresh-token flow.
- Dates in the dashboard use each user's browser calendar day; "Blocked > 24h" uses server time.
- Browser push works while OpsHub is open in a tab. Alerts with the tab fully closed would need a service worker and Web Push keys.
