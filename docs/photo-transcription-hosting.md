# Photo transcription hosting and fallback

Checked against official documentation on October 28, 2026. These are deployment options, not an already hosted transcription service or evidence of inscription-recognition accuracy.

## Launch behavior

Keep the catalog and its database independent of photo recognition. Manual entry, editing, and saving must work when recognition is unconfigured, asleep, busy, or unavailable. A recognition result is an editable draft; it must not overwrite a stored inscription. Date/region review runs on saved text separately.

The intended service boundary is the approved-account backend forwarding a bounded image to one configured, authenticated model service. Keep its URL/token server-side, limit concurrency, and retain form input on errors. A hosted Vercel function cannot reach a researcher's localhost. Do not expose a researcher's Ollama port or make that computer the public site's permanent dependency.

## Free demonstration candidate: Hugging Face ZeroGPU

An eligible personal account can host two free Gradio ZeroGPU Spaces: verified email and account age over 30 days. Current daily GPU allowance is 5 minutes for a signed-in free user or 2 minutes unauthenticated; PRO receives 40 minutes. Queues and remaining quota affect access, and usage resets 24 hours after first use. This is a limited demonstration option, not unlimited free inference. [ZeroGPU eligibility and quotas](https://huggingface.co/docs/hub/spaces-zerogpu)

ZeroGPU requires Gradio and a compatible PyTorch implementation with `@spaces.GPU`; the default GPU function duration is 60 seconds. A persistent Ollama daemon is not a drop-in ZeroGPU deployment. A Qwen or PaddleOCR-VL experiment would need the model's supported Transformers/PyTorch path and a Gradio API adapter. Compatibility, cold-start latency, and faithful ancient-script transcription still need measurement. [ZeroGPU implementation requirements](https://huggingface.co/docs/hub/spaces-zerogpu)

Do not treat one shared backend credential as five researchers' separate free allowances. Confirm which authenticated caller consumes quota during the deployed integration. No shared-service throughput has been measured.

## Predictable inexpensive candidate: paid account, CPU Basic

CPU Basic provides 2 vCPU, 16 GB RAM, and 50 GB temporary disk with no hourly compute charge. However, creating a new Gradio or Docker compute Space now requires a paid account plan; the free ZeroGPU exception above is separate. [Creation and visibility rules](https://huggingface.co/docs/hub/spaces-overview)

Personal PRO is currently listed at $9/month. This could support a small CPU-hosted recognition experiment at a predictable base subscription cost, but latency on that hosted hardware has not been tested. A local two-thread CPU experiment took 132.8 seconds for one plaque crop, exceeding the app's current service timeout; do not select the CPU plan on price alone. Organization ownership requires the appropriate organization plan instead. CPU Basic sleeps after 48 inactive hours; waking and reloading must produce a retryable UI state. Paid GPU hardware adds hourly charges and is not assumed in that $9 estimate. [Account pricing](https://huggingface.co/pricing), [hardware and sleep rules](https://huggingface.co/docs/hub/spaces-gpus)

## Privacy and access before hosting

Public and protected Spaces expose their running app publicly; protected visibility hides source, not the endpoint. Private Spaces restrict the app to their owner/collaborators. The Gradio client supports a Hugging Face token for private Spaces. Store credentials in backend/Space secrets, never frontend variables. Verify the authentication and quota behavior with the intended five-account workflow before selecting a hosted option. [Space visibility and secrets](https://huggingface.co/docs/hub/spaces-overview), [Gradio private-Space access](https://www.gradio.app/docs/python-client/client)

For the first hosted trial, use a small set of public-domain photographs and compare every output with a researcher-checked visible-letter transcription. Record errors, unreadable spans, runtime, cold start, and quota consumption. Do not substitute document-benchmark scores for artifact-photo accuracy.

## Researcher-run fallback

Manual transcription remains available in the website. For a local assisted draft, install [Ollama](https://docs.ollama.com/windows), download an explicitly selected local vision model, and keep the service bound to loopback. For example, the [Qwen3-VL 2B Ollama model](https://ollama.com/library/qwen3-vl:2b-instruct) is a 1.9 GB download; recognition quality on a particular photograph is not guaranteed.

```powershell
ollama pull qwen3-vl:2b-instruct
# Limit the model server itself; separate web instances do not share a lock:
$env:OLLAMA_NUM_PARALLEL="1"
# If Ollama is not already running, start it in another terminal:
ollama serve

python scripts/transcribe-photo-local.py C:/photos/inscription.jpg --model qwen3-vl:2b-instruct --language greek --timeout 300 --output C:/photos/inscription-draft.txt
```

Use `py -3` instead of `python` if that is the installed Windows Python command. The helper uses Python's standard library, sends only to a loopback HTTP address, rejects cloud model tags and redirects, accepts PNG/JPEG/WebP up to 8 MB, and refuses to replace an existing output unless `--force` is explicit. It does not crop or decode the photograph: crop and orient it first in local image software. To use a nondefault local port, add `--url http://127.0.0.1:11439`.

Review the output next to the photograph, correct it, and paste it into the website's original inscription field. The helper does not save to the catalog or call its date/region model. No paid API credential is needed. Keep the Ollama model local; the script's loopback-only connection is not permission to configure a cloud-backed model behind that local service.

Before deciding on launch hosting, confirm the owner account's eligibility, an acceptable monthly cap, expected images per day, model quality on client photographs, and measured CPU/GPU request time. No hosting account, public endpoint, or paid resource was created for this documentation.
