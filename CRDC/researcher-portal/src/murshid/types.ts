export type Lang = 'ar' | 'en'

export type Chunk = {
  id: string
  lang: Lang
  title: string
  text: string
  service: string
  source: string
  keywords: string[]
}

export type JournalSpec = {
  id: string
  label_ar: string
  label_en: string
  journals: string[]
  kw: string[]
}

export type Journal = {
  name_ar: string
  name_en: string
  url: string
  frequency_ar: string
  frequency_en: string
  scope_ar: string
  scope_en: string
}

export type JournalsData = {
  routing_status: string
  journals: Record<string, Journal>
  specializations: JournalSpec[]
}

export type Gate = {
  min_dense: number
  min_margin: number
  strong_margin: number
  min_bm25: number
  strong_bm25: number
}

/** The file written by CRDC/chatbot/scripts/export_web.py. */
export type MurshidIndex = {
  version: number
  model: {
    repo: string
    revision: string
    file: string
    dim: number
    // The exact files the vectors were made and evaluated with; any other download is refused.
    model_sha256: string
    model_size: number
    tokenizer_sha256: string
    tokenizer_size: number
  }
  gate: Gate
  center_email: string
  journals: JournalsData
  chunks: Chunk[]
  vectors: string
}

export type Source = { id: string; title: string; source: string }
export type Option = { label: string; value: string }

export type Route = 'greeting' | 'journal' | 'calculator' | 'retrieval' | 'refusal' | 'invalid'

export type Answer = {
  text: string
  route: Route
  answered: boolean
  lang: Lang
  sources: Source[]
  suggestions: string[]
  options: Option[]
  score: number | null
  topId: string | null
}

/** Turns a question into a normalized e5 query vector. */
export type Embed = (question: string) => Promise<Float32Array>
