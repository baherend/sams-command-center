import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { translateDbText, useI18n } from './i18n'
import { OPTION_LABELS } from './ResearcherPortal'

// Everything on this page comes from crdc_public.get_catalog(): the only data a
// signed-out visitor can read. No fee or requirement is typed by hand here.

type Num = number | string | null
type CatalogService = { service_id: number; code: string; name_ar: string }
type CatalogFee = {
  service_id: number
  option_code: string
  applicant_type: 'egyptian' | 'foreign'
  currency: 'EGP' | 'USD'
  base_fee: Num
  included_pages: number | null
  extra_page_fee: Num
  certificate_fee: Num
  requirement_code: string | null
}
type CatalogRequirement = { requirement_code: string; service_id: number; name_ar: string; sort_order: number }
type CatalogDegree = { degree_id: number; code: string; name_ar: string; track: string; level: string }
type CatalogDegreeRequirement = { degree_id: number; requirement_code: string; min_count: number }
type CatalogJournal = { journal_id: number; code: string; name_ar: string; issues_per_year: number | null }
type Catalog = {
  services: CatalogService[]
  fees: CatalogFee[]
  requirement_types: CatalogRequirement[]
  degrees: CatalogDegree[]
  degree_requirements: CatalogDegreeRequirement[]
  journals: CatalogJournal[]
}

// Verified in CRDC/chatbot/knowledge/journals.json (academy website, ISSN portal).
const JOURNAL_SITES: Record<string, { url: string; scope_ar: string; scope_en: string }> = {
  JSO: {
    url: 'https://jso.journals.ekb.eg',
    scope_ar: 'الإدارة العامة والمحلية، الحاسب ونظم المعلومات، البنوك، التأمين، الفنادق والسياحة، البترول والطاقة، الأعمال الدولية',
    scope_en: 'Public and local administration, computing and information systems, banking, insurance, hotels and tourism, petroleum and energy, international business',
  },
  SJSAF: {
    url: 'https://sjsaf.journals.ekb.eg',
    scope_ar: 'الإدارة العامة، والعلوم الإدارية والمالية',
    scope_en: 'Public administration, administrative and financial sciences',
  },
}

const num = (value: Num) => (value === null || value === undefined || value === '' ? 0 : Number(value))

// Same formula as crdc.calc_fee in the database.
export function feeAmount(fee: CatalogFee, pages: number | null) {
  const extra = fee.included_pages !== null && fee.extra_page_fee !== null && pages !== null
    ? Math.max(0, pages - fee.included_pages) * num(fee.extra_page_fee)
    : 0
  return num(fee.base_fee) + extra + num(fee.certificate_fee)
}

function money(amount: number, currency: string, isEn: boolean) {
  const value = new Intl.NumberFormat(isEn ? 'en-US' : 'ar-EG', { maximumFractionDigits: 2 }).format(amount)
  const unit = currency === 'EGP' ? (isEn ? 'EGP' : 'جنيه') : (isEn ? 'USD' : 'دولار')
  return `${value} ${unit}`
}

function optionName(code: string, isEn: boolean) {
  const entry = OPTION_LABELS[code]
  return entry ? (isEn ? entry.en : entry.ar) : code
}

export default function PublicHome() {
  const { t, isEn } = useI18n()
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [failed, setFailed] = useState(false)
  const [degreeId, setDegreeId] = useState<number | null>(null)
  const [applicant, setApplicant] = useState<'egyptian' | 'foreign'>('egyptian')
  const [serviceId, setServiceId] = useState<number | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [pagesText, setPagesText] = useState('30')

  useEffect(() => {
    let active = true
    if (!supabase) { setFailed(true); return }
    supabase.schema('crdc_public').rpc('get_catalog').then(({ data, error }) => {
      if (!active) return
      if (error || !data) { setFailed(true); return }
      const value = data as Catalog
      setCatalog(value)
      setDegreeId(value.degrees[0]?.degree_id ?? null)
      setServiceId(value.services[0]?.service_id ?? null)
    })
    return () => { active = false }
  }, [])

  const serviceFees = useMemo(
    () => (catalog?.fees ?? []).filter((fee) => fee.service_id === serviceId && fee.applicant_type === applicant),
    [catalog, serviceId, applicant],
  )

  // A new service starts with its first option ticked; publication starts with
  // arbitration and publishing together, which is how a paper goes through the center.
  useEffect(() => {
    const codes = serviceFees.map((fee) => fee.option_code)
    const service = catalog?.services.find((item) => item.service_id === serviceId)
    const preset = service?.code === 'PUB' ? codes.filter((code) => code === 'PUB_ARBITRATION' || code === 'PUB_PUBLISH') : codes.slice(0, 1)
    setPicked(new Set(preset))
  }, [serviceId, applicant, catalog]) // eslint-disable-line react-hooks/exhaustive-deps

  const pages = /^\d{1,4}$/.test(pagesText) && Number(pagesText) >= 1 && Number(pagesText) <= 2000 ? Number(pagesText) : null
  const chosen = serviceFees.filter((fee) => picked.has(fee.option_code))
  const needsPages = chosen.some((fee) => fee.included_pages !== null)
  const currency = serviceFees[0]?.currency ?? (applicant === 'egyptian' ? 'EGP' : 'USD')
  const total = chosen.reduce((sum, fee) => sum + feeAmount(fee, needsPages ? pages : null), 0)

  const requirementsFor = (id: number | null) => (catalog?.degree_requirements ?? [])
    .filter((row) => row.degree_id === id)
    .map((row) => ({ ...row, type: catalog?.requirement_types.find((item) => item.requirement_code === row.requirement_code) }))

  function openCalculator(id: number) {
    setServiceId(id)
    document.getElementById('fees')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const unavailable = (
    <p className="message public-unavailable" role="status">
      {t('تفاصيل الخدمات والرسوم غير متاحة حاليًا. يمكنك الاطلاع عليها بعد تسجيل الدخول، أو التواصل مع المركز.',
        'Service and fee details are unavailable right now. Sign in to see them inside the portal, or contact the center.')}
    </p>
  )

  const steps: Array<[string, string, string, string]> = [
    ['أنشئ حسابك', 'Create your account', 'ببريدك الإلكتروني وكلمة مرور، ولا يطّلع على طلباتك غيرك والموظفون المختصون.', 'With your email and a password. The account links you to your own requests only.'],
    ['استكمل ملف الباحث', 'Complete your researcher profile', 'الاسم، والفئة (مصري أو وافد)، والرقم القومي أو رقم جواز السفر، والدرجة العلمية.', 'Name, Egyptian or international, national ID or passport, and your degree.'],
    ['اختر الخدمات وقدّم الطلب', 'Pick services and submit', 'تُقدَّم الرسالة والبحث في طلبين منفصلين، ويمكن أن يضم كل طلب أكثر من خدمة.', 'A thesis and a paper are separate requests; each can include several services.'],
    ['ادفع وارفع الإيصال', 'Pay and upload the receipt', 'بعد صدور أمر الدفع، ارفع صورة الإيصال (PDF أو JPG أو PNG).', 'Once a payment order is issued, upload the receipt (PDF, JPG or PNG).'],
    ['مراجعة السداد', 'The cashier verifies payment', 'بعد تأكيد الخزينة للسداد، تنتقل الخدمة إلى المراجع المختص للتنفيذ.', 'After verification, the service moves to the assigned reviewer.'],
    ['المتابعة حتى التسليم', 'Track until delivery', 'يظهر لك كل تغيير في حالة الطلب بتاريخه، حتى تسليم الإفادة.', 'Every status change shows with its date, up to certificate delivery.'],
  ]

  return (
    <div className="public-home">
      {/* Wording from the center's official pages (sams.edu.eg/crdc, vision-mission, director's message). */}
      <section className="public-section about-center" id="about" aria-labelledby="about-title">
        <div className="about-intro">
          <h2 id="about-title">{t('عن المركز', 'About the center')}</h2>
          <p>{t('مركز الاستشارات والبحوث والتطوير بأكاديمية السادات للعلوم الإدارية يقدّم خدمات الاستشارات والبحوث للمؤسسات المصرية والعربية في مختلف القطاعات، ويدعم البحث العلمي على المستوى المحلي والإقليمي من خلال بحوث محكّمة من أساتذة الأكاديمية والجامعات المصرية واللجان العلمية الدائمة بالمجلس الأعلى للجامعات.',
            'The Consultation, Research & Development Center at Sadat Academy for Management Sciences provides consulting and research services to Egyptian and Arab institutions across sectors, and supports scientific research locally and regionally through papers peer-reviewed by academy and Egyptian university professors and the standing scientific committees of the Supreme Council of Universities.')}</p>
          <p>{t('والمركز معتمد مركزًا للتدريب والاختبارات الإلكترونية لشهادة أساسيات التحول الرقمي، تحت إشراف المجلس الأعلى للجامعات.',
            'The center is accredited for training and electronic exams for the Digital Transformation Fundamentals certificate, under the Supreme Council of Universities.')}</p>
        </div>
        <dl className="about-statements">
          <div><dt>{t('رؤيتنا', 'Our vision')}</dt><dd>{t('أن يكون المركز الاختيار الأول لأصحاب المصلحة في مصر والعالم العربي وأفريقيا بحلول 2030.', 'To be the first choice for stakeholders in Egypt, the Arab world and Africa by 2030.')}</dd></div>
          <div><dt>{t('رسالتنا', 'Our mission')}</dt><dd>{t('يلتزم المركز بتقديم خدمات متميزة ومبتكرة في مجال الاستشارات والبحوث والتطوير الإداري، بما يفوق توقعات أصحاب المصلحة ويتوافق مع رسالة الأكاديمية.', 'To deliver distinguished, innovative services in consulting, research and administrative development that exceed stakeholder expectations, in line with the academy’s mission.')}</dd></div>
          <div><dt>{t('الأكاديمية', 'The academy')}</dt><dd>{t('أكاديمية السادات للعلوم الإدارية، أول أكاديمية حكومية في مصر والوطن العربي تتخصص في العلوم الإدارية.', 'Sadat Academy for Management Sciences, the first government academy in Egypt and the Arab world specialized in management sciences.')} <a href="http://www.sams.edu.eg/crdc" target="_blank" rel="noopener noreferrer">{t('موقع المركز على موقع الأكاديمية', 'The center on the academy website')}</a></dd></div>
        </dl>
      </section>

      <section className="public-section degree-guide" id="requirements" aria-labelledby="requirements-title">
        <div className="public-section-head">
          <h2 id="requirements-title">{t('ما المطلوب قبل مناقشة رسالتك؟', 'What do you need before your defense?')}</h2>
          <p>{t('اختر درجتك العلمية لتعرف الخدمات المطلوب استيفاؤها من المركز.', 'Choose your degree to see the center services you need to complete.')}</p>
        </div>
        {!catalog ? (failed ? unavailable : <div className="loading public-loading"><span className="spinner" /> {t('جارٍ تحميل البيانات...', 'Loading the catalog...')}</div>) : (
          <div className="degree-guide-body">
            <div className="degree-tabs" role="tablist" aria-label={t('الدرجة العلمية', 'Academic degree')}>
              {catalog.degrees.map((degree) => (
                <button key={degree.degree_id} type="button" role="tab" aria-selected={degree.degree_id === degreeId}
                  className={degree.degree_id === degreeId ? 'active' : ''} onClick={() => setDegreeId(degree.degree_id)}>
                  {translateDbText(degree.name_ar, isEn)}
                </button>
              ))}
            </div>
            <ul className="degree-checklist" role="tabpanel">
              {requirementsFor(degreeId).map((row) => (
                <li key={row.requirement_code}>
                  <span className="check-mark" aria-hidden="true" />
                  <span className="degree-check-copy">
                    <strong>{translateDbText(row.type?.name_ar, isEn)}</strong>
                    {row.min_count > 1 && <small>{isEn ? `${row.min_count} required` : `مطلوب ${row.min_count.toLocaleString('ar-EG')}`}</small>}
                  </span>
                  {row.type && (
                    <button type="button" className="quiet-button" onClick={() => openCalculator(row.type!.service_id)}>
                      {t('احسب الرسوم', 'Estimate fees')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="public-section fee-estimator" id="fees" aria-labelledby="fees-title">
        <div className="public-section-head">
          <h2 id="fees-title">{t('احسب رسوم الخدمة', 'Estimate your service fees')}</h2>
          <p>{t('تستند الأرقام إلى التعريفة المعتمدة المسجلة في النظام، ويُحدَّد المبلغ النهائي في أمر الدفع.', 'Figures come from the approved tariff stored in the system. The final amount is set in your payment order.')}</p>
        </div>
        {!catalog ? (failed ? unavailable : null) : (
          <div className="estimator-grid">
            <div className="estimator-controls">
              <fieldset className="segmented">
                <legend>{t('نوع الباحث', 'Applicant type')}</legend>
                <div className="segmented-track">
                  <button type="button" aria-pressed={applicant === 'egyptian'} onClick={() => setApplicant('egyptian')}>{t('مصري', 'Egyptian')}</button>
                  <button type="button" aria-pressed={applicant === 'foreign'} onClick={() => setApplicant('foreign')}>{t('وافد', 'International')}</button>
                </div>
              </fieldset>
              <label className="estimator-field">{t('الخدمة', 'Service')}
                <select value={serviceId ?? ''} onChange={(event) => setServiceId(Number(event.target.value))}>
                  {catalog.services.map((service) => <option key={service.service_id} value={service.service_id}>{translateDbText(service.name_ar, isEn)}</option>)}
                </select>
              </label>
              <div className="estimator-options">
                {serviceFees.map((fee) => (
                  <label key={fee.option_code} className="estimator-option">
                    <input type="checkbox" checked={picked.has(fee.option_code)} onChange={() => setPicked((prev) => {
                      const next = new Set(prev)
                      if (next.has(fee.option_code)) next.delete(fee.option_code); else next.add(fee.option_code)
                      return next
                    })} />
                    <span>{optionName(fee.option_code, isEn)}</span>
                  </label>
                ))}
              </div>
              {needsPages && (
                <label className="estimator-field">{t('عدد الصفحات', 'Number of pages')}
                  <input inputMode="numeric" value={pagesText} maxLength={4} onChange={(event) => setPagesText(event.target.value.replace(/[^\d]/g, ''))}
                    aria-invalid={pages === null} />
                  {pages === null && <small className="field-hint">{t('أدخل رقمًا من 1 إلى 2000', 'Enter a number from 1 to 2000')}</small>}
                </label>
              )}
            </div>
            <div className="estimator-result" aria-live="polite">
              <ul>
                {chosen.map((fee) => (
                  <li key={fee.option_code}>
                    <span>
                      {optionName(fee.option_code, isEn)}
                      <small>
                        {fee.included_pages !== null
                          ? (isEn ? `Includes ${fee.included_pages} pages, then ${money(num(fee.extra_page_fee), fee.currency, isEn)} per extra page`
                            : `يشمل ${fee.included_pages.toLocaleString('ar-EG')} صفحة، ثم ${money(num(fee.extra_page_fee), fee.currency, isEn)} لكل صفحة إضافية`)
                          : t('سعر ثابت', 'Flat fee')}
                        {num(fee.certificate_fee) > 0 && (isEn ? ` · certificate ${money(num(fee.certificate_fee), fee.currency, isEn)}` : ` · إفادة ${money(num(fee.certificate_fee), fee.currency, isEn)}`)}
                      </small>
                    </span>
                    <strong>{money(feeAmount(fee, needsPages ? pages : null), fee.currency, isEn)}</strong>
                  </li>
                ))}
              </ul>
              <div className="estimator-total">
                <span>{t('الإجمالي التقديري', 'Estimated total')}</span>
                <strong>{chosen.length && (!needsPages || pages !== null) ? money(total, currency, isEn) : '—'}</strong>
              </div>
              <p className="form-footnote">{t('هذا تقدير استرشادي، ولا يتم أي دفع من هذه الصفحة.', 'This is an estimate for guidance. No payment happens on this page.')}</p>
            </div>
          </div>
        )}
      </section>

      <section className="public-section" id="steps" aria-labelledby="steps-title">
        <div className="public-section-head">
          <h2 id="steps-title">{t('مراحل الطلب', 'How your request moves')}</h2>
        </div>
        <ol className="request-steps">
          {steps.map(([titleAr, titleEn, bodyAr, bodyEn]) => (
            <li key={titleEn}><strong>{t(titleAr, titleEn)}</strong><p>{t(bodyAr, bodyEn)}</p></li>
          ))}
        </ol>
      </section>

      <section className="public-section murshid-intro" id="murshid" aria-labelledby="murshid-title">
        <div className="murshid-copy">
          <h2 id="murshid-title">{t('مُرشِد، مساعد الباحث', 'Murshid, the researcher’s assistant')}</h2>
          <p>{t('يجيب مُرشِد عن أسئلتك من الدليل الإجرائي للمركز فقط، ويذكر مصدر كل إجابة. وإذا لم تكن المعلومة في الدليل أخبرك بذلك بدلًا من التخمين.', 'Murshid answers your questions from the center’s procedural guide only and shows the source of every answer. If the guide does not cover something, it says so instead of guessing.')}</p>
          <ul className="murshid-abilities">
            <li>{t('يحسب رسوم النشر والتدقيق بعدد الصفحات، من التعريفة المعتمدة.', 'Calculates publishing and proofreading fees by page count, from the approved tariff.')}</li>
            <li>{t('يقترح المجلة المناسبة لتخصص بحثك.', 'Suggests the journal that fits your field.')}</li>
            <li>{t('يعمل داخل متصفحك، فلا تُرسل أسئلتك إلى أي خدمة خارجية.', 'Runs inside your browser, so your questions are not sent to any outside service.')}</li>
          </ul>
        </div>
        <div className="murshid-try">
          <span className="murshid-try-label">{t('جرّب سؤالًا', 'Try a question')}</span>
          {[
            [t('احسب رسوم نشر بحث 30 صفحة', 'Calculate publication fees for 30 pages')],
            [t('أنشر بحثي في أي مجلة؟', 'Which journal fits my paper?')],
            [t('ما نسبة الاقتباس المقبولة؟', 'What similarity percentage is accepted?')],
          ].map(([question]) => (
            <button key={question} type="button" className="murshid-question" onClick={() => window.dispatchEvent(new CustomEvent('murshid:ask', { detail: question }))}>
              {question}
            </button>
          ))}
          <p className="form-footnote">{t('عند أول استخدام يُحمَّل محرك البحث على جهازك مرة واحدة (نحو 135 ميجابايت). حساب الرسوم واقتراح المجلة يعملان فورًا.', 'On first use, the search engine downloads to your device once (about 135 MB). Fee calculation and journal suggestions work right away.')}</p>
        </div>
      </section>

      <section className="public-section" id="journals" aria-labelledby="journals-title">
        <div className="public-section-head">
          <h2 id="journals-title">{t('مجلات النشر', 'Publication journals')}</h2>
          <p>{t('يحكّم المركز الأبحاث وينشرها في مجلتين معتمدتين من المجلس الأعلى للجامعات بتقييم 7/7.', 'The center reviews and publishes papers in two journals accredited by the Supreme Council of Universities with a 7/7 rating.')}</p>
        </div>
        {!catalog ? (failed ? unavailable : null) : (
          <div className="journal-list">
            {catalog.journals.map((journal) => {
              const site = JOURNAL_SITES[journal.code]
              return (
                <article key={journal.journal_id} className="journal-entry">
                  <h3>{translateDbText(journal.name_ar, isEn)}</h3>
                  {journal.issues_per_year && <span className="journal-frequency">{isEn ? `${journal.issues_per_year} issues a year` : `${journal.issues_per_year.toLocaleString('ar-EG')} أعداد في السنة`}</span>}
                  {site && <p>{isEn ? site.scope_en : site.scope_ar}</p>}
                  {site && <a href={site.url} target="_blank" rel="noopener noreferrer" dir="ltr">{site.url.replace('https://', '')}</a>}
                </article>
              )
            })}
          </div>
        )}
      </section>

      <section className="public-contact" id="contact" aria-labelledby="contact-title">
        <h2 id="contact-title">{t('تواصل مع المركز', 'Contact the center')}</h2>
        <dl>
          <div><dt>{t('البريد', 'Email')}</dt><dd><a href="mailto:crdc@sadatacademy.edu.eg" dir="ltr">crdc@sadatacademy.edu.eg</a></dd></div>
          <div><dt>{t('الهاتف', 'Phone')}</dt><dd dir="ltr"><a href="tel:+20223582727">0020-223582727</a> · <a href="tel:+201123443391">01123443391</a></dd></div>
          <div><dt>{t('العنوان', 'Address')}</dt><dd>{t('شارع أكاديمية السادات، مدخل المعادي 1، كورنيش النيل، القاهرة', 'Sadat Academy Street, Maadi Entrance 1, Corniche El Nil, Cairo')}</dd></div>
        </dl>
      </section>
    </div>
  )
}
