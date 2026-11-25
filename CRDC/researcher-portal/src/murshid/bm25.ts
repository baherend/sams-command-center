// Minimal BM25 keyword search, ported from CRDC/chatbot/rag/bm25.py.
import { tokenize } from './text.ts'

export class BM25 {
  private tf: Map<string, number>[]
  private len: number[]
  private avg: number
  private idf = new Map<string, number>()
  private k1: number
  private b: number

  constructor(docs: string[], k1 = 1.5, b = 0.75) {
    this.k1 = k1
    this.b = b
    const tokens = docs.map(tokenize)
    this.tf = tokens.map((d) => {
      const m = new Map<string, number>()
      for (const t of d) m.set(t, (m.get(t) ?? 0) + 1)
      return m
    })
    this.len = tokens.map((d) => d.length)
    this.avg = this.len.reduce((a, x) => a + x, 0) / Math.max(1, this.len.length)
    const df = new Map<string, number>()
    for (const d of tokens) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1)
    const n = tokens.length
    for (const [t, f] of df) this.idf.set(t, Math.log(1 + (n - f + 0.5) / (f + 0.5)))
  }

  scores(query: string): number[] {
    const q = tokenize(query)
    return this.tf.map((tf, i) => {
      let s = 0
      for (const t of q) {
        const f = tf.get(t)
        if (f) s += (this.idf.get(t) ?? 0) * f * (this.k1 + 1) / (f + this.k1 * (1 - this.b + this.b * this.len[i] / this.avg))
      }
      return s
    })
  }
}
