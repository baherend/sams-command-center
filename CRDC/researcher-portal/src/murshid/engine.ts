// The Murshid answer engine, ported from CRDC/chatbot/rag/engine.py so it runs in the browser.
//
//   1. guard      – empty / too long
//   2. small talk – greetings and thanks
//   3. journals   – deterministic routing from journals.json
//   4. calculator – page-based fees computed from crdc.fee_schedule, never retrieved or generated
//   5. retrieval  – embeddings + BM25 keywords, fused with Reciprocal Rank Fusion
//   6. gate       – refuse unless one chunk clearly stands out (the anti-hallucination switch)
//   7. answer     – the matched chunk word for word, with its source
//
// There is no text generation, so the assistant cannot invent anything.
import { BM25 } from './bm25.ts'
import { calculate, FEE_SOURCE_AR, FEE_SOURCE_EN, parseCalcRequest, withLiveFees } from './fees.ts'
import type { Fees } from './fees.ts'
import { JournalRouter } from './journals.ts'
import { isArabic, normalize, wordCount } from './text.ts'
import type { Answer, Chunk, Embed, Gate, Lang, MurshidIndex } from './types.ts'

const MAX_QUESTION_CHARS = 500

const GREET = /^(اهلا|مرحبا|السلام عليكم|سلام|هاي|هلو|صباح الخير|مساء الخير|hi|hello|hey|good (morning|evening))(?![\p{L}\p{N}_])/u
const THANKS = /(شكرا|متشكر|تسلم|ميرسي|thanks|thank you)/
const WHY = /ليه|لماذا|لم |علشان ايه|why/
const FEE_Q = /رسوم|بكام|سعر|تكلف|فلوس|مصاريف|ادفع كام|fee|cost|price|how much/
// A fee answer is only given when the question names something the center offers. Without it,
// "رسوم الجيم كام؟" (gym fees) matched the publishing fee table on the word "رسوم" alone.
const SERVICE = /نشر|تحكيم|بحث|ورقه|مقال|تدقيق|لغوي|مراجعه|احصا|تحليل|اقتباس|استلال|تحول|رقمي|دوره|امتحان|اختبار|شهاده|افاده|رساله|صفح|خدم|publish|refere|paper|article|proofread|language|statist|analys|similar|plagiar|digital|course|exam|certificate|thesis|page|service/

export type Mode = 'hybrid' | 'limited'
export type Audience = 'eg' | 'intl' | null

function chunkText(c: Chunk): string {
  return `${c.title}\n${c.keywords.join(' ')}\n${c.text}`
}

function decodeVectors(b64: string, dim: number): Float32Array[] {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const all = new Float32Array(bytes.buffer)
  const out: Float32Array[] = []
  for (let i = 0; i < all.length; i += dim) out.push(all.subarray(i, i + dim))
  return out
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

type Ranked = { id: string; rrf: number; dense: number; bm: number }

export class MurshidEngine {
  private chunks: Chunk[]
  private vectors: Float32Array[]
  private bm25: BM25
  private ids: string[]
  private byKey = new Map<string, Chunk>()
  private router: JournalRouter
  private gate: Gate
  private email: string
  private fees: Fees | null
  private embed: Embed | null
  private audience: Audience
  private medianDense = 0

  constructor(index: MurshidIndex, opts: { fees: Fees | null; embed: Embed | null; audience?: Audience }) {
    this.fees = opts.fees
    this.chunks = opts.fees ? withLiveFees(index.chunks, opts.fees) : index.chunks
    this.vectors = decodeVectors(index.vectors, index.model.dim)
    if (this.vectors.length !== this.chunks.length) throw new Error('Murshid index is out of sync; re-run scripts/export_web.py')
    this.bm25 = new BM25(this.chunks.map(chunkText))
    this.ids = [...new Set(this.chunks.map((c) => c.id))].sort()
    for (const c of this.chunks) this.byKey.set(`${c.id}|${c.lang}`, c)
    this.router = new JournalRouter(index.journals)
    this.gate = index.gate
    this.email = index.center_email
    this.embed = opts.embed
    this.audience = opts.audience ?? null
  }

  get mode(): Mode {
    return this.embed ? 'hybrid' : 'limited'
  }

  /** Attach the embedding model once it has loaded. Until then the engine runs in limited mode:
   *  only greetings, journals and the fee calculator answer. */
  setEmbed(embed: Embed): void {
    this.embed = embed
  }

  private async retrieve(question: string): Promise<Ranked[]> {
    const bm = new Map<string, number>()
    this.bm25.scores(question).forEach((s, i) => {
      const id = this.chunks[i].id
      bm.set(id, Math.max(bm.get(id) ?? 0, s))
    })
    const dense = new Map<string, number>()
    if (this.embed) {
      const q = await this.embed(question)
      this.vectors.forEach((v, i) => {
        let s = 0
        for (let j = 0; j < v.length; j++) s += v[j] * q[j]
        const id = this.chunks[i].id
        dense.set(id, Math.max(dense.get(id) ?? -1, s))
      })
    }
    const order = (m: Map<string, number>) => {
      const r = new Map<string, number>()
      ;[...m.entries()].sort((a, b) => b[1] - a[1]).forEach(([id], i) => r.set(id, i))
      return r
    }
    const dRank = order(dense)
    const bRank = order(bm)
    const rrf = new Map<string, number>()
    for (const id of this.ids) {
      const d = dRank.has(id) ? 1 / (60 + (dRank.get(id) as number)) : 0
      const b = (bm.get(id) ?? 0) > 0 ? 1 / (60 + (bRank.get(id) as number)) : 0
      rrf.set(id, d + b)
    }
    this.medianDense = dense.size ? median([...dense.values()]) : 0
    return [...this.ids]
      .sort((a, b) => (rrf.get(b)! - rrf.get(a)!) || ((dense.get(b) ?? 0) - (dense.get(a) ?? 0)) || ((bm.get(b) ?? 0) - (bm.get(a) ?? 0)))
      .map((id) => ({ id, rrf: rrf.get(id)!, dense: dense.get(id) ?? 0, bm: bm.get(id) ?? 0 }))
  }

  private passes(r: Ranked): boolean {
    const g = this.gate
    // Without the embedding model, keywords alone gave wrong answers on the held-out set
    // (2 wrong, 47% correct), so retrieval answers are switched off until the model loads.
    if (!this.embed) return false
    const margin = r.dense - this.medianDense
    if (r.dense < g.min_dense) return false
    if (margin >= g.strong_margin || r.bm >= g.strong_bm25) return true
    return margin >= g.min_margin && r.bm >= g.min_bm25
  }

  private answer(text: string, route: Answer['route'], answered: boolean, lang: Lang, extra: Partial<Answer> = {}): Answer {
    return { text, route, answered, lang, sources: [], suggestions: [], options: [], score: null, topId: null, ...extra }
  }

  refusal(lang: Lang): string {
    return lang === 'ar'
      ? 'عذرًا، لا أستطيع الإجابة عن هذا السؤال لأن إجابته غير موجودة في الدليل الإجرائي للمركز، وأنا أجيب من الدليل فقط.\n' +
        'يمكنك أن تسألني عن: الخدمات الخمس، الرسوم، الإجراءات، شروط النشر، مواصفات التنسيق، أو متطلبات الدرجة العلمية.\n' +
        `ولأي استفسار آخر تواصل مع المركز على ${this.email}`
      : "Sorry, I can't answer this question because the answer is not in the center's procedural guide, and I only answer from the guide.\n" +
        'You can ask me about: the five services, fees, procedures, publishing requirements, formatting, or degree requirements.\n' +
        `For anything else, contact the center at ${this.email}`
  }

  async ask(question: string): Promise<Answer> {
    const q = (question || '').trim()
    const lang: Lang = isArabic(q) ? 'ar' : 'en'
    if (!q || q.length > MAX_QUESTION_CHARS) {
      return this.answer(lang === 'ar' ? 'من فضلك اكتب سؤالًا قصيرًا (أقل من 500 حرف).' : 'Please write a shorter question (under 500 characters).', 'invalid', false, lang)
    }
    const n = normalize(q)
    if (wordCount(n) <= 4 && GREET.test(n)) {
      return this.answer(lang === 'ar'
        ? 'أهلًا بيك! أنا مرشد، مساعد الباحث في مركز الاستشارات والبحوث والتطوير بأكاديمية السادات. أجيب من الدليل الإجرائي للمركز فقط. اسألني عن الخدمات، الرسوم، الإجراءات، شروط النشر، التنسيق، أو متطلبات درجتك العلمية.'
        : "Hello! I'm Morshed, the researcher's assistant at the Consulting, Research and Development Center, Sadat Academy. I answer only from the center's procedural guide. Ask me about services, fees, procedures, publishing, formatting, or degree requirements.",
      'greeting', true, lang)
    }
    if (wordCount(n) <= 5 && THANKS.test(n)) {
      return this.answer(lang === 'ar' ? 'العفو! لو عندك أي سؤال تاني عن خدمات المركز أنا موجود.' : "You're welcome! Ask me anything else about the center's services.", 'greeting', true, lang)
    }

    if (this.router.wantsRouting(q)) {
      const spec = this.router.match(q)
      const label = lang === 'ar'
        ? 'مجلات المركز – توجيه ' + (this.router.proposed ? 'مقترح في انتظار اعتماد هيئة التحرير' : 'معتمد')
        : 'Center journals – ' + (this.router.proposed ? 'proposed routing, pending editorial approval' : 'approved routing')
      if (spec) {
        return this.answer(this.router.result(spec, lang, this.email), 'journal', true, lang,
          { sources: [{ id: 'journals', title: label, source: label }], topId: 'journal_router' })
      }
      const { text, options } = this.router.chooser(lang)
      return this.answer(text, 'journal', true, lang, { options, topId: 'journal_router' })
    }

    const calc = parseCalcRequest(q)
    if (calc) {
      if (!this.fees) {
        return this.answer(lang === 'ar' ? `تعذّر تحميل جدول الرسوم الآن، فلا أستطيع الحساب. حاول مرة أخرى أو تواصل مع المركز على ${this.email}`
          : `The fee table could not be loaded, so I can't calculate now. Try again or contact ${this.email}`, 'refusal', false, lang,
        { topId: 'fees_unavailable' })
      }
      let note = ''
      if (calc.audiences.length === 2 && this.audience) {
        calc.audiences = [this.audience]
        note = lang === 'ar'
          ? `\n\n(حسبتها لك كباحث ${this.audience === 'eg' ? 'مصري' : 'وافد'} حسب بيانات حسابك.)`
          : `\n\n(Calculated for you as ${this.audience === 'eg' ? 'an Egyptian' : 'an international'} researcher, from your profile.)`
      }
      const src = lang === 'ar' ? FEE_SOURCE_AR : FEE_SOURCE_EN
      return this.answer(calculate(this.fees, calc, lang) + note, 'calculator', true, lang, { sources: [{ id: 'fees', title: src, source: src }] })
    }

    if (!this.embed) {
      return this.answer(lang === 'ar'
        ? 'محرك البحث في الدليل لسه ما اتحمّلش على جهازك، فدلوقتي أقدر أحسب الرسوم وأرشّح المجلة بس. جرّب سؤالك تاني بعد شوية.'
        : "The guide search engine hasn't loaded on your device yet, so for now I can only calculate fees and suggest a journal. Try again shortly.",
      'refusal', false, lang, { topId: 'not_ready' })
    }
    const ranked = await this.retrieve(q)
    let top = ranked[0]
    if (FEE_Q.test(n) && !WHY.test(n) && !top.id.startsWith('oos_')) {
      const fee = ranked.slice(0, 3).find((r) => r.id.startsWith('fees_') && this.passes(r))
      if (fee) top = fee
    }
    const guardWins = ranked.slice(0, 3).some((r) => r.id.startsWith('oos_') && r.bm > top.bm)
    if (top.id.startsWith('oos_') || guardWins || !this.passes(top)) {
      return this.answer(this.refusal(lang), 'refusal', false, lang, { score: top.dense, topId: top.id })
    }
    if (top.id.startsWith('fees_') && !SERVICE.test(n)) {
      const ar = lang === 'ar'
      const options = ar
        ? ['رسوم التحكيم والنشر', 'رسوم التدقيق اللغوي', 'رسوم التحليل الإحصائي', 'رسوم قياس نسبة الاقتباس', 'رسوم شهادة التحول الرقمي']
        : ['Refereeing and publishing fees', 'Proofreading fees', 'Statistical analysis fees', 'Similarity check fees', 'Digital transformation certificate fees']
      return this.answer(ar ? 'تقصد رسوم أنهي خدمة من خدمات المركز؟' : 'Fees for which of the center\'s services?', 'refusal', false, lang,
        { options: options.map((o) => ({ label: o, value: o })), score: top.dense, topId: 'fees_which_service' })
    }
    const chunk = this.byKey.get(`${top.id}|${lang}`)!
    const suggestions = ranked.slice(1, 4)
      .filter((r) => r.id !== top.id && !r.id.startsWith('oos_') && this.passes(r))
      .map((r) => this.byKey.get(`${r.id}|${lang}`)!.title)
      .slice(0, 2)
    return this.answer(chunk.text, 'retrieval', true, lang, {
      sources: [{ id: top.id, title: chunk.title, source: `${lang === 'ar' ? 'المصدر' : 'Source'}: ${chunk.source}` }],
      suggestions, score: top.dense, topId: top.id,
    })
  }
}
