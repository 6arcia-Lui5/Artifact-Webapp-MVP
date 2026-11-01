# Hosted demo setup

The demo runs without any local computer:

- **Website and API:** Vercel projects `artifact-webapp-demo` and `artifact-webapp-demo-api`.
- **Database:** Neon PostgreSQL, `public` schema, with `backend/migrations` applied.
- **Photographs:** private Cloudflare R2 bucket `artifact-catalog-images`.
- **Photo reading:** the Cloudflare Worker in [`cloudflare/handheld-words-catalog-ai`](../cloudflare/handheld-words-catalog-ai). It exposes the `/api/chat` protocol the backend already uses, backed by Workers AI, and requires a bearer token stored as the Worker secret `AI_GATEWAY_TOKEN`.
- **Date and region:** Vercel project `artifact-webapp-ml`, built by [`ml/hosted/build.ps1`](../ml/hosted/build.ps1). It uses the baseline model only, because PyTorch is too large for this hosting. Baseline accuracy is lower than the deep model's; see `ml/reports/comparison.json`.

## Backend settings

Set on the Vercel backend project, never in Git:

- `IMAGE_STORAGE_DRIVER=r2`, `R2_ENDPOINT`, `R2_BUCKET`, `R2_REGION=auto`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `IMAGE_STORAGE_MAX_BYTES`
- `LOCAL_VISION_URL` and `OCR_SERVICE_URL`: the Worker address
- `LOCAL_VISION_TOKEN` and `OCR_SERVICE_TOKEN`: the Worker token
- `LOCAL_VISION_MODEL` and `TRANSCRIPTION_VISION_MODEL=@cf/meta/llama-4-scout-17b-16e-instruct`
- `TRANSCRIPTION_SECONDARY_MODEL=@cf/mistralai/mistral-small-3.1-24b-instruct`
- `ML_SERVICE_URL`: the date/region service address

## Limits

- No OCR engine is hosted, so the site compares two readers and reports the OCR reader as unavailable.
- The Workers Free plan stops at its daily AI allowance and returns errors instead of charging. R2 usage beyond its free allowance can be billed.
- The date/region service has no token. It receives only the submitted text and has no catalog access.

## Moving to another Cloudflare account

Deploy the Worker with `wrangler deploy` and set its secret, create the bucket and token, copy existing R2 objects and verify them, then update the backend settings and redeploy it.
