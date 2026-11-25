// Arabic-aware text helpers. A line-for-line port of CRDC/chatbot/rag/text.py:
// the same normalization and tokens are needed so the browser scores questions exactly like
// the evaluated Python engine.

const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g
const TOKEN = /[a-z0-9%/]+|[ء-ي]+/g
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩'
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹'

// Python's \b treats Arabic letters as word characters; JavaScript's \b does not.
// W is a Unicode "word character" and B a Python-style word boundary, for use inside new RegExp(…, 'u').
const W = '[\\p{L}\\p{N}_]'
export const B = `(?:(?<=${W})(?!${W})|(?<!${W})(?=${W}))`

const STOP = new Set(`
في من على عن الى الي الى ان او و ما ماذا هل هو هي انا انت احنا انتم ده دي دا كده ايه اي
مع لو يا بس كمان عشان علشان اللي الذي التي هذا هذه ذلك تلك كل لا لم لن قد ثم
the a an of to in on for is are be do does i my me you your it this that what how can with and or
مركز اكاديميه باحث center academy researcher
`.split(/\s+/).filter(Boolean))

export function toAsciiDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (d) => {
    const i = ARABIC_DIGITS.indexOf(d)
    return String(i >= 0 ? i : PERSIAN_DIGITS.indexOf(d))
  })
}

export function normalize(s: string): string {
  let t = toAsciiDigits(s || '').toLowerCase().replace(DIACRITICS, '')
  t = t.replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
  return t.replace(/\s+/g, ' ').trim()
}

function lightStem(tok: string): string {
  for (const p of ['وال', 'بال', 'فال', 'كال', 'لل', 'ال']) {
    if (tok.startsWith(p) && tok.length - p.length >= 3) return tok.slice(p.length)
  }
  if (tok.startsWith('و') && tok.length >= 5) return tok.slice(1)
  return tok
}

export function tokenize(s: string): string[] {
  const raw = normalize(s).match(TOKEN) ?? []
  const toks = raw.filter((t) => !STOP.has(t)).map(lightStem)
  return toks.filter((t) => !STOP.has(t) && t.length > 1)
}

export function isArabic(s: string): boolean {
  const ar = (s.match(/[؀-ۿ]/g) ?? []).length
  const lat = (s.match(/[A-Za-z]/g) ?? []).length
  return ar >= lat
}

export function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length
}

export type Segment = { kind: 'text' | 'url' | 'email'; value: string }

const URL_OR_EMAIL = /(https?:\/\/[^\s<>()،,]+[^\s<>()،,.:;!?])|([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g

/** Split text into plain text, URLs and emails, so the widget can render links without innerHTML. */
export function linkSegments(text: string): Segment[] {
  const out: Segment[] = []
  let last = 0
  for (const m of text.matchAll(URL_OR_EMAIL)) {
    const at = m.index ?? 0
    if (at > last) out.push({ kind: 'text', value: text.slice(last, at) })
    out.push(m[1] ? { kind: 'url', value: m[1] } : { kind: 'email', value: m[2] })
    last = at + m[0].length
  }
  if (last < text.length) out.push({ kind: 'text', value: text.slice(last) })
  return out
}
