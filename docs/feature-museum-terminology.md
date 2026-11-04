# Museum terminology and opt-in catalog search

This branch adds a small, cited vocabulary for **finger rings** and **pendant ornaments** in English, French, German and Italian. It runs independently of museum discovery and discovery-decision branches. It does not translate arbitrary queries or search external museum catalogs.

## Use

- Open **Search → Browse terms**, or `/terms`.
- Choose **Search ring terms** or **Search pendant terms**, or type a listed term and select **Include museum terms in other languages**.
- The selected family and actual search terms appear below the query. Source evidence stays under **Museum sources**.
- Turn the checkbox off to restore ordinary full-text search. Unlisted words and compound phrases retain ordinary full-text behavior even when the checkbox is on.

Examples:

| Query | Opt-in | Search terms |
| --- | --- | --- |
| `bague` | off | `bague` |
| `bague` or `anello` | on | `ring` OR `bague` OR `anello` |
| `Anhänger` | on | `pendant` OR `pendentif` OR `Anhänger` OR `pendente` |
| `coin pendant`, `gold bague`, `wine`, `vin`, `bague*` | on | Original query only |

German `Ring` and English `ring` share a case-insensitive spelling and produce only one SQL alternative. Alias recognition normalizes Unicode to NFC and ignores case/outer whitespace; it does not remove accents, guess transliterations, add plurals, stem words, or translate individual words inside a longer phrase. Stored metadata, original inscription text and translations are not rewritten or relabelled. Pre-existing decomposed Unicode in stored search vectors is not migrated.

## Sources and review status

Version `2026-11-04.1` contains terms observed in official museum object records on November 4, 2026. **Holly has not reviewed these mappings.** `source-attested` means the word is present in the cited catalog's object naming; it does not mean the museum endorses our cross-language equivalence or that specialist terminology has been validated. These deliberately broad classes can produce false positives.

| Concept | Language | Term | Object evidence |
| --- | --- | --- | --- |
| Finger ring | English | ring | [Met: Ring of Leontios, object 466087](https://www.metmuseum.org/art/collection/search/466087), title |
| Finger ring | French | bague | [Louvre: Bague, MAO 2000](https://collections.louvre.fr/ark:/53355/cl010319234), Dénomination / Titre |
| Finger ring | German | Ring | [KHM: Ring, Kunstkammer 2201](https://www.khm.at/kunstwerke/ring-88207), Objektbezeichnung |
| Finger ring | Italian | anello | [Musei Reali–Museo di Antichità: national catalog 0100191980](https://catalogo.beniculturali.it/detail/ArchaeologicalProperty/0100191980), OGGETTO |
| Pendant | English | pendant | [Met: Gold Necklace with Pendant Cross, object 464064](https://www.metmuseum.org/art/collection/search/464064), title and pendant dimensions |
| Pendant | French | pendentif | [Louvre: pendentif, E 13511 8 / X 5179](https://collections.louvre.fr/ark:/53355/cl010045032), Dénomination / Titre |
| Pendant | German | Anhänger | [KHM: Kreuz, Antikensammlung XI 1192](https://www.khm.at/kunstwerke/kreuz-72117), Objektbezeichnung |
| Pendant | Italian | pendente | [Musei Reali–Museo di Antichità: national catalog 0100192015](https://catalogo.beniculturali.it/detail/ArchaeologicalProperty/0100192015), OGGETTO |

The Italian records are official Ministry of Culture national catalog entries for the named museum's objects. Direct retrieval of these two catalog pages timed out in the research tool; the official indexed record text was inspected. KHM's ring page returned HTTP 403 on direct retrieval; its official indexed record text was inspected. The other listed pages were directly read. These availability limits do not cause runtime dependencies: the app stores citations and terms, not remote HTML or photographs.

`coin pendant`, pseudo-coin, forgery and other specialist compounds are not mapped. They need specific object evidence and researcher review; do not infer them by combining the broad classes. Future uncertain entries must use a status such as `provisional` and stay excluded from automatic expansion. The current matcher and UI explicitly require `source-attested`.

## API and future glossary contract

Canonical data: `backend/src/research/museumTerms.json`. TypeScript includes it in the backend build. The frontend obtains this same version from authenticated `GET /api/research/terms`; no duplicate dictionary is maintained in the frontend or imported from outside its deployment root.

The response has `version`, `checkedAt`, `clientReviewStatus`, and `concepts`. Each concept has a stable `id`, English `label`, plain-language `scope`, `status`, and `terms`. Each term carries an ISO language code, literal `term`, and a source with museum name, object title/identifier, HTTPS URL and the observed field. These stable IDs and source records can be consumed by a later discovery adapter, but this branch has no dependency on a discovery queue, decisions table, translation service or new database schema.

Existing list and export endpoints accept the additional query parameter `expandTerms=1` (or `0` for off). Other values and repeated/non-string values return HTTP 400. An absent/empty text query continues to list the catalog as before. With opt-in enabled, a whole matching alias becomes a parenthesized OR of at most four parameterized `plainto_tsquery('simple', alias)` conditions against the existing unified search vector. All facets, selected IDs, ownership/approval visibility, sorting and export limits are applied outside that OR. No request text is concatenated into SQL.

The frontend preserves the flag in filter/pagination/sort URLs and export requests; a changed filter resets the page and **Clear filters** removes it. **Language** remains the language of an inscription, not the language of the query. The static term route uses the existing approved-account gate and returns no private artifact data.

## Budget, validation and limits

- No new service, database migration, translation call, AI request, R2 object or externally fetched image. No production data import or deployment is part of this branch.
- One small glossary API response is cached for five minutes by the existing session-scoped React Query client; Search and the term browser share that cache. It can be fetched again after becoming stale or retried once on failure. There are **zero external API calls** for a terminology search.
- Each recognized family adds at most four bounded indexable full-text alternatives (three for ring after deduplication). Performance on large real catalogs is unmeasured; this is not a claim of faster search or improved discovery recall.
- Backend unit tests cover every published alias, opt-in/off, unknown phrases, NFC/case, provisional exclusion, bound injection strings, malformed flags, grouping, filters and visibility. HTTP coverage verifies the glossary's approved-account gate and read-only response. The real-PostgreSQL suite includes indexed metadata/original-text/translation matches, filtered list/export agreement, and contributor isolation in an explicitly supplied disposable schema.
- Frontend unit tests cover all glossary links, canonical recognition, provisional exclusion, URL persistence and reset behavior. Browser validation must additionally exercise the checkbox, term links, source disclosure, filters/reload, and a mobile viewport before declaring the rendered feature verified.
- Technical tests establish behavior, not scholarly acceptance. A representative researcher-labelled set and Holly's terminology review are still needed before claiming better search quality.

Rollback is the branch's code commit; it requires no database rollback. Existing search remains available by omitting `expandTerms`.
