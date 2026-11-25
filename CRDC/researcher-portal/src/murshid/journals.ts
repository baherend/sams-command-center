// Journal routing, ported from CRDC/chatbot/rag/journals.py. Deterministic: no model picks the journal.
import { normalize, tokenize } from './text.ts'
import type { JournalSpec, JournalsData, Lang, Option } from './types.ts'

const INTENT = new RegExp(
  'انشر فين|انشر في انهي|انشر بحثي فين|انهي مجله|اي مجله|مجله مناسبه|انسب مجله|اختار مجله|المجله المناسبه|' +
  'which journal|where (should|can|do) i publish|where to publish|choose a journal|right journal|suitable journal',
)
const PICK_AR = 'تخصصي:'
const PICK_EN = 'My field:'
const OTHER_AR = 'غير ذلك / مش متأكد'
const OTHER_EN = 'Other / not sure'

function contains(qt: string[], phrase: string): boolean {
  const p = tokenize(phrase)
  const n = p.length
  if (!n) return false
  for (let i = 0; i <= qt.length - n; i++) {
    if (p.every((t, j) => qt[i + j] === t)) return true
  }
  return false
}

export class JournalRouter {
  readonly proposed: boolean
  private data: JournalsData

  constructor(data: JournalsData) {
    this.data = data
    this.proposed = data.routing_status !== 'approved'
  }

  isPick(question: string): boolean {
    const q = question.trim()
    return q.startsWith(PICK_AR) || q.toLowerCase().startsWith(PICK_EN.toLowerCase())
  }

  wantsRouting(question: string): boolean {
    return INTENT.test(normalize(question)) || this.isPick(question)
  }

  /** The specialization, 'other', or null (0 or 2+ matches: ask instead of guessing). */
  match(question: string): JournalSpec | 'other' | null {
    const q = question.trim()
    if (this.isPick(q)) {
      const picked = normalize(q.split(':').slice(1).join(':'))
      if (picked === normalize(OTHER_AR) || picked === normalize(OTHER_EN)) return 'other'
      for (const s of this.data.specializations) {
        if (picked === normalize(s.label_ar) || picked === normalize(s.label_en)) return s
      }
    }
    const toks = tokenize(q)
    const hits = this.data.specializations.filter((s) => [s.label_ar, s.label_en, ...s.kw].some((k) => contains(toks, k)))
    return hits.length === 1 ? hits[0] : null
  }

  chooser(lang: Lang): { text: string; options: Option[] } {
    const ar = lang === 'ar'
    const text = ar ? 'المركز بينشر في مجلتين معتمدتين بتقييم 7/7. علشان أقترح عليك الأنسب، اختار تخصص بحثك:'
      : 'The center publishes in two journals rated 7/7. To suggest the right one, choose your research field:'
    const options = this.data.specializations.map((s) => ({
      label: ar ? s.label_ar : s.label_en,
      value: ar ? `${PICK_AR} ${s.label_ar}` : `${PICK_EN} ${s.label_en}`,
    }))
    options.push({ label: ar ? OTHER_AR : OTHER_EN, value: ar ? `${PICK_AR} ${OTHER_AR}` : `${PICK_EN} ${OTHER_EN}` })
    return { text, options }
  }

  private block(key: string, lang: Lang): string {
    const j = this.data.journals[key]
    return lang === 'ar'
      ? `• ${j.name_ar}\n  ${j.url}\n  مجالاتها: ${j.scope_ar}\n  تصدر: ${j.frequency_ar}`
      : `• ${j.name_en}\n  ${j.url}\n  Fields: ${j.scope_en}\n  Published: ${j.frequency_en}`
  }

  result(spec: JournalSpec | 'other', lang: Lang, email: string): string {
    const ar = lang === 'ar'
    let keys: string[]
    let head: string
    if (spec === 'other') {
      keys = Object.keys(this.data.journals)
      head = ar ? 'مفيش تخصص محدد، فدي المجلتين علشان تقارن بينهم:' : 'No specific field, so here are both journals to compare:'
    } else {
      keys = spec.journals
      const label = ar ? spec.label_ar : spec.label_en
      head = keys.length === 1
        ? (ar ? `لتخصص «${label}»، المجلة المقترحة:` : `For «${label}», the suggested journal is:`)
        : (ar ? `تخصص «${label}» يناسب المجلتين، فاختار حسب موضوع بحثك:` : `«${label}» fits both journals; choose by your paper's topic:`)
    }
    const lines = [head, '', ...keys.map((k) => this.block(k, lang)), '']
    lines.push(this.proposed
      ? (ar ? 'ملحوظة: ده توجيه مبدئي مقترح، والقرار النهائي لهيئة تحرير المجلة.' : "Note: this is a proposed guide; the journal's editorial board makes the final decision.")
      : (ar ? 'القرار النهائي لهيئة تحرير المجلة.' : "The journal's editorial board makes the final decision."))
    lines.push(ar ? `للاستفسار: ${email}` : `Questions: ${email}`)
    return lines.join('\n')
  }
}
