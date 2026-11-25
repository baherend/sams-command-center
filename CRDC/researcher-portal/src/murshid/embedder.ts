// e5 query embeddings with onnxruntime-web, a port of CRDC/chatbot/rag/embedder.py:
// "query: " prefix, mean pooling over real tokens, L2 normalization.
// Checked against the Python embedder: identical token ids and vectors to 5 decimals.
import type { Embed } from './types.ts'

type Ort = typeof import('onnxruntime-web')

export async function createEmbedder(ort: Ort, modelBytes: Uint8Array, tokenizerJson: object): Promise<Embed> {
  const { Tokenizer } = await import('@huggingface/tokenizers')
  const tok = new Tokenizer(tokenizerJson, {})
  const session = await ort.InferenceSession.create(modelBytes)
  const needsTypes = session.inputNames.includes('token_type_ids')

  return async (question: string) => {
    let ids = tok.encode(`query: ${question}`).ids
    if (ids.length > 512) ids = [...ids.slice(0, 511), ids[ids.length - 1]]
    const n = ids.length
    const feeds: Record<string, InstanceType<Ort['Tensor']>> = {
      input_ids: new ort.Tensor('int64', BigInt64Array.from(ids, (x) => BigInt(x)), [1, n]),
      attention_mask: new ort.Tensor('int64', new BigInt64Array(n).fill(1n), [1, n]),
    }
    if (needsTypes) feeds.token_type_ids = new ort.Tensor('int64', new BigInt64Array(n), [1, n])
    const out = await session.run(feeds)
    const hidden = out[session.outputNames[0]]
    const data = hidden.data as Float32Array
    const dim = hidden.dims[2]
    const v = new Float32Array(dim)
    for (let i = 0; i < n; i++) for (let j = 0; j < dim; j++) v[j] += data[i * dim + j]
    let norm = 0
    for (let j = 0; j < dim; j++) {
      v[j] /= n
      norm += v[j] * v[j]
    }
    norm = Math.sqrt(norm) || 1
    for (let j = 0; j < dim; j++) v[j] /= norm
    return v
  }
}
