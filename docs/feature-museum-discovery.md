# Museum keyword discovery

This branch adds a keyword search to **Import → Find museum objects** for Met and Cleveland. Select one museum, enter a term, inspect results and select objects, then choose **Preview selected**. The existing saved-import preview still requires explicit confirmation before importing records. Numeric-ID and file import remain available.

Search is `GET /api/research/discovery/search?provider=met|cleveland&q=coin%20pendant`, behind the existing approved-account gate. It writes no database rows. Responses have `provider`, `input`, `queries`, `items`, `partial`, `warnings`, `limits`, and `requests`. Each compact item includes provider/object identity, title, museum, thumbnail URL, source URL, retrieval timestamp, and matching query variants. Source matching means the museum returned the object; it is not a scholarly relevance judgment or an exact-text match claim.

## Query rules

Terms are at most 80 characters and four words. Two-word terms also try reversed word order; multiword terms try hyphenated and spaced forms. `jewelry` and `jewellery` are linked. Unicode letters are accepted, so users can enter museum terms in other languages directly. This feature does not provide automatic translation or claim a reviewed multilingual glossary.

Supported roots expand to the finite lists in `backend/src/research/discovery.ts`: `blunder*`, `erro*`, `forg*`, `garble*`, `imitate*`, `nonsens*`, `pseudo*`, `mistake*`. Other roots are rejected. `fake` is an ordinary term. These developer-reviewed defaults are open for Holly's review; they are not claimed exhaustive or client-approved. No raw asterisk is sent upstream. General spelling correction and all possible word permutations are not included.

## Request and cost limits

Each explicit search makes at most eight keyword queries, requests 12 matches per query, and displays at most 12 unique objects overall. A round-robin sample gives different query variants room. Search pages are not exhaustively downloaded. Limited samples, dropped details, failed queries, and deadline exhaustion are disclosed. Broad searches can miss relevant objects; no recall or precision improvement has been established.

Met uses `/public/collection/v1.1/search` with `offset=0&limit=12`, then fetches at most 12 distinct object-detail records. Cleveland uses `/api/artworks/` with `skip=0&limit=12` and a small `fields` projection, returning enough facts directly for discovery. There are at most **20 upstream requests per search**, at most **two concurrent requests**, an **18-second overall deadline**, and existing **8-second/1-MiB upstream response limits**. Successful queries remain available when other queries fail. No endpoint fallback hides failures. Total duration is subject to ordinary event-loop/network cancellation overhead; hosting must allow this deadline plus authentication/response overhead.

There is no AI inference, image copying, R2 usage, new paid service, scheduled crawler, or new dependency. Thumbnail URLs load from the existing museum image hosts. Repeated user searches repeat requests; this branch adds no cross-request cache or global rate limiter. Existing approved-account checks remain in force. No new persistence or schema migration is required.

Search results and query matches live only in the current page's memory and are lost on reload. Previewing selected results refetches current source facts through the existing importer and stores its normal preview job (30-day retention). Only a later explicit import creates catalog artifacts. Durable discovery decisions and multilingual glossary persistence belong to separate features. Preview creation does not accept or approve scholarly relevance.

## Evidence and limitations — November 4, 2026

Official documentation checked: [Met API](https://metmuseum.github.io/) and [Cleveland API](https://openaccess-api.clevelandart.org/). Met documentation identifies the new paginated v1.1 search endpoint and the October 1 retirement of the old search endpoint. Existing `/v1/objects/{id}` lookups remain documented. Neither documentation establishes reliable raw wildcard semantics.

Live read-only Node requests verified Met v1.1 `coin pendant` (HTTP 200, 120 reported matches). A full feature search returned 12 objects, four query variants, 16 upstream requests and a limited-sample warning in approximately 1.54 seconds. Example: object `465540`, **Coin/Pendant**, with a museum thumbnail and source record link. This is one connectivity smoke test, not a performance benchmark or accuracy evaluation.

Cleveland's first small request timed out at eight seconds. One subsequent feature search also had four timed-out query requests, returned zero objects after about 16 seconds, and disclosed incomplete results. No additional live retry was attempted. Cleveland success normalization/pagination is fixture-tested against its documented response shape; live success from this environment remains unverified. Do not interpret those failures as evidence that the museum contains no matches.

Both builds, frontend lint, 48 frontend unit tests and 135 backend tests passed; one existing PostgreSQL-dependent test was skipped. Seven new backend tests cover explicit variants, finite roots, cold repeated request budgets, per-query overflow, maximum concurrency, identity/provenance deduplication, no results, partial errors, cancellation/deadline, unsafe/malformed upstream data, account denial, repeated/unknown query rejection, and search-selected IDs entering the existing preview with zero artifact writes. Independent rendered desktop/mobile checks are owned by the parent development turn and are not claimed here.

## Run and review

Use the normal local setup in README. Run `npm run build --prefix backend`, `npm test --prefix backend`, `npm run build --prefix frontend`, `npm run lint --prefix frontend`, and `npm run test:unit --prefix frontend` (use `npm.cmd` on Windows if needed). Focused checks: `node --test backend/tests/museum-discovery.test.cjs` after backend build.

Sign in with an approved account, open Import, search `coin pendant`, expand Details and Queries tried, select an object, and create a preview. Verify that no artifact is created until the existing import confirmation is used. Check cancellation, an empty query result, a source error, narrower searches after a limited sample, and both museum choices. Retain existing import tests when changing this feature. For evaluation, have Holly judge representative known examples and compare missed examples and irrelevant results; passing software tests does not establish better research results.
