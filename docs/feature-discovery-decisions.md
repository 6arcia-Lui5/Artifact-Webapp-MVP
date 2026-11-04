# Personal museum discovery decisions

This branch adds **Discoveries** at `/discoveries`. It is a personal research list for objects from the existing Met and Cleveland adapters. Enter known numeric museum IDs, then use **Keep**, **Dismiss**, or **Undo last decision**. Keyword discovery and multilingual terminology are separate development work. This branch adds no museum providers, AI requests, photo storage, or R2 resources.

## Decision semantics

- A newly added object is **Not reviewed** (`pending`). **Keep** means relevant to this user's research; it does not publish or import a catalog record. **Dismiss** hides it from Active; the Dismissed list remains available.
- **Undo last decision** restores one previous state and clears that undo slot. For example, Not reviewed → Keep → Dismiss → Undo returns to Keep. Another undo is unavailable until another decision is made. This is one-step undo, not an unlimited audit history.
- Decisions and the undo slot live in PostgreSQL without an expiry. Refreshing the page or restarting the server retains them.
- Adding the same canonical museum/provider ID again preserves the saved summary, decision, revision, and undo slot. Leading zeros collapse (`000777` is `777`). The same number at different museums is a different identity. Each user's list is independent, including for reviewers and administrators.
- **Source details and import → Preview catalog import** is available on Kept objects. It fetches fresh facts into the existing import preview and opens `/import?job=…`. Only the existing explicit import flow creates records. Dismissal and undo never delete or modify catalog records. Museum reuse terms remain subject to review.
- A decision captures the displayed revision. Competing changes return HTTP409; **Refresh list** loads saved state before another decision. A repeated request for the already-current decision with the current revision is a no-op. Network errors do not automatically retry writes.

## API contract

All paths below are relative to `/api/research`, behind the existing approved Clerk account gate. Ownership comes from the authenticated request, never the body. Missing or another user's candidate returns HTTP404. Adding requires an existing synced user profile; an unconnected profile returns HTTP409 before contacting a museum. The page waits for `useUserSync` and offers **Reconnect account** after a sync failure.

| Method/path | Input / result |
| --- | --- |
| `GET /discoveries` | Optional `status=active\|pending\|kept\|dismissed\|all`, `page=1..40`; default Active, 25/page. Returns `items`, `counts`, filtered `total`, `page`, `pageSize`, `totalPages`, and `limit`. Counts and items share one SQL snapshot. |
| `GET /discoveries/:id` | Returns `{item}` for independent saved-state readback. |
| `POST /discoveries` | `{sourceProvider: "met" or "cleveland", objectIds: ["777"]}`; 1–25 positive numeric strings of at most ten digits. Returns HTTP201 `{added,existing,errors:[{objectId,message}]}`. Invalid source objects produce bounded individual errors; valid objects can still be added. |
| `PATCH /discoveries/:id` | `{decision:"kept" or "dismissed",expectedRevision:1}`; returns `{item}`. |
| `POST /discoveries/:id/undo` | `{expectedRevision:2}`; returns `{item}`. HTTP409 when stale or no previous decision exists. |

Candidate fields include `id`, `sourceProvider`, `sourceObjectId`, `title`, `museumNumber`, `objectType`, `dateLabel`, `material`, `license`, `sourceUrl`, `retrievedAt`, `decision`, `previousDecision`, `revision`, `createdAt`, and `updatedAt`. The browser cache includes the user ID. No source response archive, image bytes, copied photographs, or machine readings are stored in this table.

## Storage and request limits

- Maximum **1,000 candidates per user**, including Dismissed objects. The API checks capacity before museum requests and checks again under a per-user transaction lock before inserts. A concurrent request cannot exceed the cap. A repeated add of existing IDs works at capacity. There is no automatic eviction or destructive purge.
- Each source summary has field bounds: title 500 characters; museum number, object type, date and license 200 each; material 300; source URL 2,048. Their combined UTF-8 text is capped at **8 KiB**, enforced in the API and database. Stored fields may be shortened; the museum link remains available for the full source.
- Thus the capped source text is at most **7.8125 MiB per full user list**, plus row metadata, one decision slot, indexes, PostgreSQL overhead, and ordinary backup/WAL costs. This is a payload budget, not measured total database use or a provider-cost guarantee. No unbounded decision snapshots accumulate. Storage still grows with the number of approved users.
- Existing trusted adapter limits remain: two concurrent object requests, 1 MiB upstream response limit, individual timeouts, and a 24-second overall retrieval deadline. Re-adding saved IDs does not refetch them. Request bodies cannot supply trusted source metadata or initial decisions.
- This first slice has no deletion or archive feature to free a full personal list. At capacity the user sees HTTP429 and their decisions remain saved; increasing limits or adding a deliberate archive workflow is future work.

## Migration and rollback

`backend/scripts/migrate-research.cjs` now applies ordered migrations 001, 002, and **003_discovery_decisions.sql** in its existing explicit transaction. Migration 003 creates only `research_discoveries`, its indexes, and its migration marker. It has a foreign key to `users(id)` with deletion cascade, canonical identity uniqueness, and bounded field/state checks. It does not rewrite catalog data. The existing workflow runner enumerates all ordered SQL files, so it includes migration 003 automatically.

Before enabling this branch, back up the intended database, inspect the migration preview, and apply it only to the explicitly intended schema using the documented operator procedure in `backend/RESEARCH_API.md`. There is no startup migration. No shared/public migration or hosted deployment was performed for this work.

For application rollback, return to the previous application revision and retain the additive table and its decisions. If the branch is later re-enabled, those decisions are still available. Do not automatically drop the table or migration marker as rollback. Any deliberate data removal requires its own reviewed backup/export and authorization. Migration reapplication is tested twice in a disposable schema and preserves existing data.

## Verification and review

Run from the repository root:

```sh
npm run build --prefix backend
npm test --prefix backend
npm run build --prefix frontend
npm run lint --prefix frontend
npm run test:unit --prefix frontend
```

The dedicated real-PostgreSQL check uses `DATABASE_URL` supplied externally:

```sh
npm run test:discoveries --prefix backend
```

Build the backend first. On Windows use `npm.cmd` if shell execution policy blocks `npm.ps1`. An operator may supply an ignored local env file through Node's `--env-file` when running `backend/scripts/test-discoveries.cjs`; no connection string belongs in source or test output.

The harness creates a unique `discovery_test_<timestamp>_<random>` schema, copies only baseline table definitions from `public`, sets the explicit isolated search path, and applies all migrations there twice. It seeds synthetic users; museum network responses are controlled fixtures. It starts the real Express router against PostgreSQL with a test-only Clerk mock. It never applies migrations to or writes catalog data in `public`. Finally it drops only the validated generated schema and verifies its absence.

Verified November 4, 2026:

- Backend and frontend builds pass; frontend lint and 48 existing unit tests pass.
- Default backend suite: **129 passed, 2 database suites skipped**. Its new pure input test always runs; the dedicated real-PostgreSQL test is opt-in.
- Dedicated real-PostgreSQL suite: **10 passed, 0 skipped**, covering canonical IDs, trusted facts/partial failures, first-profile guard, ownership/access, repeated adds, dismissal filters, new server/new pool persistence, one-step undo, stale concurrent decisions, distinct providers/users, import separation, quota races, database bounds/FK, and failed-transaction rollback. Schema cleanup readback passes.
- Impeccable detector reports no findings on the changed UI targets. Existing build warnings concern the main bundle size and an already shared authenticated Axios import; no performance improvement is claimed.

These tests exercise persistence and integration, not museum availability, research correctness, user acceptance, production capacity, or a complete browser accessibility audit. Independent parent browser QA is recorded separately.

Manual review path: sign in → **Discoveries** → **Add museum objects** → choose museum and known IDs → **Add to research list** → **Keep** → refresh → **Dismiss** → select **Dismissed** → **Undo last decision** → expand **Source details and import** → **Preview catalog import**. Inspect the preview without importing unless using an isolated database. In another approved account, verify its list is separate.
