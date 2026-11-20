import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from './supabase'

type ApplicantType = 'egyptian' | 'foreign'
type WorkType = 'thesis' | 'paper'
type View = 'catalog' | 'requests' | 'profile'

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
}

const statusName = (status: StatusRow | undefined) => status?.name_ar ?? 'غير محدد'
const formatDate = (value: string | null | undefined) =>
  value ? new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium' }).format(new Date(value)) : '—'
const money = (amount: number | string, currency: string) =>
  new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(Number(amount)) + ` ${currency}`

function friendlyError(error: unknown) {
  const raw = error instanceof Error ? error.message : ''
  if (raw.includes('Publication services require a separate paper request')) return 'خدمة النشر بتتقدم في طلب بحث منفصل عن الرسالة.'
  if (raw.includes('Page count is required')) return 'اكتب عدد الصفحات علشان نكمل الطلب.'
  if (raw.includes('Select at least one service')) return 'اختار خدمة واحدة على الأقل.'
  if (raw.includes('Fee option is unavailable')) return 'الخدمة دي مش متاحة لنوع حسابك حاليًا. حدّث الصفحة وجرب تاني.'
  if (raw.includes('profile before submitting')) return 'كمّل ملف الباحث الأول علشان تقدر تقدم طلب.'
  return raw || 'حصلت مشكلة. جرّب تاني، ولو استمرت تواصل مع إدارة المركز.'
}

export default function ResearcherPortal({ profile, onSignOut }: { profile: ResearcherProfile; onSignOut: () => void }) {
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
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

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
        paymentIds.length ? supabase.schema('crdc').from('payments').select('payment_id, payment_order_no, receipt_no, amount, currency, channel, paid_at').in('payment_id', paymentIds) : Promise.resolve({ data: [], error: null }),
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

  const statusById = useMemo(() => new Map(statuses.map((status) => [status.status_id, status])), [statuses])

  function toggleFee(feeId: number) {
    setSelectedFeeIds((current) => current.includes(feeId) ? current.filter((id) => id !== feeId) : [...current, feeId])
  }

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const title = String(form.get('work_title') ?? '').trim()
    const pageCount = Number(form.get('page_count'))
    if (selectedFeeIds.length === 0) { setError('اختار خدمة واحدة على الأقل.'); return }
    if (!title) { setError('اكتب عنوان الرسالة أو البحث.'); return }
    if (!Number.isInteger(pageCount) || pageCount < 1) { setError('عدد الصفحات لازم يكون رقم صحيح أكبر من صفر.'); return }
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
      setNotice('اتسجل طلبك بنجاح. تقدر تتابع حالته من صفحة طلباتي.')
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
    { id: 'catalog', label: 'كتالوج الخدمات وتقديم طلب جديد' },
    { id: 'requests', label: 'طلباتي' },
    { id: 'profile', label: 'ملفي الشخصي' },
  ]

  function chooseView(next: View) {
    setView(next)
    setError('')
    setDetail(null)
    if (next === 'requests') void loadRequests().catch((loadError: unknown) => setError(friendlyError(loadError)))
  }

  return (
    <main className="page-shell researcher-shell" dir="rtl">
      <header className="topbar">
        <a className="brand" href="#home" aria-label="مركز الاستشارات والبحوث والتطوير">
          <span className="brand-mark">م</span><span><strong>مركز الاستشارات</strong><small>والبحوث والتطوير · أكاديمية السادات</small></span>
        </a>
        <div className="researcher-top-actions"><span className="welcome-name">أهلاً، {profile.full_name}</span><button className="quiet-button" onClick={onSignOut}>تسجيل الخروج</button></div>
      </header>

      <nav className="researcher-nav" aria-label="التنقل في حساب الباحث">
        {navItems.map((item) => <button key={item.id} className={view === item.id ? 'active' : ''} aria-current={view === item.id ? 'page' : undefined} onClick={() => chooseView(item.id)}>{item.label}</button>)}
      </nav>

      {notice && <p className="message success portal-message" role="status">{notice}</p>}
      {error && <p className="message error portal-message" role="alert">{error}</p>}
      {loading ? <div className="loading portal-loading"><span className="spinner" /> بنحمّل بيانات حسابك...</div> : (
        <section className="portal-content" aria-live="polite">
          {view === 'catalog' && <>
            <div className="portal-heading"><span className="eyebrow">خدمات المركز</span><h1>قدّم طلب جديد</h1><p>كل رسالة أو بحث له طلب مستقل. تقدر تختار أكتر من خدمة لنفس العمل.</p></div>
            <div className="catalog-layout">
              <form className="portal-card form-stack" onSubmit={submitRequest}>
                <div className="card-heading"><span className="card-icon">✳</span><div><span className="eyebrow">بيانات العمل</span><h2>حدد نوع الطلب والخدمات</h2></div></div>
                <label>نوع العمل<select name="work_type" value={workType} onChange={(event) => setWorkType(event.target.value as WorkType)}><option value="thesis">رسالة علمية</option><option value="paper">بحث للنشر</option></select></label>
                <label>عنوان الرسالة أو البحث<input name="work_title" required minLength={3} maxLength={300} placeholder="اكتب عنوان العمل" /></label>
                <label>عدد الصفحات<input name="page_count" type="number" min="1" step="1" required placeholder="مثال: 25" /></label>
                <div className="service-groups">
                  {services.map((service) => {
                    const options = fees.filter((fee) => fee.service_id === service.service_id)
                    if (!options.length) return null
                    return <fieldset className="service-group" key={service.service_id}>
                      <legend>{service.name_ar}</legend>
                      {options.map((fee) => <label className="fee-option" key={fee.fee_id}>
                        <input type="checkbox" checked={selectedFeeIds.includes(fee.fee_id)} onChange={() => toggleFee(fee.fee_id)} />
                        <span className="fee-option-copy"><strong>{optionLabel(fee.option_code)}</strong><small>السعر الأساسي {money(fee.base_fee, fee.currency)}{fee.included_pages ? ` · يشمل ${fee.included_pages} صفحة` : ''}{fee.extra_page_fee !== null ? ' · وأي صفحات إضافية حسب التعريفة المسجلة' : ''}</small></span>
                      </label>)}
                    </fieldset>
                  })}
                  {!fees.length && <p className="empty-state">مفيش خدمات متاحة حاليًا لنوع حسابك.</p>}
                </div>
                <p className="form-footnote">المبلغ النهائي بيتحسب ويتسجل في قاعدة البيانات حسب التعريفة المعتمدة. السعر المعروض هنا أساسي فقط، ومش شامل حساب الصفحات الإضافية.</p>
                <button className="primary-button" disabled={submitting || fees.length === 0}>{submitting ? 'بنسجل الطلب...' : 'تقديم الطلب'} <span>←</span></button>
              </form>
              <aside className="portal-card requirement-card"><span className="eyebrow">متطلبات درجتك</span><h2>المتطلبات الأكاديمية</h2><p>دي المتطلبات المسجلة لدرجتك في النظام، للمراجعة قبل تقديم الطلب.</p>
                {requirements.length ? <ul className="requirement-list">{requirements.map((requirement) => <li key={requirement.requirement_code}><span>{requirement.name_ar}</span><strong>{requirement.min_count} مرة</strong></li>)}</ul> : <p className="empty-state">مفيش متطلبات مسجلة للدرجة العلمية دي.</p>}
              </aside>
            </div>
          </>}

          {view === 'requests' && <>
            <div className="portal-heading"><span className="eyebrow">متابعة الطلبات</span><h1>{detail ? 'تفاصيل الطلب' : 'طلباتي'}</h1><p>كل طلب خاص بعمل واحد، وتفاصيل حالة كل خدمة بتظهر لوحدها.</p></div>
            {detailLoading ? <div className="loading portal-loading"><span className="spinner" /> بنحمّل تفاصيل الطلب...</div> : detail ? <>
              <button className="back-button" onClick={() => setDetail(null)}>→ رجوع لطلباتي</button>
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
                    <div className="item-facts"><span>المبلغ المسجل</span><strong>{money(item.amount_due, item.currency)}</strong><span>حالة السداد</span><strong>{payment ? (payment.paid_at ? `تم السداد · ${formatDate(payment.paid_at)}` : 'إذن الدفع مسجل') : 'لم يُسجل دفع بعد'}</strong>{payment?.payment_order_no && <><span>رقم إذن الدفع</span><strong>{payment.payment_order_no}</strong></>}{payment?.receipt_no && <><span>رقم الإيصال</span><strong>{payment.receipt_no}</strong></>}</div>
                    {publication && <div className="publication-facts"><strong>بيانات النشر</strong><span>المجلة: {journal?.name_ar ?? '—'}</span><span>اللغة: {publication.paper_language === 'ar' ? 'العربية' : 'الإنجليزية'}</span><span>قرار النشر: {decisionLabel(publication.decision)}</span>{issue && <span>العدد: {issue.issue_month}/{issue.issue_year}</span>}{publication.accepted_at && <span>تاريخ القبول: {formatDate(publication.accepted_at)}</span>}</div>}
                    <div className="timeline"><h4>سجل الحالة</h4>{detail.history.filter((event) => String(event.item_id) === String(item.item_id)).map((event) => <div className="timeline-row" key={event.history_id}><span className="timeline-dot" /><div><strong>{statusName(detail.statuses.find((status) => status.status_id === event.status_id))}</strong>{event.note && <p>{event.note}</p>}<time>{formatDate(event.changed_at)}</time></div></div>)}</div>
                  </section>
                })}</div>
                {!detail.items.length && <p className="empty-state">مفيش خدمات مرتبطة بالطلب ده.</p>}
              </article>
            </> : requests.length ? <div className="request-list">{requests.map((request) => <button className="request-card" key={request.request_id} onClick={() => void loadRequestDetail(String(request.request_id))}>
              <span className="request-type">{request.work_type === 'thesis' ? 'رسالة علمية' : 'بحث للنشر'}</span><strong>{request.work_title}</strong><span className="request-card-meta">{formatDate(request.created_at)} · {request.page_count ?? '—'} صفحة</span><span className="request-card-status">{overallStatus(request.request_id, statuses, statusById, requestStatusIds)}</span><span className="request-arrow">←</span>
            </button>)}</div> : <div className="portal-card empty-requests"><span className="success-orbit"><span>↗</span></span><h2>لسه مفيش طلبات</h2><p>لما تقدم طلب جديد هتقدر تتابع تفاصيله وحالته من هنا.</p><button className="primary-button" onClick={() => chooseView('catalog')}>استعراض الخدمات <span>←</span></button></div>}
          </>}

          {view === 'profile' && <>
            <div className="portal-heading"><span className="eyebrow">حساب الباحث</span><h1>ملفي الشخصي</h1><p>بياناتك الأساسية المسجلة في حساب الباحث.</p></div>
            <article className="portal-card profile-card"><div className="profile-card-header"><div className="success-orbit"><span>✓</span></div><div><span className="eyebrow">حسابك جاهز</span><h2>{profile.full_name}</h2></div></div><dl className="profile-details"><dt>نوع الباحث</dt><dd>{profile.applicant_type === 'egyptian' ? 'مصري' : 'وافد'}</dd><dt>البريد الإلكتروني</dt><dd dir="ltr">{profile.email}</dd><dt>{profile.applicant_type === 'egyptian' ? 'الرقم القومي' : 'رقم جواز السفر'}</dt><dd dir="ltr">{profile.applicant_type === 'egyptian' ? profile.national_id : profile.passport_no}</dd>{profile.applicant_type === 'foreign' && <><dt>الجنسية</dt><dd>{profile.nationality}</dd></>}<dt>الدرجة العلمية</dt><dd>{profile.degree_name || '—'}</dd><dt>التخصص</dt><dd>{profile.specialty || '—'}</dd><dt>تاريخ إنشاء الملف</dt><dd>{formatDate(profile.created_at)}</dd></dl><p className="form-footnote">تعديل البيانات الشخصية بيتم عن طريق إدارة المركز.</p></article>
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

