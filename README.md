# Artifact Webapp MVP

An artifact catalog built with React/Vite, Express/TypeScript, PostgreSQL/Drizzle, and Clerk.

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

## Checks

```sh
# backend
npm run build

# frontend
npm run build
npm run lint
npm run test:e2e
```

Browser tests require both local servers, the five seeded accounts, and Microsoft Edge.
The Playwright browser channel can be changed in `frontend/playwright.config.mjs`.
Tests cover login-first browsing, protected routes/API calls, responsive login, incorrect passwords,
and sign-in/sign-out with all five accounts. Tests use real Clerk sessions and synchronize developer users into the configured development database.
No artifact records are created or deleted by the tests. Tracing, screenshots, and video are disabled for credential-handling tests.

## Where to add features

- `frontend/src/pages`: screens and forms.
- `frontend/src/components/RequireSiteAccess.jsx`: site entry check.
- `frontend/src/components/RequireSignIn.jsx`: contributor-page user synchronization.
- `frontend/hooks` and `frontend/lib`: data fetching and API calls.
- `backend/src/routes` and `backend/src/controllers`: API routes and validation.
- `backend/src/middleware/requireSiteAccess.ts`: approved-account check for all API routes.
- `backend/src/middleware/requireApiAuth.ts`: JSON 401 responses for sign-in-only API operations.
- `backend/src/db/schema.ts` and `queries.ts`: database fields and queries.
