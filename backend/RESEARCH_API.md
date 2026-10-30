# Research API setup

The existing approved-account gate remains before all routes. Legacy endpoints remain mounted. Contributors edit their own artifacts; administrators may edit, delete, manage images or restore any artifact without changing its original owner. Reviewers inspect all submissions and history but do not gain ownership-based editing permissions. Collection mutations still require the collection creator, including for administrators. Import previews/commits remain preview-owner-only. A null owner on an old collection permits reads only. The old record `collectionId` input is ignored for writes: use the owned collection membership endpoints instead. Legacy collection creation records its creator.

## Publication approval and trusted roles

Every new artifact is pending, including manual saves, legacy spreadsheet imports and staged museum/CSV/XLSX imports. Existing artifacts become pending when migration 002 first adds publication fields. There is no automatic or bulk approval, including for administrator submissions. Rerunning both migrations preserves existing approval decisions, roles and audit history.

Publication uses protected `moderationStatus=pending|approved|changes_requested`, `moderationNotes`, `moderatedBy` and `moderatedAt`. It is independent of scholarly `reviewStatus=draft|reviewed|uncertain`; approving publication never verifies a transcription or clears uncertainty. Substantive metadata/inscription edits reset publication to pending and clear current decision metadata in the same transaction. Image additions, removals, source/photograph replacements, captions, credits, licenses and primary selection changes also reset publication to pending, including legacy image fields and direct database image writes. Image-only changes preserve scholarly review. Earlier decisions remain in audit snapshots. Unchanged values, review-only fields, collection associations and timestamp/history events preserve approval.

`object_types` is a shared controlled vocabulary among approved accounts, including newly created types not yet attached to any artifact. Legacy vocabulary listings intentionally include these selections for manual entry. Research object-type facets are different: they contain only types attached to artifacts visible to the requester.

Contributors see approved artifacts plus their own pending/changes-requested artifacts. Reviewers and administrators see all artifacts. The rule applies to legacy record listing/search/detail/my, collection embeds/counts, stored-record model checks, research search/export/facets, collection membership counts and image metadata/private files. A contributor receives 404 for an unreadable artifact ID. Membership additions require readable artifacts. Removing an association never deletes its artifact. Import duplicate checks skip existing identities without exposing an unreadable duplicate ID or stored source facts, including when reloading a preview after access changes. Authenticated catalog responses use `Cache-Control: private, no-store`.

Configure administrator bootstrap **only on the server** with `CATALOG_ADMIN_USER_IDS`, a comma-separated list of Clerk user IDs already present in the existing global allowlist. Unset/empty means no administrators. Email addresses, browser metadata, request bodies and account creation order never grant privileges. The global allowlist is unchanged and remains mandatory even for an ID listed as administrator. No endpoint creates an account or assigns administrator status.

Reviewer/contributor assignments live in `research_roles`; roles are resolved from PostgreSQL on every request. An administrator may assign only an existing globally approved non-admin account, cannot change their own role, and cannot grant `admin` through HTTP. Assignment changes are recorded in durable `research_role_history`, separate from artifact history. Role changes and decisions lock the same user row so a decision rechecks a completed revocation before writing.

- `GET /api/research/access` returns `{userId,role,canReview,canManageRoles}`.
- `GET /api/research/moderation?status=pending&page=1&pageSize=24` is reviewer/admin-only, supports pending/approved/changes_requested, and returns the paginated catalog DTO with a deterministic ID tiebreaker. Page size is at most 100.
- `POST /api/research/records/:id/moderate` accepts `{status:"approved"|"changes_requested",notes,expectedRevision}`. Notes must contain 1-10000 characters. A stale revision returns 409; the decision, lock and audit are atomic. Reviewers cannot decide their own submissions. Administrators may decide their own only through the same explicit notes/revision-guarded action.
- `GET /api/research/roles` is admin-only and returns at most 100 actual existing approved profiles with effective roles.
- `PATCH /api/research/roles/:userId` accepts only `{role:"contributor"|"reviewer"}` under the restrictions above.

Owners and elevated reviewers/admins may inspect history; only original owners/admins may restore. Audit events preserve the actual artifact owner separately from the actual administrator/reviewer actor. Restore cannot transfer identity/ownership or overwrite publication decisions, source provenance, collection memberships, image associations or legacy image links. Restoring changed substantive data becomes pending through the same database triggers.

## PostgreSQL migration and recovery

Use PostgreSQL 14+ and an **existing, explicitly named application schema** containing the baseline tables. Supply connection details externally; do not import application code to migrate. There is no startup migration and no extension installation.

From `backend`, with `DATABASE_URL` already set externally:

```text
npm.cmd run db:migrate:research -- research_test_<generated_suffix>
```

For application connections set `DATABASE_SCHEMA` to that same schema. The script quotes the schema, takes a schema-specific advisory lock, and applies ordered `001_research_catalog.sql` then `002_catalog_moderation.sql` in one explicit transaction. Its search path contains only the selected schema and `pg_catalog`. System schemas are always refused. The existing production catalog can use `public`, but applying there requires the explicit schema name **and** `--allow-public`; neither an omitted schema nor a flag alone can select it. Application startup never applies migrations. `research_migrations` records `research_catalog_001` and `catalog_moderation_002`. Re-running both preserves data and decisions; it recreates its own triggers/functions and backfills legacy memberships only on the first application. Legacy records stay owned by their original users. Migration 001 makes unknown museum/physical/date/object-type fields and unknown inscribed/imagery flags and inscription language/script/translation nullable; **item_name and inscription content stay required**. Old orphan inscriptions are preserved by a NOT VALID parent FK; new writes are constrained. No arbitrary legacy collection owners or administrator roles are assigned. Migration 002 defaults every existing record to pending once; it does not relabel already-approved records on a rerun.

Preview the SQL without opening a database connection:

```text
npm.cmd run db:migrate:research -- research_test_<generated_suffix> --preview
npm.cmd run db:migrate:research -- public --allow-public --preview
```

After reviewing the preview of both files and testing the backup recovery procedure below, an operator can deliberately apply to an existing public catalog with `npm.cmd run db:migrate:research -- public --allow-public`. Supply its `DATABASE_URL` externally. The flag authorizes only the named schema; it does not create a schema, database or cloud resource. An unapplied research/role table or column returns HTTP503 with an operator migration message and no database details. Apply both files before enabling the updated application; request-time role lookup fails closed if migration 002 is missing.

Before applying in a real environment, create a PostgreSQL custom-format backup with `pg_dump --format=custom --schema=<schema> --file=<backup> <connection>`. Store it privately outside the repository and test `pg_restore` into an empty disposable database using an externally supplied connection. Back up the private image store separately; its blob keys are in `research_blobs`. A PostgreSQL backup alone does not contain image bytes. Prefer a full database backup if restoring into a differently named schema: schema-specific dumps retain their original schema names.

A migration failure rolls back its transaction. To recover after successful application, prefer a forward fix or restore the tested backup into a fresh database and verify it before changing externally managed connection configuration. Rolling back the application alone leaves nullable source data that old strict forms cannot save without the explicit draft flag. Do not drop new tables, provenance, audit snapshots or image metadata as an automated rollback. Database rollback must be coordinated with the image-store backup. For a large existing catalog, the transactional vector backfill and index creation require a maintenance window and sufficient disk space.

## Search, exports, drafts, history

`GET /records` uses the contract filters and exact structured values. `q` uses PostgreSQL `simple` full-text token matching: punctuation splits tokens; all terms must occur in the combined metadata/object-type/inscription text and translation vector. It does not perform substring/fuzzy matching or conflate ancient scripts. Inscriptions refresh the parent vector and revision in the same transaction. Unknown dates are excluded by explicit interval filters. Stable sort orders always end with record ID. Pages contain at most 100 rows; each facet contains at most 100 values of at most 500 characters; collection listing contains at most 200 collections and memberships are added in batches of at most 100.

Exports reuse those filters, including optional comma-separated `ids` (max 100), and reject more than 1000 matching records. A PostgreSQL cursor reads five bounded rows at a time, with a 1 MiB per-record and **4 MiB total serialized export** budget. Exceeding a budget returns 413 before a download starts; narrow the filters or select fewer IDs. CSV includes a BOM, quotes every cell and prefixes formula-like text with an apostrophe. JSON retains original text. Neither export enumerates the entire catalog into application memory.

The legacy create/update API accepts **boolean** `saveAsDraft:true` to allow missing source fields, with blank required-source inputs normalized to null. A title remains required. A supplied invalid UUID, URL, date, boolean or nonempty invalid field is still rejected. Without that flag the existing strict validation remains. Signed `dateStart`/`dateEnd` are integer years (negative = BCE, positive = CE; source year 0 is retained only when explicitly dated). Imported records always start draft. Review is explicit via `PATCH /records/:id/review`; source imports never mark records reviewed.

Explicit draft inscription saves also permit unknown language, script, translation, `serifsPresent` and `stopmarksPresent` as null; blank language/script normalize to null. Original content remains nonblank and bounded, with literal Unicode and newlines preserved. Supplied malformed values and foreign/repeated child IDs remain errors. Complete-entry saves still require language/script and boolean flags (omitted flags default false). Museum and spreadsheet literals record unknown serif/stopmark facts as null; restore preserves those nulls. Spreadsheet mappings still require original content, language and script together. Migration 002 drops only the two inscription flag NOT NULL constraints for this source-fact preservation.

Legacy `PUT /api/records/:id` accepts optional positive-integer `expectedRevision`. Both metadata-only and inscription saves lock the parent row and check that revision before writing anything. Stale edits return actionable 409 without partial metadata/child changes. Editors should send the revision captured when their form was loaded and preserve form input on conflict. Omission remains supported for older clients.

A reviewed artifact becomes draft on a substantive metadata edit or inscription insertion, content/metadata update, or deletion, including edits through legacy endpoints. The same transaction clears the current reviewer/date and records the resulting draft snapshot; review notes remain available. Unchanged inscription values, review-only edits, collection membership and image-only fields/events do not invalidate review. A notes-only review PATCH preserves the assessment date/reviewer. An explicit reviewed/uncertain assessment records the signed-in owner and current database time; explicitly marking draft clears those fields.

Database triggers snapshot legacy and research record/inscription writes atomically and advance `revision`; review/image/moderation mutations also record named events. Authorized history inspection returns the newest 25 events. A snapshot over 64 KiB is omitted from that listing with `snapshotOmitted:true`; its ID remains restorable. Snapshot restore requires `{expectedRevision:<current integer>}`: missing guard is 400, changed revision is 409. Restore copies only permitted substantive record fields and validated inscription content/metadata, generates new child IDs, and retains current ownership, source identity/provenance, collection memberships, images/legacy image links and review notes. Restoring changed substantive data invalidates current reviewed status and publication approval through the same triggers. It records the actual restoring actor. Deleted artifacts cannot be restored through this endpoint. History retention is persistent; operators must plan archival as catalogs grow.

## Imports

Museum preview JSON accepts `{sourceProvider:"met"|"cleveland",objectIds:["123",...]}` with 1-25 explicitly selected positive numeric IDs. Only the two fixed HTTPS API hosts are contacted, with two workers, 8-second request timeouts, a 24-second overall budget and 1 MiB responses. Redirects are rejected; returned image URLs must use the known HTTPS museum image host. No originals are downloaded and OCR is never invoked. Per-row source failures stay visible in the persisted preview.

Primary API documentation checked for this implementation:

- [Met API](https://metmuseum.github.io/): objects still use `/public/collection/v1/objects/:id`; the replacement search endpoint is `/public/collection/v1.1/search` (this connector does not search). `isPublicDomain` controls the image reuse warning.
- [Cleveland API](https://openaccess-api.clevelandart.org/): `/api/artworks/:id`, `share_license_status` = CC0/Copyrighted/Other. Only its explicit `inscription` field supplies literal text; `inscription_translation` stays separate. Descriptions, labels and translations never become original text. Unknown language/script remain null.

Spreadsheet preview accepts multipart `file` CSV/XLSX up to 4 MiB, 500 rows, 100 unique columns, a 2 MiB serialized preview budget, plus optional JSON `mapping` from header to writable field. Aliases include Item Name/Title, Museum, Accession Number, HHW, Object Type (a factual type name), and existing camelCase names. A mapping cannot set ownership, IDs, revision, review or source identity. ZIP expansion is checked before workbook decoding (16 MiB total, 8 MiB/member, 200 entries); encrypted/ZIP64/unsupported archives are rejected. Blank metadata and unknown inscribed/imagery flags remain null. Durable read-only `sourceProvenance` retains the museum reuse flags/credit or spreadsheet filename/row/mapping and job ID after preview retention expires. Spreadsheet records use `sourceProvider=spreadsheet`. No spreadsheet text is inferred to be an original inscription. Museum+accession and HHW matches are explicitly provisional and skipped, never used to overwrite edits. Duplicate rows in a preview are flagged too.

Literal inscription mappings are `inscriptionContent`, `inscriptionLanguage`, `inscriptionScript` and optional `inscriptionTranslation`, each at most 10000 characters. Header aliases include Original Inscription Text, Inscription Content, Inscription Language, Inscription Script and Inscription Translation. Original content, language and script must all be present; partial combinations, translation-only rows and an explicit Inscribed=false conflict are row errors. Valid rows expose `data.inscriptions` and `inscribed=true`; these four mapping fields never become artifact columns. Original content and translation retain Unicode, whitespace and line breaks. A missing translation stays null. Descriptions never supply literal content.

Preview writes only an owner-scoped job. At most 20 retained jobs per user for 30 days; expired jobs are removed on the next preview. `GET /imports/:id` reloads rows/progress. Commit locks the job, processes at most 25 selected pending valid rows in a transaction, rechecks source/museum identities, and persists row states. Source provider+object ID also has a database unique index. Retrying or concurrent commits cannot import a source identity twice or replace researcher edits. An unexpected database failure rolls back the entire chunk and leaves it retryable; no background worker is assumed. Call commit again while `remaining>0`, with the same selection if selecting rows. Invalid rows remain in the preview with errors. Fix the source file/mapping and create a new preview to correct invalid rows. `skipDuplicates:false` is rejected.

The retained `POST /api/records/import` uses the same bounded multipart and ZIP-expansion checks, a 502-row decoder ceiling, and rejects more than 500 data rows before any writes. Its existing complete-metadata `FIELD_MAP` behavior remains. Sparse sheets that reach the decoder ceiling are rejected rather than importing a silent prefix; remove blank row gaps or split the file. The staged workflow is recommended for preview, provenance and resumable commits.

## Private images and storage

Production upload defaults disabled. External source-link attachments still work and never trigger a backend fetch. `GET /storage/status` returns actual reserved/used bytes and configured limits, not billing estimates or provider credentials.

For a development PC set `NODE_ENV=development`, `IMAGE_STORAGE_DRIVER=local` and optionally `IMAGE_LOCAL_DIRECTORY` to a private persistent directory outside public/static hosting. This adapter refuses production. Authenticated file routes return the exact original bytes or a separate thumbnail, never local paths. Local storage is unsuitable for ephemeral/serverless production filesystems.

The final application package includes the regular pinned `@aws-sdk/client-s3@3.1160.0` dependency in its normal installation. For R2 set externally:

```text
IMAGE_STORAGE_DRIVER=r2
R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com
R2_BUCKET=<private bucket>
R2_ACCESS_KEY_ID=<server-only write/read/delete key>
R2_SECRET_ACCESS_KEY=<server-only secret>
R2_REGION=auto
IMAGE_STORAGE_MAX_BYTES=5368709120
```

The SDK is loaded only when R2 is configured; configuration or build-dependency failures close uploads. The bucket stays private; authenticated approved-account retrieval proxies bounded objects. No client chooses a key or receives server credentials. R2 metadata stays in PostgreSQL; originals/thumbnails stay in R2. Tests inject an SDK command boundary and verify bucket/key/body/length/abort/delete behavior; live R2 has not been verified without credentials. Copying existing private objects between providers is an explicit operator task; changing drivers does not migrate or delete old objects.

Catalog records expose compact `primaryImage` metadata for only the explicitly selected primary image, or null. It contains `{id,url,thumbnailUrl,storageKind,caption}`. Local/R2 URLs use the authenticated application file route; external attachments retain their direct URL. Selection uses a bounded scalar subquery and never expands the list with gallery rows. Clients may fall back to legacy `imageSourceUrl` only when `primaryImage` is null.

Multipart image upload uses `photo`, `rightsConfirmed=true`, and optional caption/credit/license. The whole multipart body is bounded and times out; two admitted uploads per process bound decoder memory. Files must have matching JPEG/PNG/WebP MIME and signatures, fully decode as one frame, and contain at most 20 MP and **4 MiB** original bytes. A separate <=480px WebP thumbnail is generated, while the only original is preserved exactly. APNG/animated WebP, SVG and HTML are rejected. Explicit primary selection uses PATCH `isPrimary:true`, serialized under the parent lock. Each record supports at most 100 image associations.

Persistent quota defaults to 5 GiB and counts originals, thumbnails and pending cleanup reservations. An atomic conditional update serializes quota admission across processes. Failed uploads attempt to delete both objects before releasing their reservation. Cleanup failure keeps bytes reserved. Deleting an image removes only its association; referenced blobs are never deleted. This implementation uses independent generated objects rather than cross-record deduplication.

After a crashed upload or deleting an artifact, the owner may call **`POST /api/research/storage/cleanup`** repeatedly. It cleans at most three unreferenced objects older than one hour per call, using the active driver, then releases their quota. The delay protects in-flight uploads. Provider outages retain reservations for a later retry. No long-lived function or automatic process is required. Keep backups and persistent local data private; operational access to the configured storage directory is trusted.

Hosted uploads deliberately fit a small function request budget. A multipart 4 MiB file plus overhead can still exceed a hosting provider's independent gateway limit. Larger originals need a future direct-to-private-storage upload/reservation/finalization protocol and matching validation; increasing this endpoint's limit or silently recompressing the original is not a substitute.

## Verification

```text
npm.cmd ci
npm.cmd run build
npm.cmd test
```

Tests use account/DB stubs, real parsers/decoder/filesystem and simulated bounded upstream HTTP, without reading auth files. The opt-in PostgreSQL suite is skipped unless both externally supplied `DATABASE_URL` and `RESEARCH_TEST_SCHEMA=research_test_<8+ generated chars>` exist. It requires a **fresh disposable schema already containing baseline tables and migrations 001 plus 002**. It never creates a schema or applies migrations. The suite writes only test fixtures and removes them afterward. Its moderation cases exercise real legacy queries, publication triggers, decisions, restore, role history and a user-lock-synchronized revocation race.

On October 30, 2026, verification passed with 128 backend tests, the separate 17-check PostgreSQL suite, 48 frontend unit tests, frontend lint, both builds, and 25 headless browser checks using actual Clerk sessions and an isolated Neon schema. Five photo-recognition browser checks were skipped because their separate recognition services were not started; the existing real ML metadata bridge was checked. Both migrations were applied twice in disposable schemas, which were removed afterward. No production migration or live R2 verification was performed.

### Reproducing the catalog scale check

```text
npm.cmd run build
npm.cmd run test:scale -- --explain
```

This explicit development command loads the externally configured database connection, creates a uniquely named disposable schema, copies only five baseline public table definitions, applies both migrations twice, seeds 2,000 then 10,000 synthetic records, measures three samples per query path, and removes only its generated schema. It requires schema-creation privileges and consumes database compute/storage while running. Results are saved outside Git at `.local/research-scale-results.json`.

The October 30 run measured the following at 10,000 records, with audit triggers enabled and 5% of records containing one Greek inscription:

| Query path | Returned records | JSON bytes | Median query-path time |
| --- | --- | --- | --- |
| Historical unbounded catalog pattern | 10,000 | 17,025,283 | 677.6 ms |
| Current first page | 24 | 42,026 | 138.3 ms |
| Metadata word search | 24 of 100 matches | 46,984 | 139.5 ms |
| Original Greek text search | 24 of 500 matches | 47,175 | 139.7 ms |

Current pages include inscriptions, object type and primary-image metadata; the historical pattern includes the user relation only. Timings include network round trips and result decoding, exclude transaction setup, JSON byte counting, Clerk and HTTP, and are a small single-client synthetic sample. They are not production capacity or concurrency guarantees. PostgreSQL chose sequential count scans and sort-index page selection in this run; no planner setting forced an index. The schema occupied about 43.1 MB including indexes and revision history. A separate contributor saw zero of the pending fixture records.
