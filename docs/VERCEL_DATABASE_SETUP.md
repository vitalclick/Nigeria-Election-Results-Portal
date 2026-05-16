# Connecting the Database to Vercel

This guide walks through wiring OpenBallot's database (Supabase Postgres)
to a Vercel deployment of the Next.js app under `web/`. The same pattern
works for Vercel Postgres / Neon if you prefer the Vercel Marketplace.

The web app reads three database-related environment variables
(see `web/lib/supabase.ts`):

| Variable                        | Scope                 | Required |
|---------------------------------|-----------------------|----------|
| `NEXT_PUBLIC_SUPABASE_URL`      | Browser + server      | Yes      |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser + server      | Yes      |
| `SUPABASE_SERVICE_ROLE_KEY`     | Server only (secret)  | Yes for write paths |

When `NEXT_PUBLIC_SUPABASE_URL` is unset the app falls back to deterministic
mock data, so you can verify a deploy boots even before secrets land.

---

## 1. Provision the database

### Option A — Supabase (what OpenBallot ships with)

1. Sign in at <https://supabase.com> and create a new project.
2. Pick a region close to your users (e.g. `eu-west-2` for NG traffic).
3. Wait for the project to finish provisioning, then open
   **Project Settings → API**. Copy:
   - **Project URL** → becomes `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key → becomes `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role** key → becomes `SUPABASE_SERVICE_ROLE_KEY`
     (treat as a password — server-side only).
4. Apply the schema and seed data from this repo:
   ```bash
   # using the Supabase CLI
   supabase link --project-ref <your-ref>
   supabase db push          # applies db/migrations/*.sql
   psql "$SUPABASE_DB_URL" -f db/seed/seed.sql   # optional seed
   ```
   Alternatively paste each file in `db/migrations/` into the Supabase
   SQL editor in order.

### Option B — Vercel Marketplace (Postgres / Neon / Supabase)

1. In the Vercel dashboard open your project → **Storage** → **Create**.
2. Choose a provider (Supabase, Neon, or Vercel Postgres).
3. Click **Connect Project**. Vercel injects the connection env vars
   (`POSTGRES_URL`, `SUPABASE_URL`, etc.) into every environment
   automatically — no manual copy/paste.
4. If you pick Supabase via the marketplace, the integration also sets
   `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   for you. Skip to step 3 below.

---

## 2. Create / import the Vercel project

1. Sign in to <https://vercel.com> with the team GitHub account.
2. **Add New → Project** and import `vitalclick/OpenBallot`.
3. Framework preset: **Next.js** (auto-detected).
4. **Root Directory**: `web/`  ← important, the repo is a monorepo.
5. Build & Output settings: leave defaults
   (`next build` / `.next`).
6. Click **Deploy** once — the first build will succeed with mock data
   even before env vars are set.

---

## 3. Add the database env vars to Vercel

Pick one of the two methods below.

### 3a. Dashboard

1. Project → **Settings → Environment Variables**.
2. Add each variable for the three environments
   (**Production**, **Preview**, **Development**):

   | Key                              | Value                          | Env(s)            |
   |----------------------------------|--------------------------------|-------------------|
   | `NEXT_PUBLIC_SUPABASE_URL`       | `https://<ref>.supabase.co`    | All               |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY`  | `eyJhbGciOi...` (anon)         | All               |
   | `SUPABASE_SERVICE_ROLE_KEY`      | `eyJhbGciOi...` (service role) | Production + Preview |

   Mark the service-role row as **Sensitive** so it never appears in logs.

3. Click **Save**.

### 3b. CLI

```bash
npm i -g vercel
vercel login
vercel link              # run from repo root, picks the OpenBallot project

vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add NEXT_PUBLIC_SUPABASE_URL preview
vercel env add NEXT_PUBLIC_SUPABASE_URL development

vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
# ... repeat for preview / development

vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add SUPABASE_SERVICE_ROLE_KEY preview
```

To mirror them into your local `web/.env.local`:

```bash
cd web
vercel env pull .env.local
```

---

## 4. Allow Vercel to reach the database

Supabase is reachable from the public internet by default — no firewall
rules needed.

For Vercel Postgres / Neon, the marketplace integration handles
networking. For a self-managed Postgres (e.g. RDS), add Vercel's
egress IPs to the allow-list or front the DB with a connection pooler
(PgBouncer / Supavisor). For serverless functions, prefer the **pooled**
connection string (port `6543` on Supabase) — direct connections to
`5432` will exhaust the database under load.

---

## 5. Redeploy and verify

1. Trigger a redeploy: **Deployments → ⋯ → Redeploy** (or push a commit
   to the tracked branch).
2. Once the build is green, open the deployment URL and confirm:
   - The map / dashboard show real data (not the mock placeholders).
   - Browser DevTools → Network shows requests going to
     `<ref>.supabase.co`.
3. Smoke-test the server path that uses the service role:
   ```bash
   curl -fsS https://<your-vercel-domain>/api/health
   ```
4. Tail logs from the CLI if something is off:
   ```bash
   vercel logs <deployment-url>
   ```

If the page renders mocks, `NEXT_PUBLIC_SUPABASE_URL` is still unset
in that environment — re-check step 3 and redeploy (env var changes
require a new deploy to take effect).

---

## 6. Lock it down before going public

- **Rotate** the anon and service-role keys in Supabase if they were
  ever pasted into chat/email; update Vercel env vars and redeploy.
- **Row Level Security**: enable RLS on every table and apply the
  policies in `db/policies/` — the anon key is public, so RLS is what
  actually protects the data.
- **Restrict the service role**: it bypasses RLS. Only import
  `supabaseAdmin()` from server components / route handlers, never
  from `'use client'` files.
- **Branch databases** (optional): use Supabase branching or a
  separate Neon branch for Vercel **Preview** deployments so PRs don't
  mutate production rows.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Page shows mock data in prod | env var not set for **Production** | Add it, redeploy |
| `NEXT_PUBLIC_SUPABASE_URL / ANON_KEY missing` at runtime | Vars set only for Preview/Dev | Add to Production scope |
| `SUPABASE_SERVICE_ROLE_KEY missing` on an API route | Service role not set, or imported from a client component | Add the var; move import to a server file |
| Intermittent `too many connections` | Functions hitting the direct port | Switch to the pooled connection string (`:6543`) |
| Works locally, fails on Vercel | Stale build cached | Redeploy with **Clear build cache** |
