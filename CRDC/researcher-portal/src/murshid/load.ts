// Browser loading for Murshid: the exported index, the live fee table, and the embedding model.
// Nothing here needs a server of ours: the index ships with the portal, fees come from Supabase
// (RLS: authenticated users read active fee rows), and the model is downloaded once from the
// Hugging Face Hub and kept in the browser cache.
import type { SupabaseClient } from '@supabase/supabase-js'
import { fromSchedule } from './fees.ts'
import type { Fees, FeeRow } from './fees.ts'
import type { Embed, MurshidIndex } from './types.ts'

const CACHE = 'murshid-model-v2'

export async function loadIndex(): Promise<MurshidIndex> {
  const res = await fetch(`${import.meta.env.BASE_URL}murshid/index.json`)
  if (!res.ok) throw new Error(`Murshid index: HTTP ${res.status}`)
  return res.json()
}

/** Fees from crdc.fee_schedule; null when they cannot be read (the calculator then says so). */
// Fees come from crdc_public.get_catalog(), which signed-out visitors and signed-in users can
// both call. The direct table read is kept as a fallback for a database without that function.
export async function loadFees(client: SupabaseClient | null): Promise<Fees | null> {
  if (!client) return null
  let rows: FeeRow[] | null = null
  const catalog = await client.schema('crdc_public').rpc('get_catalog')
  if (!catalog.error && catalog.data && Array.isArray((catalog.data as { fees?: unknown }).fees)) {
    rows = (catalog.data as { fees: FeeRow[] }).fees
  } else {
    const { data, error } = await client.schema('crdc').from('fee_schedule')
      .select('option_code, applicant_type, base_fee, included_pages, extra_page_fee, certificate_fee')
    if (!error && data) rows = data as FeeRow[]
  }
  if (!rows) return null
  try {
    return fromSchedule(rows)
  } catch {
    return null
  }
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export class IntegrityError extends Error {}

/** Download a file once (Cache API), and refuse it unless its size and SHA-256 match the pinned values. */
async function verifiedBytes(url: string, expect: { sha256: string; size: number },
  onBytes: (loaded: number, total: number) => void): Promise<Uint8Array> {
  let cache: Cache | null = null
  try {
    cache = await caches.open(CACHE)
  } catch {
    cache = null   // private mode or no Cache API: download every time
  }
  const hit = await cache?.match(url).catch(() => undefined)
  if (hit) {
    const buf = new Uint8Array(await hit.arrayBuffer())
    if (buf.length === expect.size && await sha256Hex(buf) === expect.sha256) {
      onBytes(buf.length, buf.length)
      return buf
    }
    await cache?.delete(url)   // stale or corrupted copy: fetch again
  }
  const buf = await download(url, expect.size, onBytes)
  if (buf.length !== expect.size || await sha256Hex(buf) !== expect.sha256) {
    throw new IntegrityError(`${url} does not match the pinned SHA-256; refusing to run it`)
  }
  try {
    await cache?.put(url, new Response(buf as BodyInit))
  } catch {
    // quota exceeded: still usable for this visit
  }
  return buf
}

async function download(url: string, maxBytes: number, onBytes: (loaded: number, total: number) => void): Promise<Uint8Array> {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length') ?? 0)
  const reader = res.body.getReader()
  const parts: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    loaded += value.length
    if (loaded > maxBytes) {
      await reader.cancel()
      throw new IntegrityError(`${url} is larger than the pinned file; refusing it`)
    }
    onBytes(loaded, total)
  }
  const buf = new Uint8Array(loaded)
  let at = 0
  for (const p of parts) {
    buf.set(p, at)
    at += p.length
  }
  return buf
}

/** Download (or read from cache) the quantized e5 model and build the query embedder. */
export async function loadEmbedder(index: MurshidIndex, onProgress: (fraction: number) => void): Promise<Embed> {
  // VITE_MURSHID_MODEL_BASE lets the team self-host the model files (same layout as the Hub repo).
  const m = index.model
  const base = import.meta.env.VITE_MURSHID_MODEL_BASE || `https://huggingface.co/${m.repo}/resolve/${m.revision}/`
  // Vite bundles onnxruntime's .wasm file with the portal, so it is served from our own domain.
  // One thread: multi-threading needs cross-origin isolation headers the portal does not set.
  const ort = await import('onnxruntime-web/wasm')
  ort.env.wasm.numThreads = 1
  // tokenizer.json is about 17 MB and the model about 118 MB: weight the progress bar accordingly.
  // Both files are checked against the SHA-256 recorded at export time (the files the evaluation ran on).
  const tokBytes = await verifiedBytes(base + 'tokenizer.json', { sha256: m.tokenizer_sha256, size: m.tokenizer_size },
    (l) => onProgress(0.13 * l / m.tokenizer_size))
  const tokenizer = JSON.parse(new TextDecoder().decode(tokBytes))
  const model = await verifiedBytes(base + m.file, { sha256: m.model_sha256, size: m.model_size },
    (l) => onProgress(0.13 + 0.87 * l / m.model_size))
  const { createEmbedder } = await import('./embedder.ts')
  return createEmbedder(ort, model, tokenizer)
}
