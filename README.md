# HIL Regulatory Tracker Dashboard — internal web app

Multi-user internal dashboard for Heranba's overseas registration and data-generation
tracking. Everyone with the link and shared password can view; a small admin group can
edit data inline, saved centrally for everyone.

## Deploying on Railway

1. Push this repo to GitHub, connect it to a new Railway service (Railway auto-detects
   Node via `package.json` — no config needed).
2. Set these service variables in Railway:
   - `VIEWER_PASSWORD` — shared password for read-only access
   - `ADMIN_PASSWORD` — shared password for edit access
   - `SESSION_SECRET` — any long random string
   - `INGEST_API_KEY` — any long random string (used by the daily Excel-sync job, not by people)
   - `NODE_ENV=production`
3. **Attach a persistent volume** mounted at `/app/data` (Railway → service → Volumes).
   Without this, admin edits and the last-synced dataset are lost on every redeploy,
   since `data/store.json` lives on local disk.
4. Deploy. Railway gives you a public URL — share that with your team along with the
   viewer/admin passwords.

## How data flows in

- `data/base-data.json` is the seed dataset (from the last manual build).
- A scheduled job re-runs the Excel-cleaning pipeline daily and POSTs the fresh dataset
  to `POST /api/data/ingest` (header `x-ingest-key: <INGEST_API_KEY>`). This replaces the
  base dataset while preserving any admin edits (stored separately as an overlay).
- Admin edits made in the app itself are saved via `POST /api/data/edit` and layered on
  top of the base dataset — they survive the next Excel sync automatically.

## Local development

```
npm install
VIEWER_PASSWORD=viewpass ADMIN_PASSWORD=adminpass SESSION_SECRET=dev INGEST_API_KEY=dev npm start
```
