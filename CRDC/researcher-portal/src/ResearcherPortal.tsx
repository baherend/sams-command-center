import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from './supabase'
import { friendlyError, UiError, useSingleFlight } from './errors'
import { useI18n, translateDbText } from './i18n'
import ResearcherGuideHome from './ResearcherGuideHome'

type ApplicantType = 'egyptian' | 'foreign'
type WorkType = 'thesis' | 'paper'
type View = 'home' | 'catalog' | 'requests' | 'profile'

type ResearcherProfile = {
  researcher_id: string
  full_name: string
  applicant_type: ApplicantType
  email: string
  degree_id: number | null
  degree_name: string | null
  specialty: string | null
  nationality: string | null
  national_id: string | null
  passport_no: string | null
  created_at: string
}

type Service = { service_id: number; code: string; name_ar: string; is_active: boolean }
type FeeOption = {
  fee_id: number
  service_id: number
  option_code: string
  applicant_type: ApplicantType
  currency: 'EGP' | 'USD'
  base_fee: number | string
  included_pages: number | null
  extra_page_fee: number | string | null
  certificate_fee: number | string
  requirement_code: string | null
}
type DegreeRequirement = { requirement_code: string; min_count: number; name_ar: string }
type RequestRow = {
  request_id: number | string
  work_type: WorkType
  work_title: string
  page_count: number | null
  created_at: string
}
type StatusRow = { status_id: number; code: string; name_ar: string; sort_order: number }
type ItemRow = {
  item_id: number | string
  request_id: number | string
  fee_id: number
  service_id: number
  status_id: number
  currency: string
  amount_due: number | string
  payment_id: number | string | null
  created_at: string
}
type HistoryRow = { history_id: number; item_id: number | string; status_id: number; changed_at: string; note: string | null }
type PublicationRow = {
  submission_id: number
  item_id: number | string
  journal_id: number
  issue_id: number | null
  paper_language: 'ar' | 'en'
  decision: 'pending' | 'revisions' | 'accepted' | 'rejected'
  accepted_at: string | null
}
type PaymentRow = {
  payment_id: number | string
  payment_order_no: string | null
  receipt_no: string | null
  amount: number | string
  currency: string
  channel: string
  paid_at: string | null
  receipt_status: 'awaiting_receipt' | 'pending_review' | 'rejected' | 'verified'
  receipt_storage_path: string | null
  submitted_by_researcher_at: string | null
  rejection_reason: string | null
}

const statusName = (status: StatusRow | undefined) => status?.name_ar ?? 'غير محدد'
const formatDate = (value: string | null | undefined) =>
  value ? new Intl.DateTimeFormat(document.documentElement.lang === 'en' ? 'en-US' : 'ar-EG', { dateStyle: 'medium' }).format(new Date(value)) : '—'
const money = (amount: number | string, currency: string) =>
  new Intl.NumberFormat(document.documentElement.lang === 'en' ? 'en-US' : 'ar-EG', { maximumFractionDigits: 2 }).format(Number(amount)) + ` ${currency}`
// Amounts mix digits with a Latin currency code; isolate them so they do not get reordered inside RTL text.
const Money = ({ amount, currency }: { amount: number | string; currency: string }) => <span dir="ltr">{money(amount, currency)}</span>
const Ltr = ({ children }: { children: string }) => <span dir="ltr">{children}</span>

export default function ResearcherPortal({ profile, onSignOut, onProfileUpdated }: { profile: ResearcherProfile; onSignOut: () => void; onProfileUpdated: (profile: ResearcherProfile) => void }) {
  const { dir, isEn } = useI18n()
  const [view, setView] = useState<View>('catalog')
  const [services, setServices] = useState<Service[]>([])
  const [fees, setFees] = useState<FeeOption[]>([])
  const [requirements, setRequirements] = useState<DegreeRequirement[]>([])
  const [requests, setRequests] = useState<RequestRow[]>([])
  const [requestStatusIds, setRequestStatusIds] = useState<Map<string, number[]>>(new Map())
  const [statuses, setStatuses] = useState<StatusRow[]>([])
  const [detail, setDetail] = useState<{
    request: RequestRow
    items: ItemRow[]
    fees: FeeOption[]
    services: Service[]
    history: HistoryRow[]
    statuses: StatusRow[]
    publications: PublicationRow[]
    journals: { journal_id: number; name_ar: string }[]
    issues: { issue_id: number; issue_year: number; issue_month: number }[]
    payments: PaymentRow[]
  } | null>(null)
  const [workType, setWorkType] = useState<WorkType>('thesis')
  const [selectedFeeIds, setSelectedFeeIds] = useState<number[]>([])
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const singleFlight = useSingleFlight()
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  const [degrees, setDegrees] = useState<{ degree_id: number; name_ar: string }[]>([])

  useEffect(() => {
    if (!supabase) return
    void supabase.schema('crdc').from('degrees').select('degree_id, name_ar').order('degree_id')
      .then(({ data }) => setDegrees(data ?? []))
  }, [])

  async function submitProfileEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    await singleFlight(async () => {
      if (!supabase) return
      setProfileSaving(true)
      setError('')
      setNotice('')
      const form = new FormData(formElement)
      const degreeId = Number(form.get('degree_id'))
      try {
        const { data, error: updateError } = await supabase.schema('crdc').from('researchers')
          .update({
            full_name: String(form.get('full_name') ?? '').trim(),
            degree_id: Number.isFinite(degreeId) && degreeId > 0 ? degreeId : null,
            specialty: String(form.get('specialty') ?? '').trim() || null,
          })
          .eq('researcher_id', profile.researcher_id)
          .select('researcher_id, full_name, applicant_type, email, degree_id, specialty, nationality, national_id, passport_no, created_at')
          .single()
        if (updateError) throw updateError
        onProfileUpdated({ ...data, degree_name: degrees.find((degree) => degree.degree_id === data.degree_id)?.name_ar ?? null } as ResearcherProfile)
        setNotice((isEn ? 'Your profile has been updated.' : 'تم تحديث بياناتك الشخصية.'))
      } catch (updateError) {
        setError(friendlyError(updateError))
      } finally {
        setProfileSaving(false)
      }
    })
  }

  const loadCatalog = useCallback(async () => {
    if (!supabase) return
    const [{ data: serviceRows, error: serviceError }, { data: statusRows, error: statusError }] = await Promise.all([
      supabase.schema('crdc').from('services').select('service_id, code, name_ar, is_active').eq('is_active', true).order('service_id'),
      supabase.schema('crdc').from('request_statuses').select('status_id, code, name_ar, sort_order').order('sort_order'),
    ])
    if (serviceError) throw serviceError
    if (statusError) throw statusError
    const activeServices = (serviceRows ?? []) as Service[]
    setServices(activeServices)
    setStatuses((statusRows ?? []) as StatusRow[])

    if (activeServices.length) {
      const { data: feeRows, error: feeError } = await supabase.schema('crdc').from('fee_schedule')
        .select('fee_id, service_id, option_code, applicant_type, currency, base_fee, included_pages, extra_page_fee, certificate_fee, requirement_code')
        .eq('applicant_type', profile.applicant_type)
        .eq('currency', profile.applicant_type === 'egyptian' ? 'EGP' : 'USD')
        .in('service_id', activeServices.map((service) => service.service_id))
        .order('service_id').order('fee_id')
      if (feeError) throw feeError
      setFees((feeRows ?? []) as FeeOption[])
    } else setFees([])

    if (profile.degree_id) {
      const { data: requirementRows, error: requirementError } = await supabase.schema('crdc').from('degree_requirements')
        .select('requirement_code, min_count').eq('degree_id', profile.degree_id)
      if (requirementError) throw requirementError
      const rows = requirementRows ?? []
      if (rows.length) {
        const { data: typeRows, error: typeError } = await supabase.schema('crdc').from('requirement_types')
          .select('requirement_code, name_ar').in('requirement_code', rows.map((row) => row.requirement_code))
        if (typeError) throw typeError
        const labels = new Map((typeRows ?? []).map((row) => [row.requirement_code, row.name_ar]))
        setRequirements(rows.map((row) => ({ ...row, name_ar: labels.get(row.requirement_code) ?? row.requirement_code })) as DegreeRequirement[])
      } else setRequirements([])
    } else setRequirements([])
  }, [profile.applicant_type, profile.degree_id])

  const loadRequests = useCallback(async () => {
    if (!supabase) return
    const { data, error: queryError } = await supabase.schema('crdc').from('service_requests')
      .select('request_id, work_type, work_title, page_count, created_at')
      .eq('researcher_id', profile.researcher_id).order('created_at', { ascending: false })
    if (queryError) throw queryError
    setRequests((data ?? []) as RequestRow[])
    const requestIds = (data ?? []).map((request) => request.request_id)
    if (requestIds.length) {
      const { data: itemRows, error: itemError } = await supabase.schema('crdc').from('request_items')
        .select('request_id, status_id').in('request_id', requestIds)
      if (itemError) throw itemError
      const grouped = new Map<string, number[]>()
      for (const item of itemRows ?? []) {
        const key = String(item.request_id)
        grouped.set(key, [...(grouped.get(key) ?? []), item.status_id])
      }
      setRequestStatusIds(grouped)
    } else setRequestStatusIds(new Map())
  }, [profile.researcher_id])

  useEffect(() => {
    let alive = true
    setLoading(true)
    void Promise.all([loadCatalog(), loadRequests()]).catch((loadError: unknown) => {
      if (alive) setError(friendlyError(loadError))
    }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [loadCatalog, loadRequests])

  const loadRequestDetail = useCallback(async (requestId: string) => {
    if (!supabase) return
    setDetail(null)
    setDetailLoading(true)
    setError('')
    try {
      const { data: request, error: requestError } = await supabase.schema('crdc').from('service_requests')
        .select('request_id, work_type, work_title, page_count, created_at')
        .eq('request_id', requestId).eq('researcher_id', profile.researcher_id).single()
      if (requestError) throw requestError
      const { data: itemRows, error: itemsError } = await supabase.schema('crdc').from('request_items')
        .select('item_id, request_id, fee_id, service_id, status_id, currency, amount_due, payment_id, created_at')
        .eq('request_id', requestId).order('created_at')
      if (itemsError) throw itemsError
      const items = (itemRows ?? []) as ItemRow[]
      const itemIds = items.map((item) => String(item.item_id))
      const feeIds = [...new Set(items.map((item) => item.fee_id))]
      const serviceIds = [...new Set(items.map((item) => item.service_id))]
      const paymentIds = [...new Set(items.flatMap((item) => item.payment_id ? [String(item.payment_id)] : []))]
      const [feesResult, servicesResult, historyResult, publicationResult, paymentsResult, statusResult] = await Promise.all([
        feeIds.length ? supabase.schema('crdc').from('fee_schedule').select('fee_id, service_id, option_code, applicant_type, currency, base_fee, included_pages, extra_page_fee, certificate_fee, requirement_code').in('fee_id', feeIds) : Promise.resolve({ data: [], error: null }),
        serviceIds.length ? supabase.schema('crdc').from('services').select('service_id, code, name_ar, is_active').in('service_id', serviceIds) : Promise.resolve({ data: [], error: null }),
        itemIds.length ? supabase.schema('crdc').from('request_status_history').select('history_id, item_id, status_id, changed_at, note').in('item_id', itemIds).order('changed_at') : Promise.resolve({ data: [], error: null }),
        itemIds.length ? supabase.schema('crdc').from('publication_submissions').select('submission_id, item_id, journal_id, issue_id, paper_language, decision, accepted_at').in('item_id', itemIds) : Promise.resolve({ data: [], error: null }),
        paymentIds.length ? supabase.schema('crdc').from('payments').select('payment_id, payment_order_no, receipt_no, amount, currency, channel, paid_at, receipt_status, receipt_storage_path, submitted_by_researcher_at, rejection_reason').in('payment_id', paymentIds) : Promise.resolve({ data: [], error: null }),
        supabase.schema('crdc').from('request_statuses').select('status_id, code, name_ar, sort_order').order('sort_order'),
      ])
      for (const result of [feesResult, servicesResult, historyResult, publicationResult, paymentsResult, statusResult]) {
        if (result.error) throw result.error
      }
      const publications = (publicationResult.data ?? []) as PublicationRow[]
      const journalIds = [...new Set(publications.map((publication) => publication.journal_id))]
      const issueIds = [...new Set(publications.flatMap((publication) => publication.issue_id ? [publication.issue_id] : []))]
      const [journalsResult, issuesResult] = await Promise.all([
        journalIds.length ? supabase.schema('crdc').from('journals').select('journal_id, name_ar').in('journal_id', journalIds) : Promise.resolve({ data: [], error: null }),
        issueIds.length ? supabase.schema('crdc').from('journal_issues').select('issue_id, issue_year, issue_month').in('issue_id', issueIds) : Promise.resolve({ data: [], error: null }),
      ])
      if (journalsResult.error) throw journalsResult.error
      if (issuesResult.error) throw issuesResult.error
      setDetail({
        request: request as RequestRow,
        items,
        fees: (feesResult.data ?? []) as FeeOption[],
        services: (servicesResult.data ?? []) as Service[],
        history: (historyResult.data ?? []) as HistoryRow[],
        statuses: (statusResult.data ?? []) as StatusRow[],
        publications,
        journals: (journalsResult.data ?? []) as { journal_id: number; name_ar: string }[],
        issues: (issuesResult.data ?? []) as { issue_id: number; issue_year: number; issue_month: number }[],
        payments: (paymentsResult.data ?? []) as PaymentRow[],
      })
      setView('requests')
    } catch (loadError) {
      setError(friendlyError(loadError))
    } finally {
      setDetailLoading(false)
    }
  }, [profile.researcher_id])

  async function submitPaymentReceipt(payment: PaymentRow, formData: FormData) {
    if (!supabase || !detail) return
    const receiptNo = String(formData.get('receipt_no') ?? '').trim()
    const paidAt = String(formData.get('paid_at') ?? '')
    const channel = String(formData.get('channel') ?? '')
    const file = formData.get('receipt_file')
    if (!(file instanceof File) || file.size === 0) throw new UiError('اختار ملف الإيصال الأول.')
    if (file.size > 5 * 1024 * 1024) throw new UiError('حجم الإيصال لازم يكون ٥ ميجابايت أو أقل.')
    const extensions: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' }
    const extension = extensions[file.type]
    if (!extension) throw new UiError('ارفع الإيصال بصيغة PDF أو JPG أو PNG.')
    if (!receiptNo || receiptNo.length > 100) throw new UiError('اكتب رقم الإيصال في حدود ١٠٠ حرف.')
    if (!paidAt || paidAt > new Date().toISOString().slice(0, 10)) throw new UiError('اختار تاريخ سداد صحيحًا.')

    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError) throw userError
    if (!userData.user) throw new UiError('سجّل دخولك الأول وجرب تاني.')
    const path = `${userData.user.id}/${detail.request.request_id}/${payment.payment_id}/${crypto.randomUUID()}.${extension}`
    const { error: uploadError } = await supabase.storage.from('payment-receipts').upload(path, file, {
      contentType: file.type,
      upsert: false,
    })
    if (uploadError) throw uploadError
    const { error: rpcError } = await supabase.schema('crdc').rpc('submit_payment_receipt', {
      p_payment_id: Number(payment.payment_id),
      p_channel: channel,
      p_receipt_no: receiptNo,
      p_paid_at: paidAt,
      p_receipt_storage_path: path,
    })
    if (rpcError) throw rpcError
    await loadRequestDetail(String(detail.request.request_id))
    setNotice((isEn ? 'Receipt submitted to treasury; results will appear after review.' : 'وصل إيصال السداد للخزينة، وهتظهر لك النتيجة بعد المراجعة.'))
  }

  const statusById = useMemo(() => new Map(statuses.map((status) => [status.status_id, status])), [statuses])
  const selectedFees = fees.filter((fee) => selectedFeeIds.includes(fee.fee_id))
  const pageCountRequired = selectedFees.some((fee) => fee.included_pages !== null)

  function toggleFee(feeId: number) {
    setSelectedFeeIds((current) => current.includes(feeId) ? current.filter((id) => id !== feeId) : [...current, feeId])
  }

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    await singleFlight(() => sendRequest(formElement))
  }

  async function sendRequest(formElement: HTMLFormElement) {
    if (!supabase) return
    const form = new FormData(formElement)
    const title = String(form.get('work_title') ?? '').trim()
    const rawPageCount = String(form.get('page_count') ?? '').trim()
    const pageCount = rawPageCount === '' ? null : Number(rawPageCount)
    if (selectedFeeIds.length === 0) { setError('اختار خدمة واحدة على الأقل.'); return }
    if (!title) { setError('اكتب عنوان الرسالة أو البحث.'); return }
    if (pageCountRequired && pageCount === null) { setError('اكتب عدد الصفحات علشان نكمل الطلب.'); return }
    if (pageCount !== null && (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 2000)) { setError('عدد الصفحات لازم يكون من ١ إلى ٢٠٠٠.'); return }
    setSubmitting(true)
    setError('')
    setNotice('')
    try {
      const { data: requestId, error: rpcError } = await supabase.schema('crdc').rpc('create_service_request', {
        p_work_type: workType,
        p_work_title: title,
        p_page_count: pageCount,
        p_fee_ids: selectedFeeIds,
      })
      if (rpcError) throw rpcError
      setNotice((isEn ? 'Request submitted. Track it under My Requests.' : 'اتسجل طلبك بنجاح. تقدر تتابع حالته من صفحة طلباتي.'))
      setSelectedFeeIds([])
      formElement.reset()
      await loadRequests()
      setView('requests')
      if (requestId !== null && requestId !== undefined) await loadRequestDetail(String(requestId))
    } catch (submitError) {
      setError(friendlyError(submitError))
    } finally {
      setSubmitting(false)
    }
  }

  const navItems: { id: View; label: string }[] = [
    { id: 'home', label: isEn ? 'Home & Services Guide' : 'الرئيسية والدليل الإجرائي' },
    { id: 'catalog', label: (isEn ? 'Service Catalog & New Request' : 'كتالوج الخدمات وتقديم طلب جديد') },
    { id: 'requests', label: (isEn ? 'My Requests' : 'طلباتي') },
    { id: 'profile', label: (isEn ? 'My Profile' : 'ملفي الشخصي') },
  ]

  function chooseView(next: View) {
    setView(next)
    setError('')
    setDetail(null)
    if (next === 'requests') void loadRequests().catch((loadError: unknown) => setError(friendlyError(loadError)))
  }

  return (
    <main className="page-shell researcher-shell" dir={dir}>
      <header className="topbar">
        <a className="brand" href="#home" aria-label="مركز الاستشارات والبحوث والتطوير">
          <span className="brand-mark">{isEn ? 'C' : 'م'}</span><span><strong>{isEn ? 'Consultation, Research' : 'مركز الاستشارات'}</strong><small>{isEn ? '& Development Center · SAMS' : 'والبحوث والتطوير · أكاديمية السادات'}</small></span>
        </a>
        <div className="researcher-top-actions"><span className="welcome-name">{isEn ? 'Welcome,' : 'أهلاً،'} {profile.full_name}</span><button className="quiet-button" onClick={onSignOut}>{isEn ? 'Sign Out' : 'تسجيل الخروج'}</button></div>
      </header>

      <nav className="researcher-nav" aria-label="التنقل في حساب الباحث">
        {navItems.map((item) => <button key={item.id} className={view === item.id ? 'active' : ''} aria-current={view === item.id ? 'page' : undefined} onClick={() => chooseView(item.id)}>{item.label}</button>)}
      </nav>

      {notice && <p className="message success portal-message" role="status">{notice}</p>}
      {error && <p className="message error portal-message" role="alert">{error}</p>}
      {loading ? <div className="loading portal-loading"><span className="spinner" /> بنحمّل بيانات حسابك...</div> : (
        <section className="portal-content" aria-live="polite">
          {view === 'home' && <ResearcherGuideHome applicantType={profile.applicant_type} onStartRequest={() => chooseView('catalog')} />}
          {view === 'catalog' && <>
            <div className="portal-card" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}><div><span className="eyebrow">{isEn ? 'CRDC Procedural Guide' : 'الدليل الإجرائي للمركز'}</span><p style={{ margin: '0.25rem 0 0' }}>{isEn ? 'New to the center? Explore the 5 services, degree requirements, payment steps, and accredited journals.' : 'تعرّف على خدمات المركز الخمس، متطلبات درجتك العلمية، خطوات السداد، والمجلات المعتمدة.'}</p></div><button type="button" className="quiet-button" onClick={() => chooseView('home')}>{isEn ? '📖 Open Services Guide' : '📖 استعراض الدليل الإجرائي'}</button></div><div className="portal-heading"><span className="eyebrow">{isEn ? 'Center Services' : 'خدمات المركز'}</span><h1>{isEn ? 'Submit a New Request' : 'قدّم طلب جديد'}</h1><p>{isEn ? 'Each thesis or paper has a separate request. You can select multiple services for the same work.' : 'كل رسالة أو بحث له طلب مستقل. تقدر تختار أكتر من خدمة لنفس العمل.'}</p></div>
            <div className="catalog-layout">
              <form className="portal-card form-stack" onSubmit={submitRequest}>
                <div className="card-heading"><span className="card-icon">✳</span><div><span className="eyebrow">{isEn ? 'Work Details' : 'بيانات العمل'}</span><h2>{isEn ? 'Select Request Type & Services' : 'حدد نوع الطلب والخدمات'}</h2></div></div>
                <label>{isEn ? 'Work Type' : 'نوع العمل'}<select name="work_type" value={workType} onChange={(event) => setWorkType(event.target.value as WorkType)}><option value="thesis">{isEn ? 'Academic Thesis' : 'رسالة علمية'}</option><option value="paper">{isEn ? 'Research Paper for Publication' : 'بحث للنشر'}</option></select></label>
                <label>{isEn ? 'Thesis or Paper Title' : 'عنوان الرسالة أو البحث'}<input name="work_title" required minLength={3} maxLength={300} placeholder={isEn ? 'Enter the title of your work' : 'اكتب عنوان العمل'} /></label>
                <label>{isEn ? 'Page Count' : 'عدد الصفحات'}{!pageCountRequired && <small>{isEn ? 'Optional depending on selected services' : 'اختياري حسب الخدمات المختارة'}</small>}<input name="page_count" type="number" min="1" max="2000" step="1" required={pageCountRequired} placeholder={isEn ? 'e.g., 25' : 'مثال: 25'} /></label>
                <div className="service-groups">
                  {services.map((service) => {
                    const options = fees.filter((fee) => fee.service_id === service.service_id)
                    if (!options.length) return null
                    return <fieldset className="service-group" key={service.service_id}>
                      <legend>{translateDbText(service.name_ar, isEn)}</legend>
                      {options.map((fee) => <label className="fee-option" key={fee.fee_id}>
                        <input type="checkbox" checked={selectedFeeIds.includes(fee.fee_id)} onChange={() => toggleFee(fee.fee_id)} />
                        <span className="fee-option-copy"><strong>{optionLabel(fee.option_code)}</strong><small>السعر الأساسي <Money amount={fee.base_fee} currency={fee.currency} />{fee.included_pages ? isEn ? ` · includes ${fee.included_pages} pages` : ` · يشمل ${fee.included_pages} صفحة` : ''}{fee.extra_page_fee !== null ? (isEn ? ' · plus extra pages per official tariff' : ' · وأي صفحات إضافية حسب التعريفة المسجلة') : ''}</small></span>
                      </label>)}
                    </fieldset>
                  })}
                  {!fees.length && <p className="empty-state">مفيش خدمات متاحة حاليًا لنوع حسابك.</p>}
                </div>
                <p className="form-footnote">{isEn ? 'The final amount is calculated according to the approved tariff. The listed price is the base fee only, excluding extra pages.' : 'المبلغ النهائي بيتحسب ويتسجل في قاعدة البيانات حسب التعريفة المعتمدة. السعر المعروض هنا أساسي فقط، ومش شامل حساب الصفحات الإضافية.'}</p>
                <button className="primary-button" disabled={submitting || fees.length === 0}>{submitting ? (isEn ? 'Submitting request...' : 'بنسجل الطلب...') : (isEn ? 'Submit Request' : 'تقديم الطلب')} <span>{isEn ? '→' : '←'}</span></button>
              </form>
              <aside className="portal-card requirement-card"><span className="eyebrow">{isEn ? 'Degree Requirements' : 'متطلبات درجتك'}</span><h2>{isEn ? 'Academic Requirements' : 'المتطلبات الأكاديمية'}</h2><p>{isEn ? 'These are the registered requirements for your degree to review before submitting.' : 'دي المتطلبات المسجلة لدرجتك في النظام، للمراجعة قبل تقديم الطلب.'}</p>
                {requirements.length ? <ul className="requirement-list">{requirements.map((requirement) => <li key={requirement.requirement_code}><span>{translateDbText(requirement.name_ar, isEn)}</span><strong>{requirement.min_count} {isEn ? 'time(s)' : 'مرة'}</strong></li>)}</ul> : <p className="empty-state">مفيش متطلبات مسجلة للدرجة العلمية دي.</p>}
              </aside>
            </div>
          </>}

          {view === 'requests' && <>
            <div className="portal-heading"><span className="eyebrow">{isEn ? 'Request Tracking' : 'متابعة الطلبات'}</span><h1>{detail ? 'تفاصيل الطلب' : (isEn ? 'My Requests' : 'طلباتي')}</h1><p>كل طلب خاص بعمل واحد، وتفاصيل حالة كل خدمة بتظهر لوحدها.</p></div>
            {detailLoading ? <div className="loading portal-loading"><span className="spinner" /> بنحمّل تفاصيل الطلب...</div> : detail ? <>
              <button className="back-button" onClick={() => setDetail(null)}>{isEn ? '← Back to My Requests' : '→ رجوع لطلباتي'}</button>
              <article className="portal-card request-detail-card">
                <div className="request-card-heading"><div><span className="eyebrow">{detail.request.work_type === 'thesis' ? 'رسالة علمية' : 'بحث للنشر'}</span><h2>{detail.request.work_title}</h2></div><span className="date-chip">{formatDate(detail.request.created_at)}</span></div>
                <p className="detail-pages">عدد الصفحات: {detail.request.page_count ?? '—'}</p>
                <div className="item-list">{detail.items.map((item) => {
                  const fee = detail.fees.find((row) => row.fee_id === item.fee_id)
                  const service = detail.services.find((row) => row.service_id === item.service_id)
                  const payment = detail.payments.find((row) => String(row.payment_id) === String(item.payment_id))
                  const publication = detail.publications.find((row) => String(row.item_id) === String(item.item_id))
                  const journal = publication && detail.journals.find((row) => row.journal_id === publication.journal_id)
                  const issue = publication?.issue_id && detail.issues.find((row) => row.issue_id === publication.issue_id)
                  return <section className="request-item" key={item.item_id}>
                    <div className="request-item-heading"><div><span className="eyebrow">{service?.name_ar ?? 'خدمة'}</span><h3>{optionLabel(fee?.option_code ?? '')}</h3></div><span className="status-pill">{statusName(detail.statuses.find((status) => status.status_id === item.status_id))}</span></div>
                    <div className="item-facts"><span>المبلغ المسجل</span><strong><Money amount={item.amount_due} currency={item.currency} /></strong><span>حالة السداد</span><strong>{payment ? (payment.paid_at ? `تم السداد · ${formatDate(payment.paid_at)}` : 'إذن الدفع مسجل') : 'لم يُسجل دفع بعد'}</strong>{payment?.payment_order_no && <><span>رقم إذن الدفع</span><strong><Ltr>{payment.payment_order_no}</Ltr></strong></>}{payment?.receipt_no && <><span>رقم الإيصال</span><strong><Ltr>{payment.receipt_no}</Ltr></strong></>}</div>
                    {publication && <div className="publication-facts"><strong>بيانات النشر</strong><span>المجلة: {journal?.name_ar ?? '—'}</span><span>اللغة: {publication.paper_language === 'ar' ? 'العربية' : 'الإنجليزية'}</span><span>قرار النشر: {decisionLabel(publication.decision)}</span>{issue && <span>العدد: {issue.issue_month}/{issue.issue_year}</span>}{publication.accepted_at && <span>تاريخ القبول: {formatDate(publication.accepted_at)}</span>}</div>}
                    <div className="timeline"><h4>سجل الحالة</h4>{detail.history.filter((event) => String(event.item_id) === String(item.item_id)).map((event) => <div className="timeline-row" key={event.history_id}><span className="timeline-dot" /><div><strong>{statusName(detail.statuses.find((status) => status.status_id === event.status_id))}</strong>{event.note && <p>{event.note}</p>}<time>{formatDate(event.changed_at)}</time></div></div>)}</div>
                  </section>
                })}</div>
                {detail.payments.map((payment) => {
                  const paymentItems = detail.items.filter((item) => String(item.payment_id) === String(payment.payment_id))
                  if (!paymentItems.length) return null
                  const paymentStatus = payment.receipt_status === 'pending_review' ? 'بانتظار مراجعة الخزينة'
                    : payment.receipt_status === 'verified' ? 'تم اعتماد السداد'
                      : payment.receipt_status === 'rejected' ? 'مرفوض — يرجى إعادة الرفع'
                        : 'ارفع إيصال الدفع'
                  const canSubmitReceipt = ['awaiting_receipt','rejected'].includes(payment.receipt_status)
                    && payment.payment_order_no !== null
                    && paymentItems.every((item) => detail.statuses.find((status) => status.status_id === item.status_id)?.code === 'PAYMENT_ORDER')
                  return <section className="portal-card payment-receipt-card" data-testid="payment-receipt-card" key={payment.payment_id}>
                    <div className="payment-receipt-heading"><div><span className="eyebrow">إيصال السداد</span><h3>إذن الدفع <Ltr>{payment.payment_order_no ?? String(payment.payment_id)}</Ltr></h3></div><span className={`status-pill receipt-status-${payment.receipt_status}`}>{paymentStatus}</span></div>
                    <p>المبلغ المطلوب <strong><Money amount={payment.amount} currency={payment.currency} /></strong></p>
                    {payment.receipt_status === 'rejected' && payment.rejection_reason && <p className="message error receipt-rejection-reason">سبب الرفض: {payment.rejection_reason}</p>}
                    {payment.receipt_status === 'pending_review' && payment.receipt_no && <p>رقم الإيصال: <Ltr>{payment.receipt_no}</Ltr></p>}
                    {payment.receipt_status === 'verified' && payment.paid_at && <p>تاريخ السداد: {formatDate(payment.paid_at)}</p>}
                    {canSubmitReceipt && <PaymentReceiptForm payment={payment} items={paymentItems} services={detail.services} onSubmit={submitPaymentReceipt} onError={(message) => setError(message)} />}
                  </section>
                })}
                {!detail.items.length && <p className="empty-state">مفيش خدمات مرتبطة بالطلب ده.</p>}
              </article>
            </> : requests.length ? <div className="request-list">{requests.map((request) => <button className="request-card" key={request.request_id} onClick={() => void loadRequestDetail(String(request.request_id))}>
              <span className="request-type">{request.work_type === 'thesis' ? 'رسالة علمية' : 'بحث للنشر'}</span><strong>{request.work_title}</strong><span className="request-card-meta">{formatDate(request.created_at)} · {request.page_count ?? '—'} صفحة</span><span className="request-card-status">{overallStatus(request.request_id, statuses, statusById, requestStatusIds)}</span><span className="request-arrow">{isEn ? '→' : '←'}</span>
            </button>)}</div> : <div className="portal-card empty-requests"><span className="success-orbit"><span>↗</span></span><h2>{isEn ? 'No Requests Yet' : 'لسه مفيش طلبات'}</h2><p>لما تقدم طلب جديد هتقدر تتابع تفاصيله وحالته من هنا.</p><button className="primary-button" onClick={() => chooseView('catalog')}>استعراض الخدمات <span>{isEn ? '→' : '←'}</span></button></div>}
          </>}

          {view === 'profile' && <>
            <div className="portal-heading"><span className="eyebrow">{isEn ? 'Researcher Account' : 'حساب الباحث'}</span><h1>{isEn ? 'My Profile' : 'ملفي الشخصي'}</h1><p>بياناتك الأساسية المسجلة في حساب الباحث.</p></div>
            <article className="portal-card profile-card"><div className="profile-card-header"><div className="success-orbit"><span>✓</span></div><div><span className="eyebrow">حسابك جاهز</span><h2>{profile.full_name}</h2></div></div>
              <h3>{isEn ? 'Edit Personal Details' : 'تعديل البيانات الشخصية'}</h3>
              <form className="form-stack" onSubmit={submitProfileEdit}>
                <label>{isEn ? 'Applicant Type' : 'نوع الباحث'}<input value={profile.applicant_type === 'egyptian' ? (isEn ? 'Egyptian' : 'مصري') : (isEn ? 'International / Foreign' : 'وافد')} readOnly /></label>
                <label>{isEn ? 'Email Address' : 'البريد الإلكتروني'}<input value={profile.email} dir="ltr" readOnly /></label>
                <label>{profile.applicant_type === 'egyptian' ? 'الرقم القومي' : 'رقم جواز السفر'}<input value={profile.applicant_type === 'egyptian' ? profile.national_id ?? '' : profile.passport_no ?? ''} dir="ltr" readOnly /></label>
                {profile.applicant_type === 'foreign' && <label>الجنسية<input value={profile.nationality ?? ''} readOnly /></label>}
                <label>{isEn ? 'Full Name' : 'الاسم بالكامل'}<input name="full_name" defaultValue={profile.full_name} minLength={3} required /></label>
                <label>{isEn ? 'Academic Degree' : 'الدرجة العلمية'}<select name="degree_id" defaultValue={profile.degree_id ?? ''}><option value="">بدون تحديد</option>{degrees.map((degree) => <option key={degree.degree_id} value={degree.degree_id}>{translateDbText(degree.name_ar, isEn)}</option>)}</select></label>
                <label>{isEn ? 'Specialty' : 'التخصص'}<input name="specialty" defaultValue={profile.specialty ?? ''} /></label>
                <button className="primary-button" disabled={profileSaving}>{profileSaving ? (isEn ? 'Saving changes...' : 'بنحفظ التعديلات...') : (isEn ? 'Save Changes' : 'حفظ التعديلات')}</button>
              </form>
              <dl className="profile-details"><dt>تاريخ إنشاء الملف</dt><dd>{formatDate(profile.created_at)}</dd></dl>
            </article>
          </>}
        </section>
      )}

      <footer className="page-footer"><span>CRDC</span><span>مركز الاستشارات والبحوث والتطوير</span><span>نموذج أولي · بياناتك في أمان</span></footer>
    </main>
  )
}

function overallStatus(requestId: number | string, statuses: StatusRow[], statusById: Map<number, StatusRow>, requestStatusIds: Map<string, number[]>) {
  const itemStatuses = requestStatusIds.get(String(requestId)) ?? []
  const names = [...new Set(itemStatuses.map((id) => statusName(statusById.get(id))))]
  return names.length === 1 ? names[0] : names.length > 1 ? 'الخدمات في مراحل مختلفة' : statuses.find((status) => status.code === 'SUBMITTED')?.name_ar ?? 'تم التقديم'
}

function optionLabel(code: string) {
  const labels: Record<string, string> = {
    PUB_ARBITRATION: 'تحكيم البحث', PUB_PUBLISH: 'نشر البحث', LANG_AR: 'تدقيق لغوي عربي', LANG_EN: 'تدقيق لغوي إنجليزي',
    STAT_REVIEW: 'مراجعة إحصائية', STAT_ANALYSIS: 'تحليل إحصائي', DT_COURSE_EXAM: 'دورة واختبار التحول الرقمي',
    DT_EXAM_ONLY: 'اختبار التحول الرقمي فقط', DT_RETAKE: 'إعادة اختبار التحول الرقمي', PLAG: 'قياس نسبة الاقتباس',
  }
  return labels[code] ?? code
}

function decisionLabel(decision: PublicationRow['decision']) {
  return ({ pending: 'قيد التحكيم', revisions: 'تعديلات مطلوبة', accepted: 'مقبول', rejected: 'مرفوض' })[decision]
}

function PaymentReceiptForm({
  payment,
  items,
  services,
  onSubmit,
  onError,
}: {
  payment: PaymentRow
  items: ItemRow[]
  services: Service[]
  onSubmit: (payment: PaymentRow, formData: FormData) => Promise<void>
  onError: (message: string) => void
}) {
  const [submitting, setSubmitting] = useState(false)
  const singleFlight = useSingleFlight()

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    setSubmitting(true)
    onError('')
    try {
      await singleFlight(() => onSubmit(payment, new FormData(form)))
    } catch (submitError) {
      onError(friendlyError(submitError))
    } finally {
      setSubmitting(false)
    }
  }

  return <form className="payment-receipt-form" onSubmit={handleSubmit}>
    <div className="receipt-covered-items"><strong>الخدمات المشمولة بالإيصال</strong><ul>{items.map((item) => <li key={item.item_id}>
      <span>{services.find((service) => service.service_id === item.service_id)?.name_ar ?? 'خدمة'}</span>
      <Money amount={item.amount_due} currency={item.currency} />
    </li>)}</ul></div>
    <label>قناة السداد<select name="channel" defaultValue={payment.channel} required>
      <option value="treasury">الخزينة</option><option value="bank">البنك</option>
    </select></label>
    <label>رقم الإيصال<input name="receipt_no" required maxLength={100} autoComplete="off" /></label>
    <label>تاريخ السداد<input name="paid_at" type="date" required max={new Date().toISOString().slice(0, 10)} /></label>
    <label>صورة أو ملف الإيصال<input name="receipt_file" type="file" required accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" /><small>PDF أو JPG أو PNG، بحد أقصى ٥ ميجابايت.</small></label>
    <button className="primary-button" type="submit" disabled={submitting}>{submitting ? 'بنرفع الإيصال...' : 'إرسال الإيصال للمراجعة'}</button>
  </form>
}

