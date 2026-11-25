// Fees: ported from CRDC/chatbot/rag/fees.py.
// In the portal every number comes from the database table crdc.fee_schedule (fromSchedule).
// knowledge/fees.json is only used by the offline evaluation, and scripts/export_web.py refuses to
// export when it disagrees with the fee_schedule reference rows.
import { B, normalize } from './text.ts'
import type { Chunk } from './types.ts'

export type FeeSet = {
  currency_ar: string
  currency_en: string
  refereeing: number
  publishing: number
  paper_pages: number
  paper_extra_page: number
  certificate: number
  proof_ar_base: number
  proof_ar_extra: number
  proof_en_base: number
  proof_en_extra: number
  thesis_pages: number
  stat_review: number
  stat_analysis: number
  similarity: number
  digital_course_exam: number
  digital_exam_only: number
  digital_redo: number | null
}
export type Fees = { eg: FeeSet; intl: FeeSet }
type Aud = keyof Fees

export type FeeRow = {
  option_code: string
  applicant_type: 'egyptian' | 'foreign'
  base_fee: number | string
  included_pages: number | null
  extra_page_fee: number | string | null
  certificate_fee: number | string
}

const CURRENCY: Record<Aud, Pick<FeeSet, 'currency_ar' | 'currency_en'>> = {
  eg: { currency_ar: 'جنيه مصري', currency_en: 'EGP' },
  intl: { currency_ar: 'دولار أمريكي', currency_en: 'USD' },
}

/** Build the fee table from crdc.fee_schedule rows. Throws if a fee the assistant quotes is missing. */
export function fromSchedule(rows: FeeRow[]): Fees {
  const pick = (aud: Aud): FeeSet => {
    const app = aud === 'eg' ? 'egyptian' : 'foreign'
    const by = new Map(rows.filter((r) => r.applicant_type === app).map((r) => [r.option_code, r]))
    const get = (code: string) => {
      const r = by.get(code)
      if (!r) throw new Error(`fee_schedule has no ${code} row for ${app}`)
      return r
    }
    const n = (v: number | string | null | undefined) => Number(v ?? 0)
    const pub = get('PUB_PUBLISH')
    const lar = get('LANG_AR')
    const len = get('LANG_EN')
    const retake = by.get('DT_RETAKE')
    return {
      ...CURRENCY[aud],
      refereeing: n(get('PUB_ARBITRATION').base_fee),
      publishing: n(pub.base_fee),
      paper_pages: n(pub.included_pages),
      paper_extra_page: n(pub.extra_page_fee),
      certificate: n(pub.certificate_fee),
      proof_ar_base: n(lar.base_fee),
      proof_ar_extra: n(lar.extra_page_fee),
      proof_en_base: n(len.base_fee),
      proof_en_extra: n(len.extra_page_fee),
      thesis_pages: n(lar.included_pages),
      stat_review: n(get('STAT_REVIEW').base_fee),
      stat_analysis: n(get('STAT_ANALYSIS').base_fee),
      similarity: n(get('PLAG').base_fee),
      digital_course_exam: n(get('DT_COURSE_EXAM').base_fee),
      digital_exam_only: n(get('DT_EXAM_ONLY').base_fee),
      digital_redo: retake ? n(retake.base_fee) : null,
    }
  }
  return { eg: pick('eg'), intl: pick('intl') }
}

const fmt = (x: number) => x.toLocaleString('en-US')

// ---------------------------------------------------------------------------
// 1) Fee chunks (text shown to the user, built from the live fee table)
// ---------------------------------------------------------------------------
type Lang = 'ar' | 'en'

function pubLines(f: FeeSet, lang: Lang): string[] {
  const c = lang === 'ar' ? f.currency_ar : f.currency_en
  const together = f.refereeing + f.publishing + f.certificate
  if (lang === 'ar') {
    const l = [`• رسوم التحكيم: ${fmt(f.refereeing)} ${c}`,
      `• رسوم النشر للبحث حتى ${f.paper_pages} صفحة: ${fmt(f.publishing)} ${c}` + (f.certificate ? '' : ' (شاملة الإفادة)'),
      `• كل صفحة زيادة عن ${f.paper_pages} صفحة: ${fmt(f.paper_extra_page)} ${c}`]
    if (f.certificate) l.push(`• رسوم الإفادة: ${fmt(f.certificate)} ${c}`)
    l.push(`• الإجمالي للتحكيم والنشر معًا لبحث حتى ${f.paper_pages} صفحة: ${fmt(together)} ${c}`)
    return l
  }
  const l = [`• Refereeing fee: ${c} ${fmt(f.refereeing)}`,
    `• Publishing fee for a paper up to ${f.paper_pages} pages: ${c} ${fmt(f.publishing)}` + (f.certificate ? '' : ' (certificate included)'),
    `• Each page beyond ${f.paper_pages} pages: ${c} ${fmt(f.paper_extra_page)}`]
  if (f.certificate) l.push(`• Certificate fee: ${c} ${fmt(f.certificate)}`)
  l.push(`• Total for refereeing and publishing together, paper up to ${f.paper_pages} pages: ${c} ${fmt(together)}`)
  return l
}

function lingLines(f: FeeSet, lang: Lang): string[] {
  const c = lang === 'ar' ? f.currency_ar : f.currency_en
  const p = f.thesis_pages
  if (lang === 'ar') {
    const inc = f.certificate ? '' : ' (شاملة إدخال التعديلات والإفادة)'
    const l = [`• التدقيق اللغوي باللغة العربية حتى ${p} صفحة: ${fmt(f.proof_ar_base)} ${c}${inc}، و${fmt(f.proof_ar_extra)} ${c} لكل صفحة زيادة`,
      `• التدقيق اللغوي باللغة الإنجليزية حتى ${p} صفحة: ${fmt(f.proof_en_base)} ${c}${inc}، و${fmt(f.proof_en_extra)} ${c} لكل صفحة زيادة`]
    if (f.certificate) l.push(`• رسوم الإفادة: ${fmt(f.certificate)} ${c}`)
    return l
  }
  const inc = f.certificate ? '' : ' (includes entering corrections and the certificate)'
  const l = [`• Arabic proofreading up to ${p} pages: ${c} ${fmt(f.proof_ar_base)}${inc}, plus ${c} ${fmt(f.proof_ar_extra)} per extra page`,
    `• English proofreading up to ${p} pages: ${c} ${fmt(f.proof_en_base)}${inc}, plus ${c} ${fmt(f.proof_en_extra)} per extra page`]
  if (f.certificate) l.push(`• Certificate fee: ${c} ${fmt(f.certificate)}`)
  return l
}

function statLines(f: FeeSet, lang: Lang): string[] {
  const c = lang === 'ar' ? f.currency_ar : f.currency_en
  if (lang === 'ar') {
    const inc = f.certificate ? '' : ' (شاملة الإفادة)'
    const l = [`• المراجعة الإحصائية عن كامل الرسالة: ${fmt(f.stat_review)} ${c}${inc}`,
      `• التحليل الإحصائي عن كامل الرسالة: ${fmt(f.stat_analysis)} ${c}${inc}`]
    if (f.certificate) l.push(`• رسوم الإفادة لكل خدمة: ${fmt(f.certificate)} ${c}`)
    return l
  }
  const inc = f.certificate ? '' : ' (certificate included)'
  const l = [`• Statistical review, whole thesis: ${c} ${fmt(f.stat_review)}${inc}`,
    `• Statistical analysis, whole thesis: ${c} ${fmt(f.stat_analysis)}${inc}`]
  if (f.certificate) l.push(`• Certificate fee for each service: ${c} ${fmt(f.certificate)}`)
  return l
}

function digLines(f: FeeSet, lang: Lang): string[] {
  const c = lang === 'ar' ? f.currency_ar : f.currency_en
  if (lang === 'ar') {
    const l = [`• الدورة + الاختبارات: ${fmt(f.digital_course_exam)} ${c}`, `• الاختبارات فقط: ${fmt(f.digital_exam_only)} ${c}`]
    if (f.digital_redo) l.push(`• إعادة الاختبار أو طلب شهادة أخرى أو تعديل بيانات الشهادة: ${fmt(f.digital_redo)} ${c}`)
    return l
  }
  const l = [`• Course + exams: ${c} ${fmt(f.digital_course_exam)}`, `• Exams only: ${c} ${fmt(f.digital_exam_only)}`]
  if (f.digital_redo) l.push(`• Exam retake, another certificate, or changing certificate data: ${c} ${fmt(f.digital_redo)}`)
  return l
}

function citLines(f: FeeSet, lang: Lang): string[] {
  const c = lang === 'ar' ? f.currency_ar : f.currency_en
  return [lang === 'ar' ? `• قياس نسبة الاقتباس عن كامل الرسالة: ${fmt(f.similarity)} ${c}`
    : `• Similarity measurement, whole thesis: ${c} ${fmt(f.similarity)}`]
}

const SECTIONS: Record<string, { ar: string; en: string; build: (f: FeeSet, l: Lang) => string[] }> = {
  fees_pub: { ar: 'رسوم تحكيم ونشر الأبحاث', en: 'Refereeing and publishing fees', build: pubLines },
  fees_ling: { ar: 'رسوم التدقيق اللغوي', en: 'Language proofreading fees', build: lingLines },
  fees_stat: { ar: 'رسوم التحليل الإحصائي والمراجعة الإحصائية', en: 'Statistical analysis and review fees', build: statLines },
  fees_dig: { ar: 'رسوم شهادة أساسيات التحول الرقمي', en: 'Digital Transformation certificate fees', build: digLines },
  fees_cit: { ar: 'رسوم قياس نسبة الاقتباس', en: 'Similarity measurement fees', build: citLines },
}

export const FEE_SOURCE_AR = 'الدليل الإجرائي – جدول الرسوم (من جدول رسوم المركز في قاعدة البيانات)'
export const FEE_SOURCE_EN = 'Procedural guide – Fee table (from the center fee table in the database)'

/** Rewrite the text of the exported fee chunks with numbers from the live fee table. */
export function withLiveFees(chunks: Chunk[], fees: Fees): Chunk[] {
  return chunks.map((c) => {
    const s = SECTIONS[c.id]
    if (!s) return c
    const ar = c.lang === 'ar'
    const lines = ar
      ? [`${s.ar}:`, '', 'للباحث المصري (تُسدَّد في خزينة الأكاديمية بالجنيه المصري):', ...s.build(fees.eg, 'ar'),
        '', 'للباحث الوافد (تُسدَّد في البنك المعتمد بالدولار الأمريكي):', ...s.build(fees.intl, 'ar')]
      : [`${s.en}:`, '', 'Egyptian researchers (paid at the Academy treasury in EGP):', ...s.build(fees.eg, 'en'),
        '', 'International researchers (paid at the approved bank in USD):', ...s.build(fees.intl, 'en')]
    if (c.id === 'fees_pub') {
      lines.push('', ar ? 'رسوم التحكيم والنشر تُدفع معًا مرة واحدة تسهيلًا على الباحثين. وأي فروق في عدد الصفحات تُسدَّد قبل استلام الإفادات النهائية.'
        : 'Refereeing and publishing fees are paid together at once as a facilitation for researchers. Any page difference is paid before receiving the final certificates.')
    }
    if (c.id === 'fees_ling') {
      lines.push('', ar ? 'أي فروق في عدد الصفحات تُسدَّد قبل استلام الإفادات النهائية.' : 'Any page difference is paid before receiving the final certificates.')
    }
    return { ...c, text: lines.join('\n'), source: ar ? FEE_SOURCE_AR : FEE_SOURCE_EN }
  })
}

// ---------------------------------------------------------------------------
// 2) Calculator: deterministic, page-dependent services only
// ---------------------------------------------------------------------------
const PAGES = new RegExp(`(\\d{1,4})\\s*(?:صفحه|صفحات|ص${B}|pages?${B}|pg${B}|p${B})`, 'u')
const ANY_NUM = new RegExp(`${B}(\\d{1,4})${B}`, 'u')
const FEE_INTENT = /رسوم|بكام|كام|سعر|تكلف|فلوس|مصاريف|احسب|حساب|هدفع|ادفع|اجمالي|fee|cost|price|how much|calculat|total|pay/
const PROOF = /تدقيق|لغوي|لغويه|proofread|language review/
const PUB = /نشر|تحكيم|بحث|ورقه|مقال|publish|publication|referee|paper|article/
const INTL = /وافد|اجنبي|دولار|international|foreign|usd|dollar/
const EG = /مصري|جنيه|egyptian|egp|pound/
const EN_THESIS = /انجليز|english/
const AR_THESIS = /عربي|عربيه|arabic/

export type CalcRequest = { service: 'pub' | 'proof'; pages: number; audiences: Aud[]; langs: Lang[] | null }

export function parseCalcRequest(question: string): CalcRequest | null {
  const q = normalize(question)
  if (!FEE_INTENT.test(q) && !(PAGES.test(q) && PROOF.test(q))) return null
  let service: CalcRequest['service']
  if (PROOF.test(q)) service = 'proof'
  else if (PUB.test(q)) service = 'pub'
  else return null
  const m = q.match(PAGES) ?? q.match(ANY_NUM)
  if (!m) return null
  const pages = Number(m[1])
  if (pages < 1 || pages > 2000) return null
  const intl = INTL.test(q), eg = EG.test(q)
  const audiences: Aud[] = intl && !eg ? ['intl'] : eg && !intl ? ['eg'] : ['eg', 'intl']
  let langs: Lang[] | null = null
  if (service === 'proof') {
    const en = EN_THESIS.test(q), ar = AR_THESIS.test(q)
    langs = en && !ar ? ['en'] : ar && !en ? ['ar'] : ['ar', 'en']
  }
  return { service, pages, audiences, langs }
}

export function calculate(fees: Fees, req: CalcRequest, outLang: Lang): string {
  const ar = outLang === 'ar'
  const who = { eg: ['باحث مصري', 'Egyptian researcher'], intl: ['باحث وافد', 'International researcher'] }
  const blocks: string[] = []
  const { pages } = req
  for (const a of req.audiences) {
    const f = fees[a]
    const c = ar ? f.currency_ar : f.currency_en
    const money = (x: number) => (ar ? `${fmt(x)} ${c}` : `${c} ${fmt(x)}`)
    const total = (items: [string, number][]) => items.reduce((s, [, v]) => s + v, 0)
    if (req.service === 'pub') {
      const extra = Math.max(0, pages - f.paper_pages)
      const items: [string, number][] = [
        [ar ? 'رسوم التحكيم' : 'Refereeing fee', f.refereeing],
        [ar ? `رسوم النشر (حتى ${f.paper_pages} صفحة)${f.certificate ? '' : ' شاملة الإفادة'}`
          : `Publishing fee (up to ${f.paper_pages} pages)${f.certificate ? '' : ', certificate included'}`, f.publishing],
      ]
      if (extra) items.push([ar ? `صفحات زيادة (${extra} × ${fmt(f.paper_extra_page)})` : `Extra pages (${extra} × ${fmt(f.paper_extra_page)})`, extra * f.paper_extra_page])
      if (f.certificate) items.push([ar ? 'رسوم الإفادة' : 'Certificate fee', f.certificate])
      const head = ar ? `تحكيم ونشر بحث ${pages} صفحة — ${who[a][0]}:` : `Refereeing and publishing a ${pages}-page paper — ${who[a][1]}:`
      blocks.push([head, ...items.map(([k, v]) => `• ${k}: ${money(v)}`), ar ? `الإجمالي: ${money(total(items))}` : `Total: ${money(total(items))}`].join('\n'))
    } else {
      for (const lg of req.langs ?? ['ar']) {
        const extra = Math.max(0, pages - f.thesis_pages)
        const [base, per] = lg === 'en' ? [f.proof_en_base, f.proof_en_extra] : [f.proof_ar_base, f.proof_ar_extra]
        const items: [string, number][] = [[ar ? `التدقيق اللغوي حتى ${f.thesis_pages} صفحة${f.certificate ? '' : ' (شامل الإفادة)'}`
          : `Proofreading up to ${f.thesis_pages} pages${f.certificate ? '' : ' (certificate included)'}`, base]]
        if (extra) items.push([ar ? `صفحات زيادة (${extra} × ${fmt(per)})` : `Extra pages (${extra} × ${fmt(per)})`, extra * per])
        if (f.certificate) items.push([ar ? 'رسوم الإفادة' : 'Certificate fee', f.certificate])
        const lname = ar ? (lg === 'en' ? 'الإنجليزية' : 'العربية') : (lg === 'en' ? 'English' : 'Arabic')
        const head = ar ? `تدقيق لغوي لرسالة باللغة ${lname}، ${pages} صفحة — ${who[a][0]}:` : `${lname} proofreading of a ${pages}-page thesis — ${who[a][1]}:`
        blocks.push([head, ...items.map(([k, v]) => `• ${k}: ${money(v)}`), ar ? `الإجمالي: ${money(total(items))}` : `Total: ${money(total(items))}`].join('\n'))
      }
    }
  }
  const note: string[] = []
  if (req.service === 'pub') note.push(ar ? 'رسوم التحكيم والنشر تُدفع معًا مرة واحدة تسهيلًا على الباحثين.' : 'Refereeing and publishing fees are paid together at once as a facilitation for researchers.')
  if (req.audiences.length === 2) note.push(ar ? 'الرسوم مختلفة للباحث المصري والوافد، فعرضت الحالتين. قل لي «مصري» أو «وافد» لو تحب حالة واحدة.'
    : 'Fees differ for Egyptian and international researchers, so both are shown.')
  return [...blocks, ...note].join('\n\n')
}
