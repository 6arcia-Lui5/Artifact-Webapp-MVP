# Image storage and cost

Museum imports keep image links, source identity, retrieval time, credit and reuse information. They do not copy museum originals or run recognition. Researchers can attach multiple source links or upload photographs they have permission to store. External links can change or disappear; preserve important permitted originals separately when needed.

PostgreSQL stores artifact and image metadata. Image bytes belong in a private Cloudflare R2 Standard bucket. The local filesystem adapter is for development on one PC; it cannot provide a permanent hosted catalog or survive an ephemeral Vercel filesystem. See [backend setup](../backend/RESEARCH_API.md) for configuration, migration and recovery.

## Budget

Cloudflare's published R2 Standard allowance, checked October 29, 2026, is 10 GB-month storage, one million Class A operations and ten million Class B operations per month. Additional storage is $0.015 per GB-month; R2 internet egress is free. Requests above the allowances are billed separately, with provider rounding. The free tier does not cover Infrequent Access storage. [R2 pricing](https://developers.cloudflare.com/r2/pricing/).

Illustrative storage-only estimates use decimal file sizes, a full month of storage and one original per artifact. They exclude thumbnails, backups, provider rounding and request costs:

| Original photographs | Average original | Stored originals | Estimated monthly R2 storage after 10 GB allowance |
| --- | --- | --- | --- |
| 10,000 | 250 kB | 2.5 GB | $0 |
| 100,000 | 250 kB | 25 GB | About $0.23 |
| 100,000 | 2 MB | 200 GB | About $2.85 |

Each uploaded photograph also creates a separate small WebP thumbnail. Multiple photographs per artifact multiply storage. R2 allowances are shared with other use in the account. The application defaults to a conservative **5 GiB quota** counting originals, thumbnails and pending cleanup. Raising it is an explicit backend configuration change; it is not a Cloudflare billing cap. Review the provider's usage and billing dashboard separately.

Private images currently pass through authenticated backend routes. R2's free egress does not make Vercel bandwidth or function execution free. For a small research team this is a practical starting point. If measured traffic or large originals require it, add authenticated short-lived direct downloads/uploads with equivalent ownership, validation and quota checks. Do not make a private bucket public to bypass the application.

## Hosted demonstration

Use the existing frontend/backend hosting and Neon database, plus one private R2 bucket. No Cloudflare Worker or new database provider is required for this implementation. A hosted demonstration requires the explicit database migration and backend R2 configuration; source-link viewing can work with uploads disabled.

### Connecting Hallie's own account later

Keep the current demonstration on its existing storage setting until Hallie has created her Cloudflare account. Her account can own the private R2 Standard bucket used by the shared catalog. There is no separate application namespace to transfer: configure the backend with her R2 account endpoint, bucket name and bucket-scoped read/write credentials, as described in the backend guide. These credentials belong only in backend environment settings, never a browser setting or source control.

Cloudflare storage ownership and application administrator access are separate. Once her approved application login exists, configure its Clerk user ID as an administrator on the backend. Creating a Cloudflare account does not grant access to artifact records.

Changing storage configuration does not transfer photographs. Before switching a catalog that already has local uploads, copy originals and thumbnails to the new bucket, verify their contents and authenticated retrieval, and deliberately update the stored driver/key metadata. Keep the original files and a database backup until that verification is complete. The application refuses to serve objects through a different storage driver; it does not silently move or discard them.

The current upload limit is 4 MiB per photograph, allowing multipart overhead below Vercel's 4.5 MB function request limit. Oversized research originals need a future direct-upload workflow or private offline archive; they must not be silently reduced and presented as preserved originals. [Vercel function limits](https://vercel.com/docs/functions/limitations).

Back up both the database and original image store. Source links and database-only backups do not contain uploaded photographs. Verify backup recovery in a separate environment before relying on the catalog as the sole research archive.

Revision history also consumes database space. Neon currently lists 1 GB of database storage and 100 CU-hours per project on its Free plan. Repeated full snapshots, indexes and long inscriptions can reach that allowance even when R2 image usage is small. Monitor both services; no history is automatically purged. Plan verified archival or paid database capacity before the allowance is exhausted. [Neon pricing](https://neon.com/pricing).
