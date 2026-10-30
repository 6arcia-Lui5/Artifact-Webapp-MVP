# Artifact Webapp MVP

An artifact catalog built with React/Vite, Express/TypeScript, PostgreSQL/Drizzle, and Clerk.

## Research catalog

`feature/research-catalog` develops the integrated catalog into a research workflow. It requires an explicit database migration before deployment; it is separate from the original integration pull request.

- Search artifact metadata, literal inscriptions and translations, with structured filters, signed date intervals, stable pagination and selected CSV/JSON downloads. Text search matches complete words with all supplied terms; it is not fuzzy or substring matching.
- Organize readable artifacts into owned collections. Removing a collection or its membership preserves the artifacts.
- Use **Import** to preview CSV/XLSX files or selected Met/Cleveland object IDs, inspect mappings and reuse information, skip duplicates and explicitly resume saved batches. Original inscription text, language, script and translation have separate mappings. Unknown source facts remain unknown.
- Attach multiple source links or upload private photographs, preserve exact originals, choose a primary view and download originals. The development PC adapter and hosted Cloudflare R2 adapter share the same workflow. See [image storage and cost](docs/image-storage.md).
- Keep source provenance, scholarly assessments and revision snapshots. Restore requires a current revision check and creates another audited revision.
- Editorial approval is separate from scholarly certainty. New submissions and substantive edits enter the pending queue. Contributors retain their own pending records; other approved accounts see approved records. Trusted reviewers can inspect submissions and decide on others' work. Administrators manage reviewer roles and can edit any artifact. Administrator identities are configured only on the backend.

The existing approved-account login gate still applies. Approval does not publish the catalog to the anonymous internet, prove a transcription correct, or create additional accounts. Model recognition remains a separate, explicitly reviewed workflow.

See [backend setup and API](backend/RESEARCH_API.md) for the ordered migrations, server-only role configuration, local/R2 storage settings, import limits, backups and recovery. Local filesystem photographs are not a hosted demonstration for Hallie; hosted uploads need a private R2 bucket and backend credentials.

## Integrated MVP branch (October 28)

`integration/mvp-ml` combines the existing work below. It is published for team review; it is not a deployed release.

| Source | Included work |
| --- | --- |
| `main` at `5494d48` | Catalog search, expanded artifact schema and spreadsheet imports |
| Local protected demo at `25d38d1` | Five-account access wall, Vercel setup, ownership checks, import validation and image resolution |
| `login-plus-search` at `ab20d8f` | Login/catalog merge history and a separate `AppLayout` for authenticated pages |
| `ml-date-region-models` at `0516c4b` | Python models, training/evaluation scripts, recorded reports, demo and Express ML routes |

The routing merge retains the backend allowlist, login-first browsing, responsive login and production signup restrictions. The ML routes run behind that same allowlist. Model requests have a ten-second timeout so an unavailable Python service does not leave them waiting indefinitely. Existing import validation, image handling and deployment configuration are preserved. No database migration is needed for this merge.

The older `create-page` editor targeted a previous schema. The current editor uses today's artifact fields without rewriting that historical branch. The other historical database/query/route branches are already ancestors of `main`; the bug-fix and access branches are already ancestors of the protected demo.

## Artifact editing and inscriptions

Open an artifact you created and choose **Edit**, or open **Profile** and choose its **Edit** action. The editor preloads the current metadata and all stored inscription entries. Fields are grouped into identification, museum, dating/provenance, physical description, inscriptions, and images/sources. Save changes returns to the artifact and refreshes detail, profile and catalog/search caches; Cancel returns without saving.

Check **Inscribed?** to enter original text, language, script, an optional English translation, and serif/stopmark information. Use **Add inscription** for multiple entries. Existing inscription IDs are preserved. Removing an entry only takes effect on Save; metadata-only API updates that omit `inscriptions` preserve all existing entries. The backend validates every supplied entry before writes and saves the artifact and inscription set in one transaction. The artifact's creator or an administrator can edit it. Deleting an artifact also removes its linked inscriptions in the same transaction.

New artifact saves open their detail page. Failed saves preserve form input and display an actionable error. The image source stays available independently of the artifact's imagery flag; **Preview image** checks the supplied link before saving. Existing imports with invalid source descriptions still need a valid link or a blank source, and misplaced metadata must be corrected against the original workbook. No existing client data is automatically rewritten.

Legacy spreadsheet upload remains available below manual entry for complete artifact metadata. Prefer **Import** for preview, source mapping, literal inscriptions, missing metadata, duplicate checks and resumable batches. Existing source data still needs verification against its original workbook; imports do not rewrite old records automatically.

At the initial integration checkpoint on October 28, frontend/backend builds and frontend lint passed; all 15 backend tests and the 15 catalog/login browser tests passed, followed by the separate authenticated real-model bridge test. Both baseline and deep models returned valid results for all 16 bundled examples. The deep model agreed with all 16 selected demo labels, while the baseline agreed with 14. These selected examples do not measure general accuracy. The verified runtime was Python 3.12.16, scikit-learn 1.9.1 and CPU PyTorch 2.14.1. Neither training nor held-out evaluation was rerun.

After the editing and ML-review changes, both builds, frontend lint, all 23 backend tests, and all 18 browser tests passed. The browser checks cover real create/edit/reload with multiple inscriptions, stable inscription IDs, ownership denial, read-only ML checks and ML failure/retry. The disposable database runner separately verifies rollback of failed creates/updates and removal of linked inscriptions on artifact deletion. Desktop (1280px) and mobile (390px) detail/ML screenshots were inspected; no horizontal overflow was found. Public artifact records were not written by these checks; only synthetic records in disposable schemas were created, changed or deleted, and those schemas were removed afterward.

## Review inscription metadata with ML

On an artifact detail page, **Run ML check** uses the saved original inscription text and compares the predictions with the catalog date and production place (falling back to findspot when production place is absent). It displays the model name, suggested date interval, suggested region, and any review flags. Run the separate Python service before trying this locally. The check never changes stored dates, places, inscriptions or record timestamps. A service outage produces a visible retryable error while the artifact remains available.

Date comparisons accept explicit forms such as `100-200 CE`, `2nd-3rd century CE` or `1st c. BCE`. Unrecognized dates, mixed-era expressions and dates outside 800 BCE to 1000 CE are explicitly marked as not checked rather than silently guessed. Unknown places are reported by the model. No flag means only that the supplied metadata did not trigger the available checks, not proof that the artifact is correctly cataloged. The trained model files and historical accuracy reports are unchanged.

## Catalog updates

The October 9 site update integrates GitHub main commit `5494d48` with the existing five-account access controls.
It adds catalog search, the expanded artifact metadata form, object-type selection and creation, and Excel/CSV imports up to 4 MB.
Record cards, profiles, and detail pages use the new database fields. Imports refresh the catalog and profile lists.
Record ownership and identifiers remain controlled by the backend.

The shared Neon database already uses the new schema; this update does not run database migrations or change existing artifact records.
The ML branch is now included on the integration branch described above.

## Run the ML component

See [the ML guide](ml/README.md) for models, data and evaluation details. Use Python 3.11+ (3.12 for this integration) in a project-local virtual environment, install `ml/requirements.txt`, then run `python -m uvicorn service:app --host 127.0.0.1 --port 8001` from `ml`. The baseline checkpoint requires the pinned scikit-learn 1.9.1; a Python 3.10 environment that substitutes an older version is not a verified setup. The bundled models can run without downloading training corpora or retraining.

The default Express destination is `http://localhost:8001`; set `ML_SERVICE_URL` on the backend if the Python service uses another address. `POST /api/ml/check` accepts inscription text and optional listed date/region. `GET /api/ml/records/:id/check` requires an existing record with stored inscription text. Both require an approved Clerk session.

The Python service is a separate process, not bundled into the Express Vercel function. Keep it on localhost for local work; a future hosted deployment must provide an appropriately restricted ML service and set its backend URL. Do not expose the standalone development demo as the private catalog's authentication boundary.

The committed reports describe historical evaluation runs, not accuracy reproduced during integration. In `ml/reports/comparison.json`, region top-one accuracy is 57.43% and top-three accuracy is 81.11%; these are different measures. The selected demo pairs are smoke-test examples, not a representative accuracy benchmark.

## Photo transcription drafts

In the artifact editor, open **Transcribe a photo**. Choose a local PNG, JPEG or WebP, or use **Use catalog image**. Met collection links use a protected, fixed-host image gateway because the museum image CDN does not allow browser downloads. Other image hosts must allow browser downloads; choosing a downloaded local file remains available. Originals are limited to 8 MB and 20 megapixels.

Select the inscription area, rotate if needed, and choose Latin, Ancient Greek, English or Hebrew. Review and correct the result beside the photograph, then choose **Add transcription** and **Save changes**. An untouched blank entry is reused; saved or partially edited inscriptions are preserved. Recognition alone never writes artifact data. The photo used for recognition is not saved as the artifact image.

Two recognition methods are available:

- **On-device OCR** runs pinned Tesseract.js in a browser worker. Local files are not uploaded. Runtime/language assets download when needed. This is a basic fallback; carved, curved and damaged lettering can produce substantial errors.
- **Vision service** is optional and appears when the backend has a configured service URL. Only the selected crop is sent to that service. The UI compresses the crop below 3.5 MB, leaving room under Vercel's 4.5 MB request limit. Server upload/decode/response limits, cancellation and timeouts apply. A service outage preserves form input and manual entry remains available.

For local vision recognition, install [Ollama](https://docs.ollama.com/windows), download `qwen3-vl:2b-instruct`, and keep Ollama bound to loopback. Set these **backend-only** variables and restart the backend:

```dotenv
LOCAL_VISION_URL=http://127.0.0.1:11434
LOCAL_VISION_MODEL=qwen3-vl:2b-instruct
# Optional credential for an authenticated hosted proxy; never use a VITE_ variable:
LOCAL_VISION_TOKEN=<service-token-if-required>
```

The default model is the explicitly named Instruct checkpoint; the shorter `qwen3-vl:2b` tag currently selects the Thinking checkpoint and is not the tested default. The service URL must implement the Ollama `/api/chat` contract. The status route reports configuration, not proof that a server is awake or a model is installed. Configure one job at the model server (`OLLAMA_NUM_PARALLEL=1` for Ollama); per-process backend limits do not coordinate separate Vercel instances.

The hosted catalog must not depend on a researcher's PC. See [hosting and local fallback options](docs/photo-transcription-hosting.md) and the [measured limitations](docs/photo-transcription-evaluation.md). No paid service, public PC endpoint or hosted recognition account is provisioned by this change. Researchers can also run `scripts/transcribe-photo-local.py` against their own local model and paste corrected text into the website.

### Photo workflow checks

```sh
npm run test:unit --prefix frontend
python -m unittest discover -s tests -p test_transcribe_photo_local.py
node scripts/prepare-photo-fixtures.cjs
```

The preparation script downloads three Met Open Access photos and generates clearly separate text controls in ignored `.local/ocr-evaluation/fixtures`. To include the real photo workflow in the existing disposable database runner, set `E2E_PHOTO=1` and `LOCAL_VISION_URL` before `npm run test:workflow` in `backend`. The extra browser checks exercise actual vision and browser OCR, review/save/reload, cancellation, blank results, existing museum images and service failures. They never target the shared public artifact tables.

## Artifact images and saving

The October 13 fix accepts straight or curly apostrophes and extra whitespace in spreadsheet headings. It validates all rows before database writes and reports the row and missing or invalid field. Manual saves use the same required-field and image-URL checks.

`Image Source URL` accepts a direct image URL or a Met Museum collection link. Met links resolve to the museum's image through its [official object API](https://metmuseum.github.io/#object), with a ten-second timeout and shared query caching. Catalog cards, profiles, and details show a fallback when a source is invalid or an image cannot load. The image field is available whether or not the artifact has imagery; the source link remains available on its detail page.

Existing imported records are not rewritten. Entries whose source is `Colour photo` still need their correct image links supplied. The seven existing records include test entries and are not evidence that the complete client workbook has been imported.

## Access

- Every catalog page, including search and artifact details, checks the Clerk session against the backend before rendering. Visitors go to `/login`; signed-in accounts outside the five approved IDs see an access-denied screen.
- The backend applies the same allowlist to all routes, including catalog reads, record writes, and user sync. Missing sessions receive JSON 401; unapproved accounts receive JSON 403.
- Set `ALLOWED_CLERK_USER_IDS` on the hosted backend to the five Clerk user IDs, separated by commas. IDs must come from the **same Clerk instance** configured on the hosted frontend and backend. If the variable is missing, hosted access fails closed.
- In local development, the backend can read the five IDs from the ignored `.local/dev-accounts.json` created by `npm run dev:accounts`. Restart the backend after seeding. An explicit `ALLOWED_CLERK_USER_IDS` overrides that file.
- `/signup` and its Clerk component remain available in local development. In the production build, account creation is hidden from the public login and the signup route itself is gated. Clerk cannot show its SignUp form to someone already signed in, so creating a new approved account after hosting requires a deliberate admin or invite workflow and an allowlist update. A newly registered Clerk account cannot browse the app or use its API.
- Authentication gates app content and API data. A static frontend host may still serve the HTML, JavaScript, and public image assets to anyone; use host-level access control as well if those files must be private.
## Run locally

Use a current Node version supported by Vite 8 (this checkout was verified with Node 24).
Install dependencies with `npm ci` in both `frontend` and `backend`.

Frontend `frontend/.env`:

```dotenv
VITE_API_URL=http://localhost:3000/api
VITE_CLERK_PUBLISHABLE_KEY=<development-publishable-key>
```

Backend `backend/.env`:

```dotenv
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
DATABASE_URL=<development-postgresql-url>
CLERK_PUBLISHABLE_KEY=<same-development-publishable-key>
CLERK_SECRET_KEY=<development-secret-key>
# Optional locally; required on the hosted backend:
ALLOWED_CLERK_USER_IDS=<clerk-user-id-1>,<clerk-user-id-2>,<clerk-user-id-3>,<clerk-user-id-4>,<clerk-user-id-5>
```

Start `npm run dev` in each directory. Open http://localhost:5173.
For a new personal development database, initialize its schema with `npm run db:push` in `backend`.
Coordinate schema changes before using that command against a shared database.

## Five developer accounts

Set DEV_ACCOUNT_PASSWORD in the ignored backend/.env file, then from `backend`, run:

```sh
npm run dev:accounts
```

The script creates Developer 1 through Developer 5 in the configured Clerk development instance.
Sign in with **dev1@example.com** through **dev5@example.com**. All five share a development password, recorded in the ignored local account sheet.
These are deliberately simple development fixtures; the setup script refuses production keys and unmanaged users.
Only these five managed accounts skip Clerk's new-device email challenge. Other users keep their existing checks.
Their original primary test email addresses remain attached, preserving the same users and artifact ownership.

At `/login`, expand **Developer test accounts** and choose an account to fill its short email.
The account selector is available only in development and is removed from production builds.
The local account sheet is `.local/DEV-ACCOUNTS.md`; the machine-readable file is `.local/dev-accounts.json`.
Both are ignored by Git. Set DEV_ACCOUNT_PASSWORD in backend/.env to the shared password supplied by your teammate before creating or resetting accounts; no password is committed.

Re-running `npm run dev:accounts` reuses the accounts and verifies their passwords.
To explicitly restore the shared demo password, run `npm run dev:accounts -- --reset-passwords` in `backend`.

## Vercel demo

Live demo: https://artifact-webapp-demo.vercel.app (API: https://artifact-webapp-demo-api.vercel.app).

Create two Vercel projects from this checkout: `backend` (Express function) and `frontend` (Vite static app). The frontend's `vercel.json` serves client routes such as `/login` and `/record/:id` on a direct visit. Each project's `.vercelignore` keeps local `.env` files out of CLI uploads.

Set these Vercel environment variables before deploying:

| Project | Variables |
| --- | --- |
| Backend | `DATABASE_URL` (Neon pooled URL), `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `ALLOWED_CLERK_USER_IDS` (exactly the five IDs), `FRONTEND_URL` (the frontend origin) |
| Frontend | `VITE_CLERK_PUBLISHABLE_KEY` (same Clerk instance), `VITE_API_URL` (`https://<backend-domain>/api`) |

Deploy the backend first, then the frontend. If its URL changes, update `FRONTEND_URL` and redeploy the backend so browser requests pass CORS. For a short-lived demo using the five seeded development accounts, keep both projects on the same Clerk development instance. A true Clerk production instance needs its own domain and five new approved user IDs. The API fails closed when `ALLOWED_CLERK_USER_IDS` is absent. Do not run `db:push` against a shared Neon database without coordinating schema changes.

## Checks

```sh
# backend
npm run build
npm test

# frontend
npm run build
npm run lint
npm run test:e2e
```

Browser tests require both local servers, the five seeded accounts, and Microsoft Edge.
The Playwright browser channel can be changed in `frontend/playwright.config.mjs`.
Tests cover login-first browsing, protected routes/API calls, responsive login, incorrect passwords,
sign-in/sign-out with all five accounts, catalog search, record details, authenticated object-type requests, museum images and image fallbacks, and form recovery after save errors. Tests use real Clerk sessions and synchronize developer users into the configured development database.
Default authentication checks do not create or delete artifact records. Opt-in write tests use the disposable workflow below. Tracing, screenshots, and video are disabled for credential-handling tests.

For the optional real-model bridge check, also run the Python service and set `E2E_ML=1` before `npm run test:e2e`. The test signs in with an approved account, checks anonymous denial, and sends bundled inscription text through Express to the real model. For a production preview build, set `E2E_HOSTED=1`; `E2E_FRONTEND_URL` and `E2E_API_URL` can point to isolated local ports. Backend ML integration tests substitute Clerk, database reads and the Python service to check access denial, Unicode forwarding, stored-record checks and model-service failures without changing shared artifact data.


### Isolated write-workflow tests

Start the Python service on port 8007 (or set `ML_SERVICE_URL`), then run `npm run test:workflow` from `backend`. This development runner uses the existing ignored developer-account sheet and database credentials. It creates a unique disposable schema, clones the five table definitions, seeds synthetic data, and points local backend/browser tests exclusively at that schema. Neon pooled URLs are converted to a direct endpoint in memory for isolated `search_path` handling. It tests actual Postgres transaction rollback and cleans up only its generated schema and test servers in a `finally` block. It does not write public artifact tables or alter the production schema definitions. Do not run artifact write tests against the shared public catalog; `E2E_WRITE` is for this isolated runner.

## Where to add features

- `frontend/src/pages`: screens and forms.
- `frontend/src/components/RequireSiteAccess.jsx`: site entry check.
- `frontend/src/components/RequireSignIn.jsx`: contributor-page user synchronization.
- `frontend/hooks` and `frontend/lib`: data fetching and API calls.
- `backend/src/routes` and `backend/src/controllers`: API routes and validation.
- `backend/src/middleware/requireSiteAccess.ts`: approved-account check for all API routes.
- `backend/src/middleware/requireApiAuth.ts`: JSON 401 responses for sign-in-only API operations.
- `backend/src/db/schema.ts` and `queries.ts`: database fields and queries.
