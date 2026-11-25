import feesData from '../../chatbot/knowledge/fees.json'
import journalsData from '../../chatbot/knowledge/journals.json'

export type QuickOption = {
  label: string
  value: string
}

export type LocalToolReply = {
  text: string
  options?: QuickOption[]
  links?: { label: string; url: string }[]
}

const DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g
const TOKEN_RE = /[a-z0-9%/]+|[ء-ي]+/g
const STOP_WORDS = new Set([
  'في', 'من', 'على', 'عن', 'الى', 'الي', 'ان', 'او', 'و', 'ما', 'ماذا', 'هل',
  'هو', 'هي', 'انا', 'انت', 'احنا', 'انتم', 'ده', 'دي', 'دا', 'كده', 'ايه', 'اي',
  'مع', 'لو', 'يا', 'بس', 'كمان', 'عشان', 'علشان', 'اللي', 'الذي', 'التي',
  'هذا', 'هذه', 'ذلك', 'تلك', 'كل', 'لا', 'لم', 'لن', 'قد', 'ثم',
  'the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'be', 'do', 'does',
  'i', 'my', 'me', 'you', 'your', 'it', 'this', 'that', 'what', 'how', 'can', 'with', 'and', 'or',
  'مركز', 'اكاديميه', 'باحث', 'center', 'academy', 'researcher',
])

function toAsciiDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (d) => {
    const code = d.charCodeAt(0)
    if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660)
    if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0)
    return d
  })
}

export function normalizeText(s: string): string {
  return toAsciiDigits(s || '')
    .toLowerCase()
    .replace(DIACRITICS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim()
}

function lightStem(tok: string): string {
  for (const p of ['وال', 'بال', 'فال', 'كال', 'لل', 'ال']) {
    if (tok.startsWith(p) && tok.length - p.length >= 3) {
      return tok.slice(p.length)
    }
  }
  if (tok.startsWith('و') && tok.length >= 5) {
    return tok.slice(1)
  }
  return tok
}

function tokenize(s: string): string[] {
  const matches = normalizeText(s).match(TOKEN_RE) || []
  return matches
    .filter((t) => !STOP_WORDS.has(t))
    .map(lightStem)
    .filter((t) => !STOP_WORDS.has(t) && t.length > 1)
}

function isArabic(s: string): boolean {
  const ar = (s.match(/[\u0600-\u06FF]/g) || []).length
  const lat = (s.match(/[A-Za-z]/g) || []).length
  return ar >= lat
}

function formatNum(n: number): string {
  return n.toLocaleString('en-US')
}

// ============================================================================
// 1. حاسبة الرسوم (Fee Calculator)
// ============================================================================
const PAGES_RE = /(\d{1,4})\s*(?:صفحه|صفحات|ص\b|pages?\b|pg\b|p\b)/
const ANY_NUM_RE = /\b(\d{1,4})\b/
const FEE_INTENT_RE = /رسوم|بكام|كام|سعر|تكلف|فلوس|مصاريف|احسب|حساب|هدفع|ادفع|اجمالي|fee|cost|price|how much|calculat|total|pay/
const PROOF_RE = /تدقيق|لغوي|لغويه|proofread|language review/
const PUB_RE = /نشر|تحكيم|بحث|ورقه|مقال|publish|referee|paper|article/
const INTL_RE = /وافد|اجنبي|دولار|international|foreign|usd|dollar/
const EG_RE = /مصري|جنيه|egyptian|egp|pound/
const EN_THESIS_RE = /انجليز|english/
const AR_THESIS_RE = /عربي|عربيه|arabic/

function tryFeeCalculator(
  question: string,
  portalAudience: 'egyptian' | 'expat' | 'staff' | 'all'
): LocalToolReply | null {
  const q = normalizeText(question)
  if (!FEE_INTENT_RE.test(q) && !(PAGES_RE.test(q) && PROOF_RE.test(q))) {
    return null
  }

  let service: 'proof' | 'pub' | null = null
  if (PROOF_RE.test(q)) service = 'proof'
  else if (PUB_RE.test(q)) service = 'pub'
  else return null

  const m = q.match(PAGES_RE) || q.match(ANY_NUM_RE)
  if (!m || !m[1]) return null

  const pages = parseInt(m[1], 10)
  if (pages < 1 || pages > 2000) return null

  let audiences: ('eg' | 'intl')[]
  if (INTL_RE.test(q) && !EG_RE.test(q)) {
    audiences = ['intl']
  } else if (EG_RE.test(q) && !INTL_RE.test(q)) {
    audiences = ['eg']
  } else if (portalAudience === 'egyptian') {
    audiences = ['eg']
  } else if (portalAudience === 'expat') {
    audiences = ['intl']
  } else {
    audiences = ['eg', 'intl']
  }

  let langs: ('ar' | 'en')[] = ['ar', 'en']
  if (service === 'proof') {
    const en = EN_THESIS_RE.test(q)
    const ar = AR_THESIS_RE.test(q)
    if (en && !ar) langs = ['en']
    else if (ar && !en) langs = ['ar']
  }

  const outAr = isArabic(question)
  const who = {
    eg: outAr ? 'باحث مصري' : 'Egyptian researcher',
    intl: outAr ? 'باحث وافد' : 'International researcher',
  }

  const blocks: string[] = []

  for (const a of audiences) {
    const f = feesData[a]
    const c = outAr ? f.currency_ar : f.currency_en
    const money = (x: number) => (outAr ? `${formatNum(x)} ${c}` : `${c} ${formatNum(x)}`)

    if (service === 'pub') {
      const extra = Math.max(0, pages - f.paper_pages)
      const items: [string, number][] = [
        [outAr ? 'رسوم التحكيم' : 'Refereeing fee', f.refereeing],
        [
          outAr
            ? `رسوم النشر (حتى ${f.paper_pages} صفحة)${f.certificate ? '' : ' شاملة الإفادة'}`
            : `Publishing fee (up to ${f.paper_pages} pages)${f.certificate ? '' : ', certificate included'}`,
          f.publishing,
        ],
      ]
      if (extra > 0) {
        items.push([
          outAr
            ? `صفحات زيادة (${extra} × ${formatNum(f.paper_extra_page)})`
            : `Extra pages (${extra} × ${formatNum(f.paper_extra_page)})`,
          extra * f.paper_extra_page,
        ])
      }
      if (f.certificate) {
        items.push([outAr ? 'رسوم الإفادة' : 'Certificate fee', f.certificate])
      }

      const total = items.reduce((acc, [, v]) => acc + v, 0)
      const head = outAr
        ? `تحكيم ونشر بحث ${pages} صفحة — ${who[a]}:`
        : `Refereeing and publishing a ${pages}-page paper — ${who[a]}:`
      const lines = [
        head,
        ...items.map(([label, val]) => `• ${label}: ${money(val)}`),
        outAr ? `الإجمالي: ${money(total)}` : `Total: ${money(total)}`,
      ]
      blocks.push(lines.join('\n'))
    } else {
      for (const lg of langs) {
        const extra = Math.max(0, pages - f.thesis_pages)
        const base = lg === 'en' ? f.proof_en_base : f.proof_ar_base
        const per = lg === 'en' ? f.proof_en_extra : f.proof_ar_extra
        const lname = outAr
          ? lg === 'en'
            ? 'الإنجليزية'
            : 'العربية'
          : lg === 'en'
          ? 'English'
          : 'Arabic'

        const items: [string, number][] = [
          [
            outAr
              ? `التدقيق اللغوي حتى ${f.thesis_pages} صفحة${f.certificate ? '' : ' (شامل الإفادة)'}`
              : `Proofreading up to ${f.thesis_pages} pages${f.certificate ? '' : ' (certificate included)'}`,
            base,
          ],
        ]
        if (extra > 0) {
          items.push([
            outAr
              ? `صفحات زيادة (${extra} × ${formatNum(per)})`
              : `Extra pages (${extra} × ${formatNum(per)})`,
            extra * per,
          ])
        }
        if (f.certificate) {
          items.push([outAr ? 'رسوم الإفادة' : 'Certificate fee', f.certificate])
        }

        const total = items.reduce((acc, [, v]) => acc + v, 0)
        const head = outAr
          ? `تدقيق لغوي لرسالة باللغة ${lname}، ${pages} صفحة — ${who[a]}:`
          : `${lname} proofreading of a ${pages}-page thesis — ${who[a]}:`
        const lines = [
          head,
          ...items.map(([label, val]) => `• ${label}: ${money(val)}`),
          outAr ? `الإجمالي: ${money(total)}` : `Total: ${money(total)}`,
        ]
        blocks.push(lines.join('\n'))
      }
    }
  }

  const notes: string[] = []
  if (service === 'pub') {
    notes.push(
      outAr
        ? 'رسوم التحكيم والنشر تُدفع معًا مرة واحدة تسهيلًا على الباحثين.'
        : 'Refereeing and publishing fees are paid together at once as a facilitation for researchers.'
    )
  }
  if (audiences.length === 2) {
    notes.push(
      outAr
        ? 'الرسوم مختلفة للباحث المصري والوافد، فعرضت الحالتين. أضف كلمة «مصري» أو «وافد» لحساب حالة واحدة.'
        : 'Fees differ for Egyptian and international researchers, so both are shown.'
    )
  }

  return { text: [...blocks, ...notes].join('\n\n') }
}

// ============================================================================
// 2. توجيه المجلات العلمية (Journal Routing)
// ============================================================================
const JOURNAL_INTENT_RE =
  /انشر فين|انشر في انهي|انشر بحثي فين|انهي مجله|اي مجله|مجله مناسبه|انسب مجله|اختار مجله|المجله المناسبه|which journal|where (should|can|do) i publish|where to publish|choose a journal|right journal|suitable journal/
const PICK_AR = 'تخصصي:'
const PICK_EN = 'My field:'
const OTHER_AR = 'غير ذلك / مش متأكد'
const OTHER_EN = 'Other / not sure'

function containsPhrase(questionTokens: string[], phrase: string): boolean {
  const p = tokenize(phrase)
  const n = p.length
  if (n === 0) return false
  for (let i = 0; i <= questionTokens.length - n; i++) {
    let ok = true
    for (let j = 0; j < n; j++) {
      if (questionTokens[i + j] !== p[j]) {
        ok = false
        break
      }
    }
    if (ok) return true
  }
  return false
}

function tryJournalRouting(question: string): LocalToolReply | null {
  const qRaw = question.trim()
  const isPick =
    qRaw.startsWith(PICK_AR) || qRaw.toLowerCase().startsWith(PICK_EN.toLowerCase())

  if (!JOURNAL_INTENT_RE.test(normalizeText(qRaw)) && !isPick) {
    return null
  }

  const outAr = isArabic(qRaw)
  const specs = journalsData.specializations
  const journals = journalsData.journals as Record<
    string,
    {
      name_ar: string
      name_en: string
      url: string
      frequency_ar: string
      frequency_en: string
      scope_ar: string
      scope_en: string
    }
  >
  const proposed = journalsData.routing_status !== 'approved'

  let matchedSpec: (typeof specs)[number] | 'other' | null = null

  if (isPick) {
    const colonIdx = qRaw.indexOf(':')
    const picked = normalizeText(colonIdx >= 0 ? qRaw.slice(colonIdx + 1) : '')
    if (picked === normalizeText(OTHER_AR) || picked === normalizeText(OTHER_EN)) {
      matchedSpec = 'other'
    } else {
      matchedSpec =
        specs.find(
          (s) =>
            picked === normalizeText(s.label_ar) ||
            picked === normalizeText(s.label_en)
        ) || null
    }
  } else {
    const toks = tokenize(qRaw)
    const hits = specs.filter((s) =>
      [s.label_ar, s.label_en, ...s.kw].some((k) => containsPhrase(toks, k))
    )
    if (hits.length === 1) {
      matchedSpec = hits[0]
    }
  }

  if (!matchedSpec) {
    const text = outAr
      ? 'المركز بينشر في مجلتين معتمدتين بتقييم 7/7. علشان أقترح عليك الأنسب، اختار تخصص بحثك:'
      : 'The center publishes in two journals rated 7/7. To suggest the right one, choose your research field:'
    const options: QuickOption[] = specs.map((s) => ({
      label: outAr ? s.label_ar : s.label_en,
      value: outAr ? `${PICK_AR} ${s.label_ar}` : `${PICK_EN} ${s.label_en}`,
    }))
    options.push({
      label: outAr ? OTHER_AR : OTHER_EN,
      value: outAr ? `${PICK_AR} ${OTHER_AR}` : `${PICK_EN} ${OTHER_EN}`,
    })
    return { text, options }
  }

  const keys =
    matchedSpec === 'other' ? Object.keys(journals) : matchedSpec.journals
  let head = ''
  if (matchedSpec === 'other') {
    head = outAr
      ? 'مفيش تخصص محدد، فدي المجلتين علشان تقارن بينهم:'
      : 'No specific field, so here are both journals to compare:'
  } else {
    const label = outAr ? matchedSpec.label_ar : matchedSpec.label_en
    if (keys.length === 1) {
      head = outAr
        ? `لتخصص «${label}»، المجلة المقترحة:`
        : `For «${label}», the suggested journal is:`
    } else {
      head = outAr
        ? `تخصص «${label}» يناسب المجلتين، فاختار حسب موضوع بحثك:`
        : `«${label}» fits both journals; choose by your paper's topic:`
    }
  }

  const journalBlocks = keys.map((k) => {
    const j = journals[k]
    if (outAr) {
      return `• ${j.name_ar}\n  مجالاتها: ${j.scope_ar}\n  تصدر: ${j.frequency_ar}`
    }
    return `• ${j.name_en}\n  Fields: ${j.scope_en}\n  Published: ${j.frequency_en}`
  })

  const links = keys.map((k) => ({
    label: outAr ? `فتح موقع ${journals[k].name_ar}` : `Open ${journals[k].name_en}`,
    url: journals[k].url,
  }))

  const note = proposed
    ? outAr
      ? 'ملحوظة: ده توجيه مبدئي مقترح، والقرار النهائي لهيئة تحرير المجلة.'
      : 'Note: this is a proposed guide; the journal’s editorial board makes the final decision.'
    : outAr
    ? 'القرار النهائي لهيئة تحرير المجلة.'
    : 'The journal’s editorial board makes the final decision.'

  return {
    text: [head, '', ...journalBlocks, '', note].join('\n'),
    links,
  }
}

export function runAssistantLocalTools(
  question: string,
  portalAudience: 'egyptian' | 'expat' | 'staff' | 'all'
): LocalToolReply | null {
  return tryFeeCalculator(question, portalAudience) || tryJournalRouting(question)
}
