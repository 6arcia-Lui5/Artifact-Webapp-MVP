# Interface simplification review

This branch refines existing catalog workflows. It adds no service, dependency, database table, background job, image archive, or model call.

## Changes to inspect

| Screen | Before | Branch behavior |
| --- | --- | --- |
| Home | Museum, source and review metadata rendered twice per card | Metadata appears once inside each card |
| Search and collections | Text-only results, all filter fields and export actions visible | Existing image loader supplies lazy thumbnails; optional filters, record metadata and exports expand on demand; selected-record actions appear after selection |
| Submission review | Every submission shows its complete inspection and decision form | Each submission expands independently; reviewer administration has a separate collapsed section |
| Photo transcription | Instructions and technical explanations compete with the draft | Editable draft comes first; comparison, machine details, method selection and crop instructions expand when needed |
| Date/place check | Limitations precede results; skipped comparisons can appear all-clear | Suggestions appear first with explicit per-field comparison state and a retryable error; technical details are collapsed |

## Preserved behavior

Filters auto-expand when structured URL filters are active or date validation fails. All existing filter values, signed BCE dates, sorting, pagination, selections, filtered exports and collection actions remain available. Thumbnails reuse existing source/private image handling and fallbacks. They do not copy museum photographs into R2.

Review still requires notes, explicit inspection, current revisions and the existing reviewer permissions. Self-approval rules and conflict handling are unchanged. Approval still differs from research certainty.

Photo drafts still require explicit Add transcription and then saving the artifact. Upload handling remains visible beside photo selection. No-text, truncation, partial-reading notices and failures remain visible. Comparisons and downloadable evidence remain accessible; no automatic acceptance is introduced.

The stored-record ML response adds `comparison.date` and `comparison.region`, each with a `compared` boolean and a `reason` (`missing`, `unrecognized`, `outside_range`, or null). The UI does not infer comparison success from wording in a note. An older response without these fields is presented conservatively as suggestions only.

## Cost and storage

No new Cloudflare Worker, Workers AI call, R2 object, quota setting or database migration. Source thumbnails use existing museum links; existing private thumbnails use existing authenticated image routes. Rendering search images introduces image reads on that screen, so actual user traffic still consumes bandwidth and, for private images, existing storage reads. Source availability and speed depend on the museum. No latency improvement or zero-cost guarantee is claimed.

## Validation

Both application builds, frontend lint, 51 frontend unit tests and 129 backend tests passed. One existing PostgreSQL-dependent test is skipped in the default suite. Added tests distinguish no comparison, partial comparison, checked-without-flags, flagged results, missing/unsupported fields, and separate transcription review states. Existing browser workflows have been updated for the collapsed controls and renamed analysis action.

Rendered desktop/mobile verification and screenshots are produced independently by the parent review task against its isolated local database; they are not implied by these build results. Hosted behavior, image-load timings, client usability and real model accuracy have not been established by this branch.

## Review and rollback

Compare `/`, `/search`, `/review`, and a record's photo-editor/analysis sections with base commit `6ac2448`. No migration is needed. Accept the branch with a normal reviewed merge; reject it by leaving it unmerged. Nothing has been pushed, deployed or applied to the shared catalog by this work.
