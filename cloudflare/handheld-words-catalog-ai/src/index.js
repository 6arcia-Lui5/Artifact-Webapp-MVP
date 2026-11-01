// Ollama-compatible /api/chat adapter over Cloudflare Workers AI, so the catalog backend can use hosted
// vision models without code changes. Requires a bearer token. It stores nothing.
const MODELS = new Set((`@cf/meta/llama-4-scout-17b-16e-instruct
@cf/mistralai/mistral-small-3.1-24b-instruct
@cf/moondream/moondream3.1-9B-A2B
@cf/qwen/qwen3.8-27b
@cf/moonshotai/kimi-k2.6
@cf/zai-org/glm-5.3-flash`).split('\n'));
const MAX_BODY = 12 * 1024 * 1024;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function equal(a, b) {
  if (a.length !== b.length) return false;
  let out = 0; for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

// Models may wrap JSON in fences or return prose. Only a schema-shaped object or plain text is accepted.
function toReading(raw) {
  const text = typeof raw === 'string' ? raw : typeof raw?.text === 'string' ? JSON.stringify(raw) : JSON.stringify(raw ?? '');
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = trimmed.indexOf('{'), end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { const o = JSON.parse(trimmed.slice(start, end + 1)); if (typeof o.text === 'string') return { text: o.text, notes: Array.isArray(o.notes) ? o.notes.filter(n => typeof n === 'string').slice(0, 8).map(n => n.slice(0, 300)) : [] }; } catch { /* fall through */ }
  }
  return { text: trimmed.slice(0, 10000), notes: [] };
}

function answerOf(result) {
  if (typeof result?.response === 'string' || (result?.response && typeof result.response === 'object')) return result.response;
  const choice = result?.choices?.[0]?.message; if (choice) return choice.content ?? choice.reasoning_content ?? '';
  if (typeof result?.description === 'string') return result.description;
  return '';
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const auth = request.headers.get('authorization') || '';
    if (!env.AI_GATEWAY_TOKEN || !equal(auth, `Bearer ${env.AI_GATEWAY_TOKEN}`)) return json({ error: 'unauthorized' }, 401);
    if (url.pathname === '/health') return json({ ok: true });
    // No independent OCR engine is hosted; the backend reports this honestly as "OCR reader unavailable".
    if (url.pathname === '/transcribe') return json({ error: 'OCR is not hosted' }, 503);
    if (url.pathname !== '/api/chat' || request.method !== 'POST') return json({ error: 'not found' }, 404);
    if (Number(request.headers.get('content-length') || 0) > MAX_BODY) return json({ error: 'too large' }, 413);
    const body = await request.json().catch(() => null);
    const message = body?.messages?.[0];
    if (!MODELS.has(body?.model) || typeof message?.content !== 'string' || typeof message.images?.[0] !== 'string') return json({ error: 'invalid request' }, 400);
    try {
      const result = await env.AI.run(body.model, {
        messages: [{ role: 'user', content: [{ type: 'text', text: message.content }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${message.images[0]}` } }] }],
        max_tokens: Math.min(Number(body.options?.num_predict) || 2048, 2048), temperature: 0,
      });
      return json({ model: body.model, done: true, done_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(toReading(answerOf(result))) }, usage: result?.usage ?? null });
    } catch (error) {
      return json({ error: 'model failed', detail: String(error?.message || error).slice(0, 300) }, 502);
    }
  },
};
