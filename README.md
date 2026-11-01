# Handheld Words artifact catalog

A private research database for recording artifacts, photographs and original inscriptions. Researchers can import museum records or spreadsheets, organize study collections, and review submissions before sharing them with other approved users.

The app also offers photo-transcription drafts and date/region suggestions. These tools assist research; they do not certify a reading or automatically correct the catalog.

**New here?** Watch the [3½-minute how-to video](https://youtu.be/1ZpEK0dKiZY) for a walkthrough of the catalog.

## What you can do

- **Find artifacts:** search metadata, original inscriptions and translations; filter by museum, material, language, script, place, source, object type, research status and date range.
- **Record research:** create incomplete drafts, edit metadata, and save multiple inscriptions with their language, script and optional translation.
- **Organize and export:** group artifacts into personal research collections and download filtered or selected records as CSV or JSON.
- **Import records:** preview CSV/Excel mappings or selected Metropolitan Museum of Art and Cleveland Museum of Art records before saving. Imports retain source details and leave missing facts unknown.
- **Manage photographs:** attach source links or store permitted originals with captions, credits and licenses. Multiple views, primary-image selection and original downloads are supported.
- **Review submissions:** administrators and trusted reviewers approve records or request changes. Editorial approval is separate from scholarly certainty.
- **Track changes:** inspect revision history and restore earlier research data. Conflicting edits are rejected so one researcher does not silently overwrite another's work.

The catalog requires an approved Clerk account. Contributors can edit their own records and see approved records plus their own submissions. Reviewers can inspect all submissions; administrators can also edit any artifact and manage reviewer assignments. Administrator access is configured on the backend. Creating an account alone does not grant catalog access.

## Using the app

1. Sign in with an approved account.
2. Use **Search**, **Collections**, or **New Record**. Select **Save as a draft with incomplete metadata** when source facts are unknown.
3. Use **Import** to inspect a file or museum-record preview before importing selected rows.
4. Open an artifact to manage photographs, read inscriptions and inspect its source and revision history.
5. Reviewers and administrators use **Review** to approve submissions or request changes. Substantive edits return a record to pending approval. Reviewers cannot approve their own submissions; administrators must document a reason when doing so.

### Transcription and ML

For photo transcription, choose **Edit**, then **Transcribe a photo**. Choose a local image or **Use catalog image**, select the language and inscription area, then choose **Run transcription**. Correct the result beside the photograph, choose **Add transcription**, and save the artifact.

The table below describes local development configurations. The hosted demonstration uses two Workers AI vision readers and hosted baseline date/region inference; it has no dedicated OCR engine. See [the current hosted setup](docs/hosted-demo.md).

| Tool | What it does | What it needs locally |
| --- | --- | --- |
| On-device OCR | Produces a basic text draft in the browser | Language assets download on first use; no model server |
| Vision service | Reads a photograph with a local vision model | A configured, running Ollama-compatible service |
| Read and compare | Shows vision/OCR readings and their disagreements | Configured vision and CPU OCR services |
| Run ML check | Suggests dates/regions from saved inscription text | The separate Python date/region service |

Compared readings support Latin, Ancient Greek and English. The single vision reader also offers Hebrew. Recognition does not attach the photograph to the record or save inscription text automatically. Date/region checks do not change stored metadata.

**The packaged local companion is unfinished.** There is no packaged Mac launcher or one-click local companion. The stronger local demonstration ran on a desktop GPU; fast performance on low-end laptops has not been established. Curved and damaged inscriptions can produce incorrect text, including conflicting Greek readings. A representative researcher-checked accuracy evaluation is still needed.

Setup and measurements: [photo transcription](docs/transcription-pipeline.md), [CPU OCR](ocr/README.md), [date/region models](ml/README.md), [photo-reading limitations](docs/photo-transcription-evaluation.md).

## Run the catalog locally

These steps are for developers. Researchers using the hosted catalog do not need to install the web application's development tools.

Requirements: Node.js 24, npm, PostgreSQL 14 or newer, and a Clerk development application. Python 3.12 is used for the optional ML services.

### 1. Install dependencies

From the repository root:

```sh
npm ci --prefix backend
npm ci --prefix frontend
```

### 2. Configure development access

Create `frontend/.env`:

```dotenv
VITE_API_URL=http://localhost:3000/api
VITE_CLERK_PUBLISHABLE_KEY=<clerk-development-publishable-key>
```

Create `backend/.env`:

```dotenv
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
DATABASE_URL=<development-postgresql-connection-string>
DATABASE_SCHEMA=public
CLERK_PUBLISHABLE_KEY=<same-clerk-development-publishable-key>
CLERK_SECRET_KEY=<clerk-development-secret-key>
ALLOWED_CLERK_USER_IDS=<approved-clerk-user-ids-separated-by-commas>
CATALOG_ADMIN_USER_IDS=<approved-administrator-clerk-user-ids>
```

Replace the placeholders. Both applications must use the same Clerk instance. Administrator IDs must also be in the approved-account list. Keep secret keys, passwords and connection strings out of Git; `.env` files are ignored.

For the five local test accounts, add `DEV_ACCOUNT_PASSWORD` to `backend/.env`, then run `npm run dev:accounts --prefix backend`. The development-only login selector fills their email addresses. Credentials and IDs are written to ignored `.local/DEV-ACCOUNTS.md` and `.local/dev-accounts.json`. Restart the backend after provisioning accounts. If `ALLOWED_CLERK_USER_IDS` is set, it overrides the local account file.

### 3. Initialize a development database

**Use a new, empty development database for these commands.** From `backend`:

```sh
npm run db:push
node --env-file=.env scripts/migrate-research.cjs public --allow-public --preview
node --env-file=.env scripts/migrate-research.cjs public --allow-public
```

The first command creates the baseline tables. The next two preview and apply the ordered research-catalog and moderation migrations. Application startup does not apply migrations.

For an existing database, follow the [migration and backup instructions](backend/RESEARCH_API.md#postgresql-migration-and-recovery) before changing its schema. Do not use `db:push` as an upgrade procedure for a shared catalog. A non-public schema must already contain the baseline tables; set `DATABASE_SCHEMA` to the schema used by the migrations.

### 4. Start the app

Run these in separate terminals from the repository root:

```sh
npm run dev --prefix backend
npm run dev --prefix frontend
```

Open [localhost:5173](http://localhost:5173). On Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`.

The catalog works without the optional model services. To enable date/region checks, follow [ml/README.md](ml/README.md); the backend's default `ML_SERVICE_URL` is `http://localhost:8001`. To enable compared photo readings, follow [the transcription setup](docs/transcription-pipeline.md) and [OCR setup](ocr/README.md), then restart the backend with the documented service settings.

## Hosting and cost

The application uses React/Vite, Express/TypeScript, PostgreSQL/Drizzle and Clerk. The current hosted demo is at [artifact-webapp-demo.vercel.app](https://artifact-webapp-demo.vercel.app). The research catalog and hosted storage/AI configuration were finalized on November 1, 2026; see [the current hosted setup](docs/hosted-demo.md). A November 1 check confirmed website availability, anonymous API denial, and hosted baseline inference. These endpoint checks do not establish client acceptance or sustained uptime.

For the research catalog deployment:

- Deploy `backend` and `frontend` as separate Vercel projects. Set the backend's `FRONTEND_URL` and the frontend's `VITE_API_URL` to their hosted addresses.
- Apply both database migrations before enabling the updated application. Configure approved accounts and administrator IDs on the backend.
- Use a private Cloudflare R2 bucket for hosted uploads. Uploads are disabled in production until storage is configured. The local filesystem adapter is for development only.
- Host model services separately if recognition or date/region checks must work from the website. A hosted backend cannot reach a researcher's localhost. A local helper currently produces text for review and manual transfer; the integrated local-worker connection is not implemented.
- Back up PostgreSQL and uploaded image files separately, and verify recovery before relying on the catalog as the only research archive.

Museum imports keep image links rather than copying every original. Free provider allowances can cover a small catalog, but storage, traffic and ML compute are not guaranteed to remain free. Open models avoid per-image API charges when run locally; they still need suitable hardware. The hosted demonstration now has baseline date/region inference and two vision readers. No dedicated OCR engine is hosted. Provider limits and service availability still apply; no continuous-availability guarantee is claimed.

Configuration and limits: [backend setup](backend/RESEARCH_API.md), [image storage and cost](docs/image-storage.md), [ML hosting options](docs/photo-transcription-hosting.md).

## Known limitations

- The shared catalog retains seven legacy/test records whose source fields and image links still need reconciliation against the original workbook. Existing rows were not rewritten by the newer import validation; a value such as `Colour photo` is rejected as a new image URL. Preserve source evidence and audit legacy rows before client handoff; see [issue #54](https://github.com/6arcia-Lui5/CPTS-421-423-Captsone-Documentation/issues/54).
- Transcription outputs require review. Successful processing or agreement between readers does not establish accuracy.
- The current import duplicate check can miss an artifact entered manually and later imported from a museum. Inspect previews before committing.
- Museum image links can change or disappear. Preserve permitted originals when an external link is insufficient.
- The Mac launcher, target-laptop performance validation, client acceptance and demonstrated backup recovery remain unfinished. Hosted storage/AI configuration is documented in [the current setup](docs/hosted-demo.md).

## Development checks

From the repository root:

```sh
npm run build --prefix backend
npm test --prefix backend
npm run build --prefix frontend
npm run lint --prefix frontend
npm run test:unit --prefix frontend
```

Browser checks use real Clerk test accounts. For write-workflow checks, run `npm run test:workflow --prefix backend`; it creates a disposable database schema and uses local ports 3307 and 5317. It requires the existing baseline tables and ignored developer-account file. Start the date/region service on port 8007 for its default ML checks. Photo checks additionally require the services and flags documented in the transcription guide. Do not point write tests at the shared catalog.

## Code layout

- `frontend/src/pages`: catalog, editor, collections, imports and review screens.
- `frontend/src/components`: access controls, photographs and ML interfaces.
- `backend/src/routes`, `controllers` and `research`: API, validation and research workflows.
- `backend/src/db` and `backend/migrations`: database definitions, queries and migrations.
- `ml`: date/region models and service.
- `ocr`: CPU photo recognition service.
- `scripts`: local transcription and evaluation tools.

## Sprint 5 implementation and tracking

The [current Kanban view](https://github.com/users/6arcia-Lui5/projects/9/views/6) reconciles October implementation and dated November 1 follow-up against commit, PR and test evidence. Private user management, search, corpus gathering, editing, imports, collections/history, private photographs, moderation and assisted-reading integration are recorded as completed development. Client acceptance and bounded remaining work have separate issues.

The November 1 verification passed both builds, frontend lint, 128 backend tests (one PostgreSQL-dependent test skipped) and 48 frontend unit tests. A fresh committed-source checkout installed locked dependencies and built both applications without copied configuration or credentials. Runtime database/account provisioning was outside that fresh-install check. The initial concurrent backend test run hit one short stub timeout; a serial rerun passed unchanged.

The [Sprint 5 documentation](https://github.com/6arcia-Lui5/CPTS-421-423-Captsone-Documentation/tree/codex/sprint-5-reconciliation/Sprints/Sprint_5) contains the report, presentation and evidence. The recorded local walkthrough and historical deep-model metrics are separate from the current hosted baseline model.
