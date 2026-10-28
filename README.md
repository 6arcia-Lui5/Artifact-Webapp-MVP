# Artifact Webapp MVP

An artifact catalog built with React/Vite, Express/TypeScript, PostgreSQL/Drizzle, and Clerk.

## Local branch integration (October 28)

`codex/integrate-existing-work-2026-10-28` combines the existing work below. It is a local integration branch, not a deployed release.

| Source | Included work |
| --- | --- |
| `main` at `5494d48` | Catalog search, expanded artifact schema and spreadsheet imports |
| Local protected demo at `25d38d1` | Five-account access wall, Vercel setup, ownership checks, import validation and image resolution |
| `login-plus-search` at `ab20d8f` | Login/catalog merge history and a separate `AppLayout` for authenticated pages |
| `ml-date-region-models` at `0516c4b` | Python models, training/evaluation scripts, recorded reports, demo and Express ML routes |

The routing merge retains the backend allowlist, login-first browsing, responsive login and production signup restrictions. The ML routes run behind that same allowlist. Model requests have a ten-second timeout so an unavailable Python service does not leave them waiting indefinitely. Existing import validation, image handling and deployment configuration are preserved. No database migration is needed for this merge.

The older `create-page` commit `47bdf9f` was reviewed but not merged: its unfinished editor uses the previous `title`/`description` schema, an undefined `Label`, and an invalid submit handler. It is a reference for the next editing task, not a working editor for the current schema. The other historical database/query/route branches are already ancestors of `main`; the bug-fix and access branches are already ancestors of the protected demo.

Remaining product work: editing, inscription entry/persistence/display, catalog filters, reviewable imports and source-verified corrections to existing records. Collections remain a placeholder. There is no catalog ML button yet, and the database checked before integration had no inscriptions. An API bridge and a separate ML demo do not complete that user workflow.

Integration verification on October 28: frontend/backend builds and frontend lint passed; all 15 backend tests passed; all 15 catalog/login browser tests passed against a local production preview; the separate authenticated real-model bridge browser test passed; both baseline and deep models returned valid results for all 16 bundled examples. The deep model agreed with all 16 selected demo labels, while the baseline agreed with 14. These selected examples do not measure general accuracy. The verified runtime was Python 3.12.16, scikit-learn 1.9.1 and CPU PyTorch 2.14.1. Neither training nor held-out evaluation was rerun, and artifact records were not created, changed or deleted by the checks.

## Catalog updates

The October 9 site update integrates GitHub main commit `5494d48` with the existing five-account access controls.
It adds catalog search, the expanded artifact metadata form, object-type selection and creation, and Excel/CSV imports up to 4 MB.
Record cards, profiles, and detail pages use the new database fields. Imports refresh the catalog and profile lists.
Record ownership and identifiers remain controlled by the backend.

The shared Neon database already uses the new schema; this update does not run database migrations or change existing artifact records.
The ML branch is now included on the local integration branch described above.

## Run the ML component

See [the ML guide](ml/README.md) for models, data and evaluation details. Use Python 3.11+ (3.12 for this integration) in a project-local virtual environment, install `ml/requirements.txt`, then run `python -m uvicorn service:app --host 127.0.0.1 --port 8001` from `ml`. The baseline checkpoint requires the pinned scikit-learn 1.9.1; a Python 3.10 environment that substitutes an older version is not a verified setup. The bundled models can run without downloading training corpora or retraining.

The default Express destination is `http://localhost:8001`; set `ML_SERVICE_URL` on the backend if the Python service uses another address. `POST /api/ml/check` accepts inscription text and optional listed date/region. `GET /api/ml/records/:id/check` requires an existing record with stored inscription text. Both require an approved Clerk session.

The Python service is a separate process, not bundled into the Express Vercel function. Keep it on localhost for local work; a future hosted deployment must provide an appropriately restricted ML service and set its backend URL. Do not expose the standalone development demo as the private catalog's authentication boundary.

The committed reports describe historical evaluation runs, not accuracy reproduced during integration. In `ml/reports/comparison.json`, region top-one accuracy is 57.43% and top-three accuracy is 81.11%; these are different measures. The selected demo pairs are smoke-test examples, not a representative accuracy benchmark.

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
No artifact records are created or deleted by the tests. Tracing, screenshots, and video are disabled for credential-handling tests.

For the optional real-model bridge check, also run the Python service and set `E2E_ML=1` before `npm run test:e2e`. The test signs in with an approved account, checks anonymous denial, and sends bundled inscription text through Express to the real model. For a production preview build, set `E2E_HOSTED=1`; `E2E_FRONTEND_URL` and `E2E_API_URL` can point to isolated local ports. Backend ML integration tests substitute Clerk, database reads and the Python service to check access denial, Unicode forwarding, stored-record checks and model-service failures without changing shared artifact data.

## Where to add features

- `frontend/src/pages`: screens and forms.
- `frontend/src/components/RequireSiteAccess.jsx`: site entry check.
- `frontend/src/components/RequireSignIn.jsx`: contributor-page user synchronization.
- `frontend/hooks` and `frontend/lib`: data fetching and API calls.
- `backend/src/routes` and `backend/src/controllers`: API routes and validation.
- `backend/src/middleware/requireSiteAccess.ts`: approved-account check for all API routes.
- `backend/src/middleware/requireApiAuth.ts`: JSON 401 responses for sign-in-only API operations.
- `backend/src/db/schema.ts` and `queries.ts`: database fields and queries.
