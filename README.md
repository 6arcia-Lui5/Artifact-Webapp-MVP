# Artifact Webapp MVP

An artifact catalog built with React/Vite, Express/TypeScript, PostgreSQL/Drizzle, and Clerk.

## Access

- Anyone can browse the catalog, collections, and artifact detail pages.
- Sign in at `/login`, or create an account at `/signup`.
- Creating artifacts, managing your records, and editing/deleting your own records require authentication. The editing screen is still a placeholder.
- Protected pages return you to your requested page after sign-in, including email verification.
- Download/export functionality is not implemented yet. Any future download must use `RequireSignIn` in the UI and `requireApiAuth` on the API endpoint. Public browsing endpoints remain readable.
- Account data is kept in a separate React Query cache per identity. Before contribution pages load, the Clerk user is synchronized into PostgreSQL.

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

The existing Google-linked account **luisgarciavv7@gmail.com** is also listed in the development login panel. The seed script only verifies that it exists in the configured Clerk development instance; it does not reset its password or change its Google sign-in or verification settings.

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
Tests cover public browsing, protected routes/API calls, responsive login, incorrect passwords,
and sign-in/sign-out with all five accounts. Tests use real Clerk sessions and synchronize developer users into the configured development database.
No artifact records are created or deleted by the tests. Tracing, screenshots, and video are disabled for credential-handling tests.

## Where to add features

- `frontend/src/pages`: screens and forms.
- `frontend/src/components/RequireSignIn.jsx`: contributor-page access and user synchronization.
- `frontend/hooks` and `frontend/lib`: data fetching and API calls.
- `backend/src/routes` and `backend/src/controllers`: API routes and validation.
- `backend/src/middleware/requireApiAuth.ts`: JSON 401 responses for sign-in-only API operations.
- `backend/src/db/schema.ts` and `queries.ts`: database fields and queries.
