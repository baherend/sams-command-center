import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { UiError, friendlyError, useSingleFlight } from './errors'

type StaffRole = 'admin' | 'reviewer' | 'statistician' | 'cashier' | 'viewer'
type StaffProfile = { staff_id: string; full_name: string; role: StaffRole; is_active: boolean }
type SummaryRow = { metric: string; category: string; label: string; request_count: number | string }
type WorkType = 'thesis' | 'paper'
type QueueRequest = {
  request_id: number
  researcher_id: string
  applicant_type: 'egyptian' | 'foreign'
  work_type: WorkType
  work_title: string
  page_count: number | null
  created_at: string
  queue_status_code: string
  item_count: number
  has_more: boolean
}
type Requester = { researcher_id: string; full_name: string; email: string; applicant_type: 'egyptian' | 'foreign' }
type RequestItem = { item_id: number; request_id: number; service_id: number; status_id: number; assigned_staff_id: string | null }
type RequestStatus = { status_id: number; code: string; name_ar: string; sort_order: number }
type HistoryRow = { history_id: number; item_id: number; status_id: number; changed_at: string; note: string | null }
type PublicationRow = { submission_id: number; item_id: number; journal_id: number; issue_id: number | null; decision: 'pending' | 'revisions' | 'accepted' | 'rejected'; accepted_at: string | null }
type Journal = { journal_id: number; name_ar: string }
type JournalIssue = { issue_id: number; journal_id: number; issue_year: number; issue_month: number }
type CashierPayment = {
  payment_id: number
  request_id: number
  receipt_no: string
  amount: number | string
  currency: 'EGP' | 'USD'
  channel: 'treasury' | 'bank'
  paid_at: string
  receipt_storage_path: string
  submitted_by_researcher_at: string
  has_more: boolean
}
type CashierContact = { request_id: number; work_type: WorkType; work_title: string; full_name: string; email: string; applicant_type: 'egyptian' | 'foreign' }
type CashierItem = { item_id: number; payment_id: number; request_id: number; fee_id: number; service_id: number; currency: string; amount_due: number | string; status_id: number }
type CashierItemDisplay = CashierItem & { service_name: string; option_code: string }
type CashierCursor = { submitted_by_researcher_at: string; payment_id: number }
type CashierQueueRow = { payment: CashierPayment; contact: CashierContact | undefined; items: CashierItemDisplay[] }

const roleNames: Record<StaffRole, string> = {
  admin: 'مدير النظام', reviewer: 'مراجع', statistician: 'إحصائي', cashier: 'أمين خزينة', viewer: 'مشاهد',
}
type PageCursor = { created_at: string; request_id: number }
const receiptPageSize = 20
const pageSize = 20

const formatDate = (value: string) => new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium' }).format(new Date(value))

export default function StaffConsole({ staff, onSignOut }: { staff: StaffProfile; onSignOut: () => void }) {
  const [rows, setRows] = useState<SummaryRow[]>([])
  const [loadingOverview, setLoadingOverview] = useState(staff.role === 'admin' || staff.role === 'viewer')
  const [view, setView] = useState<'overview' | 'requests' | 'assigned' | 'cashier'>(staff.role === 'cashier' ? 'cashier' : 'overview')
  const [requests, setRequests] = useState<QueueRequest[]>([])
  const [requesters, setRequesters] = useState<Map<string, Requester>>(new Map())
  const [items, setItems] = useState<RequestItem[]>([])
  const [statuses, setStatuses] = useState<RequestStatus[]>([])
  const [staffMembers, setStaffMembers] = useState<StaffProfile[]>([])
  const [queueLoading, setQueueLoading] = useState(false)
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterWorkType, setFilterWorkType] = useState('all')
  const [pageIndex, setPageIndex] = useState(0)
  const [cursorStack, setCursorStack] = useState<(PageCursor | null)[]>([null])
  const [pageHasMore, setPageHasMore] = useState(false)
  const [busyRequest, setBusyRequest] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [publications, setPublications] = useState<PublicationRow[]>([])
  const [journals, setJournals] = useState<Journal[]>([])
  const [issues, setIssues] = useState<JournalIssue[]>([])
  const [selectedJournalByItem, setSelectedJournalByItem] = useState<Record<number, number>>({})
  const [selectedIssueByItem, setSelectedIssueByItem] = useState<Record<number, number | ''>>({})
  const [operationLoading, setOperationLoading] = useState(false)
  const [busyItem, setBusyItem] = useState<number | null>(null)
  const [cashierRows, setCashierRows] = useState<CashierQueueRow[]>([])
  const [cashierLoading, setCashierLoading] = useState(false)
  const [cashierPageIndex, setCashierPageIndex] = useState(0)
  const [cashierCursorStack, setCashierCursorStack] = useState<(CashierCursor | null)[]>([null])
  const [cashierHasMore, setCashierHasMore] = useState(false)
  const [cashierBusyPayment, setCashierBusyPayment] = useState<number | null>(null)
  const [cashierSignedUrls, setCashierSignedUrls] = useState<Record<number, string>>({})
  const [cashierReasons, setCashierReasons] = useState<Record<number, string>>({})
  const [cashierRefreshToken, setCashierRefreshToken] = useState(0)
  const singleFlight = useSingleFlight()
  const canViewOverview = staff.role === 'admin' || staff.role === 'viewer'
  const isAdmin = staff.role === 'admin'
  const isCashier = staff.role === 'cashier'
  const canOperate = isAdmin || staff.role === 'reviewer' || staff.role === 'statistician'
  const pageCursor = cursorStack[pageIndex] ?? null
  const cashierPageCursor = cashierCursorStack[cashierPageIndex] ?? null

  useEffect(() => {
    if (view !== 'cashier' || (!isAdmin && !isCashier) || !supabase) return
    let alive = true
    setCashierLoading(true)
    setError('')
    void (async () => {
      try {
        const { data: pageData, error: pageError } = await supabase.schema('crdc').rpc('cashier_payment_receipt_page', {
          p_after_submitted_at: cashierPageCursor?.submitted_by_researcher_at ?? null,
          p_after_payment_id: cashierPageCursor?.payment_id ?? null,
          p_direction: 'next',
        })
        if (pageError) throw pageError
        const fetchedPayments = (pageData ?? []) as CashierPayment[]
        const pagePayments = fetchedPayments.slice(0, receiptPageSize)
        const paymentIds = pagePayments.map((payment) => payment.payment_id)
        const requestIds = [...new Set(pagePayments.map((payment) => payment.request_id))]
        const [itemResult, contactResult, statusResult] = await Promise.all([
          paymentIds.length
            ? supabase.schema('crdc').from('request_items').select('item_id,payment_id,request_id,fee_id,service_id,currency,amount_due,status_id').in('payment_id', paymentIds).order('item_id')
            : Promise.resolve({ data: [], error: null }),
          requestIds.length
            ? supabase.schema('crdc').from('cashier_request_contacts').select('request_id,work_type,work_title,full_name,email,applicant_type').in('request_id', requestIds)
            : Promise.resolve({ data: [], error: null }),
          supabase.schema('crdc').from('request_statuses').select('status_id,code,name_ar,sort_order').order('sort_order'),
        ])
        if (itemResult.error || contactResult.error || statusResult.error) throw itemResult.error ?? contactResult.error ?? statusResult.error
        const itemRows = (itemResult.data ?? []) as CashierItem[]
        const serviceIds = [...new Set(itemRows.map((item) => item.service_id))]
        const feeIds = [...new Set(itemRows.map((item) => item.fee_id))]
        const [serviceResult, feeResult] = await Promise.all([
          serviceIds.length ? supabase.schema('crdc').from('services').select('service_id,name_ar').in('service_id', serviceIds) : Promise.resolve({ data: [], error: null }),
          feeIds.length ? supabase.schema('crdc').from('fee_schedule').select('fee_id,option_code').in('fee_id', feeIds) : Promise.resolve({ data: [], error: null }),
        ])
        if (serviceResult.error || feeResult.error) throw serviceResult.error ?? feeResult.error
        if (!alive) return
        const serviceNames = new Map((serviceResult.data ?? []).map((row) => [row.service_id, row.name_ar]))
        const feeCodes = new Map((feeResult.data ?? []).map((row) => [row.fee_id, row.option_code]))
        const contacts = new Map(((contactResult.data ?? []) as CashierContact[]).map((row) => [row.request_id, row]))
        const itemsByPayment = new Map<number, CashierItemDisplay[]>()
        for (const item of itemRows) {
          const display = { ...item, service_name: serviceNames.get(item.service_id) ?? 'خدمة', option_code: feeCodes.get(item.fee_id) ?? '' }
          itemsByPayment.set(item.payment_id, [...(itemsByPayment.get(item.payment_id) ?? []), display])
        }
        setCashierRows(pagePayments.map((payment) => ({
          payment,
          contact: contacts.get(payment.request_id),
          items: itemsByPayment.get(payment.payment_id) ?? [],
        })))
        setCashierHasMore(Boolean(fetchedPayments[0]?.has_more))
        setStatuses((statusResult.data ?? []) as RequestStatus[])
      } catch (queueError) {
        if (alive) setError(friendlyError(queueError))
      } finally {
        if (alive) setCashierLoading(false)
      }
    })()
    return () => { alive = false }
  }, [view, isAdmin, isCashier, cashierPageIndex, cashierPageCursor, cashierRefreshToken])

  useEffect(() => {
    if (!canViewOverview || !supabase) return
    let alive = true
    void (async () => {
      try {
        const { data, error: queryError } = await supabase.schema('crdc').from('staff_dashboard_overview')
          .select('metric, category, label, request_count')
        if (!alive) return
        if (queryError) setError('مش قادرين نحمّل الإحصائيات دلوقتي. جرّب تاني بعد شوية.')
        else setRows((data ?? []) as SummaryRow[])
      } catch {
        if (alive) setError('مش قادرين نحمّل الإحصائيات دلوقتي. جرّب تاني بعد شوية.')
      } finally {
        if (alive) setLoadingOverview(false)
      }
    })()
    return () => { alive = false }
  }, [canViewOverview])

  useEffect(() => {
    const shouldLoadPage = (view === 'requests' && isAdmin) || (view === 'assigned' && canOperate)
    if (!shouldLoadPage || !supabase) return
    let alive = true
    if (view === 'requests') setQueueLoading(true)
    else setOperationLoading(true)
    setError('')

    void (async () => {
      try {
        const { data: pageData, error: pageError } = await supabase.schema('crdc').rpc('staff_request_page', {
          p_after_created_at: pageCursor?.created_at ?? null,
          p_after_request_id: pageCursor?.request_id ?? null,
          p_direction: 'next',
          p_work_type: filterWorkType === 'all' ? null : filterWorkType,
          p_status_code: filterStatus === 'all' ? null : filterStatus,
        })
        if (pageError) throw pageError
        const fetchedRows = (pageData ?? []) as QueueRequest[]
        const requestRows = fetchedRows.slice(0, pageSize)
        const requestIds = requestRows.map((request) => request.request_id)
        const itemPromise = requestIds.length
          ? supabase.schema('crdc').from('request_items').select('item_id, request_id, service_id, status_id, assigned_staff_id').in('request_id', requestIds).order('item_id')
          : Promise.resolve({ data: [], error: null })
        const [itemResult, statusResult, staffResult] = await Promise.all([
          itemPromise,
          supabase.schema('crdc').from('request_statuses').select('status_id, code, name_ar, sort_order').order('sort_order'),
          isAdmin && view === 'requests'
            ? supabase.schema('crdc').from('staff_users').select('staff_id, full_name, role, is_active').order('full_name')
            : Promise.resolve({ data: [], error: null }),
        ])
        if (itemResult.error || statusResult.error || staffResult.error) throw itemResult.error ?? statusResult.error ?? staffResult.error
        const itemRows = (itemResult.data ?? []) as RequestItem[]
        const itemIds = itemRows.map((item) => item.item_id)

        let researcherRows: Requester[] = []
        if (isAdmin && view === 'requests' && requestRows.length) {
          const researcherIds = [...new Set(requestRows.map((request) => request.researcher_id))]
          const { data, error: researcherError } = await supabase.schema('crdc').from('researchers')
            .select('researcher_id, full_name, email, applicant_type').in('researcher_id', researcherIds)
          if (researcherError) throw researcherError
          researcherRows = (data ?? []) as Requester[]
        }

        let historyRows: HistoryRow[] = []
        let publicationRows: PublicationRow[] = []
        let journalRows: Journal[] = []
        let issueRows: JournalIssue[] = []
        if (view === 'assigned' && itemIds.length) {
          const [historyResult, publicationResult] = await Promise.all([
            supabase.schema('crdc').from('request_status_history')
              .select('history_id, item_id, status_id, changed_at, note').in('item_id', itemIds).order('changed_at', { ascending: false }),
            supabase.schema('crdc').from('publication_submissions')
              .select('submission_id, item_id, journal_id, issue_id, decision, accepted_at').in('item_id', itemIds),
          ])
          if (historyResult.error || publicationResult.error) throw historyResult.error ?? publicationResult.error
          historyRows = (historyResult.data ?? []) as HistoryRow[]
          publicationRows = (publicationResult.data ?? []) as PublicationRow[]
          const journalIds = [...new Set(publicationRows.map((publication) => publication.journal_id))]
          if (journalIds.length) {
            const [journalResult, issueResult] = await Promise.all([
              supabase.schema('crdc').from('journals').select('journal_id, name_ar').in('journal_id', journalIds),
              supabase.schema('crdc').from('journal_issues').select('issue_id, journal_id, issue_year, issue_month')
                .in('journal_id', journalIds).order('issue_year', { ascending: false }),
            ])
            if (journalResult.error || issueResult.error) throw journalResult.error ?? issueResult.error
            journalRows = (journalResult.data ?? []) as Journal[]
            issueRows = (issueResult.data ?? []) as JournalIssue[]
          }
        }

        if (!alive) return
        setRequests(requestRows)
        setPageHasMore(Boolean(fetchedRows[0]?.has_more))
        setItems(itemRows)
        setStatuses((statusResult.data ?? []) as RequestStatus[])
        setStaffMembers((staffResult.data ?? []) as StaffProfile[])
        setRequesters(new Map(researcherRows.map((researcher) => [researcher.researcher_id, researcher])))
        setHistory(historyRows)
        setPublications(publicationRows)
        setJournals(journalRows)
        setIssues(issueRows)
        setSelectedJournalByItem({})
        setSelectedIssueByItem({})
      } catch {
        if (alive) setError(view === 'requests'
          ? 'حصلت مشكلة وإحنا بنحمّل الطلبات. راجع الاتصال أو صلاحيات الحساب وحاول تاني.'
          : 'مش قادرين نحمّل الطلبات المسندة. جرّب تاني بعد شوية.')
      } finally {
        if (alive) {
          setQueueLoading(false)
          setOperationLoading(false)
        }
      }
    })()
    return () => { alive = false }
  }, [isAdmin, canOperate, view, filterStatus, filterWorkType, pageIndex, pageCursor])

  const countFor = (metric: string, category: string) =>
    Number(rows.find((row) => row.metric === metric && row.category === category)?.request_count ?? 0)
  const total = countFor('total', 'all')
  const egyptian = countFor('applicant_type', 'egyptian')
  const foreign = countFor('applicant_type', 'foreign')
  const summaryStatuses = rows.filter((row) => row.metric === 'status')
  const statusById = useMemo(() => new Map(statuses.map((status) => [status.status_id, status])), [statuses])
  const statusByCode = useMemo(() => new Map(statuses.map((status) => [status.code, status])), [statuses])
  const assignableStaff = staffMembers.filter((member) => member.is_active && (member.role === 'reviewer' || member.role === 'statistician'))

  const getRequestStatus = (request: QueueRequest) => ({
    code: request.queue_status_code,
    label: request.queue_status_code === 'MIXED' ? 'مراحل مختلفة'
      : request.queue_status_code === 'NO_ITEMS' ? 'بدون بنود'
        : statusByCode.get(request.queue_status_code)?.name_ar ?? 'غير محدد',
  })

  function resetPagination() {
    setPageIndex(0)
    setCursorStack([null])
  }

  function nextPage() {
    if (!pageHasMore || !requests.length) return
    const lastRequest = requests[requests.length - 1]
    setCursorStack((current) => [
      ...current.slice(0, pageIndex + 1),
      { created_at: lastRequest.created_at, request_id: lastRequest.request_id },
    ])
    setPageIndex((current) => current + 1)
  }

  function previousPage() {
    if (pageIndex > 0) setPageIndex((current) => current - 1)
  }

  function nextCashierPage() {
    if (!cashierHasMore || !cashierRows.length) return
    const lastPayment = cashierRows[cashierRows.length - 1].payment
    setCashierCursorStack((current) => [
      ...current.slice(0, cashierPageIndex + 1),
      { submitted_by_researcher_at: lastPayment.submitted_by_researcher_at, payment_id: lastPayment.payment_id },
    ])
    setCashierPageIndex((current) => current + 1)
  }

  function previousCashierPage() {
    if (cashierPageIndex > 0) setCashierPageIndex((current) => current - 1)
  }

  async function previewReceipt(payment: CashierPayment) {
    if (!supabase) return
    setError('')
    const { data, error: signedError } = await supabase.storage.from('payment-receipts')
      .createSignedUrl(payment.receipt_storage_path, 300)
    if (signedError) { setError(friendlyError(signedError)); return }
    setCashierSignedUrls((current) => ({ ...current, [payment.payment_id]: data.signedUrl }))
  }

  async function approveReceipt(payment: CashierPayment) {
    if (!supabase) return
    setCashierBusyPayment(payment.payment_id); setError(''); setNotice('')
    try {
      const { error: approveError } = await supabase.schema('crdc').rpc('approve_payment_receipt', { p_payment_id: payment.payment_id })
      if (approveError) throw approveError
      setNotice('تم اعتماد السداد وتحديث حالات الخدمات.')
      setCashierSignedUrls((current) => { const next = { ...current }; delete next[payment.payment_id]; return next })
      setCashierRefreshToken((value) => value + 1)
    } catch (approveError) {
      setError(friendlyError(approveError))
    } finally {
      setCashierBusyPayment(null)
    }
  }

  async function rejectReceipt(payment: CashierPayment, reason: string) {
    if (!supabase) return
    setCashierBusyPayment(payment.payment_id); setError(''); setNotice('')
    try {
      const { error: rejectError } = await supabase.schema('crdc').rpc('reject_payment_receipt', {
        p_payment_id: payment.payment_id,
        p_reason: reason.trim(),
      })
      if (rejectError) throw rejectError
      setNotice('تم رفض الإيصال وإرسال السبب للباحث.')
      setCashierSignedUrls((current) => { const next = { ...current }; delete next[payment.payment_id]; return next })
      setCashierReasons((current) => ({ ...current, [payment.payment_id]: '' }))
      setCashierRefreshToken((value) => value + 1)
    } catch (rejectError) {
      setError(friendlyError(rejectError))
    } finally {
      setCashierBusyPayment(null)
    }
  }

  async function assignRequest(request: QueueRequest, staffId: string) {
    if (!supabase || !staffId) return
    setBusyRequest(request.request_id)
    setError('')
    setNotice('')
    try {
      const requestItems = items.filter((item) => item.request_id === request.request_id)
      if (!requestItems.length) throw new UiError('الطلب ده مفيهوش بنود ينفع تتعيّن.')
      const selectedStaff = assignableStaff.find((member) => member.staff_id === staffId)
      if (!selectedStaff) throw new UiError('اختار مراجع أو إحصائي نشط من القائمة.')
      const { data, error: updateError } = await supabase.schema('crdc').from('request_items')
        .update({ assigned_staff_id: staffId })
        .eq('request_id', request.request_id)
        .select('item_id')
      if (updateError) throw updateError
      if ((data ?? []).length !== requestItems.length) throw new UiError('ماقدرناش نأكد تعيين كل بنود الطلب. حدّث القائمة وراجع الطلب.')
      setItems((current) => current.map((item) => item.request_id === request.request_id ? { ...item, assigned_staff_id: staffId } : item))
      setNotice(`اتعيّن ${roleNames[selectedStaff.role]} ${selectedStaff.full_name} على كل بنود الطلب رقم ${request.request_id}.`)
    } catch (assignmentError) {
      setError(friendlyError(assignmentError, { '42501': 'التعيين مرفوض. اتأكد إن الحساب أدمن والموظف مراجع أو إحصائي نشط.' }))
    } finally {
      setBusyRequest(null)
    }
  }

  async function updateStatus(item: RequestItem, statusCode: string, note: string) {
    if (!supabase || !statusCode) return
    setBusyItem(item.item_id); setError(''); setNotice('')
    try {
      const { error: rpcError } = await supabase.schema('crdc').rpc('set_request_item_status', { p_item_id: item.item_id, p_status_code: statusCode, p_note: note.trim() || null })
      if (rpcError) throw rpcError
      const nextStatus = statuses.find((status) => status.code === statusCode)
      if (!nextStatus) throw new UiError('الحالة غير متاحة.')
      const { data: savedHistory, error: historyError } = await supabase.schema('crdc').from('request_status_history')
        .select('history_id, item_id, status_id, changed_at, note').eq('item_id', item.item_id).order('changed_at', { ascending: false })
      if (historyError) throw historyError
      setItems((current) => current.map((row) => row.item_id === item.item_id ? { ...row, status_id: nextStatus.status_id } : row))
      setHistory((current) => [
        ...current.filter((row) => row.item_id !== item.item_id),
        ...((savedHistory ?? []) as HistoryRow[]),
      ])
      setNotice('تم تحديث حالة البند وتسجيلها في السجل.')
    } catch (operationError) { setError(friendlyError(operationError)) }
    finally { setBusyItem(null) }
  }

  async function loadJournalIssues(journalId: number) {
    if (!supabase || issues.some((issue) => issue.journal_id === journalId)) return
    const { data, error: issueError } = await supabase.schema('crdc').from('journal_issues')
      .select('issue_id, journal_id, issue_year, issue_month').eq('journal_id', journalId).order('issue_year', { ascending: false })
    if (issueError) { setError(friendlyError(issueError)); return }
    setIssues((current) => [...current.filter((issue) => issue.journal_id !== journalId), ...((data ?? []) as JournalIssue[])])
  }

  async function updatePublication(itemId: number, form: HTMLFormElement) {
    if (!supabase) return
    setBusyItem(itemId); setError(''); setNotice('')
    const data = new FormData(form)
    try {
      const { error: rpcError } = await supabase.schema('crdc').rpc('update_publication_submission', {
        p_item_id: itemId, p_decision: String(data.get('decision')), p_journal_id: Number(data.get('journal_id')), p_issue_id: data.get('issue_id') ? Number(data.get('issue_id')) : null,
      })
      if (rpcError) throw rpcError
      const decision = String(data.get('decision')) as PublicationRow['decision']
      setPublications((current) => current.map((row) => row.item_id === itemId ? { ...row, decision, journal_id: Number(data.get('journal_id')), issue_id: data.get('issue_id') ? Number(data.get('issue_id')) : null, accepted_at: decision === 'accepted' ? (row.accepted_at ?? new Date().toISOString().slice(0, 10)) : null } : row))
      setNotice('تم حفظ قرار النشر.')
    } catch (operationError) { setError(friendlyError(operationError)) }
    finally { setBusyItem(null) }
  }

  return (
    <main className="page-shell researcher-shell staff-shell" dir="rtl">
      <header className="topbar">
        <a className="brand" href="#staff-home" aria-label="مركز الاستشارات والبحوث والتطوير">
          <span className="brand-mark">م</span>
          <span><strong>مركز الاستشارات</strong><small>والبحوث والتطوير · لوحة الموظفين</small></span>
        </a>
        <div className="staff-top-actions"><span className="staff-name">{staff.full_name}</span><span className="role-badge">{roleNames[staff.role]}</span><button className="quiet-button" onClick={onSignOut}>تسجيل الخروج</button></div>
      </header>

      <nav className="researcher-nav" aria-label="التنقل في لوحة الموظف">
        {canViewOverview && <button className={view === 'overview' ? 'active' : ''} aria-current={view === 'overview' ? 'page' : undefined} onClick={() => { setView('overview'); setError(''); setNotice('') }}>نظرة عامة وإحصائيات</button>}
        {(isAdmin || isCashier) && <button className={view === 'cashier' ? 'active' : ''} aria-current={view === 'cashier' ? 'page' : undefined} onClick={() => { setView('cashier'); setError(''); setNotice('') }}>مراجعة إيصالات السداد</button>}
        {isAdmin && <button className={view === 'requests' ? 'active' : ''} aria-current={view === 'requests' ? 'page' : undefined} onClick={() => { setView('requests'); setError(''); setNotice('') }}>إدارة الطلبات والتعيينات</button>}
        {canOperate && <button className={view === 'assigned' ? 'active' : ''} aria-current={view === 'assigned' ? 'page' : undefined} onClick={() => { setView('assigned'); setError(''); setNotice('') }}>{isAdmin ? 'كل الطلبات والبنود' : 'الطلبات المسندة إليّ'}</button>}
      </nav>

      <section className="portal-content" id="staff-home">
        {!canViewOverview && !isAdmin && !canOperate && !isCashier ? (
          <><div className="portal-heading"><span className="eyebrow">لوحة الموظفين</span><h1>أهلًا يا {staff.full_name}</h1></div><div className="portal-card staff-placeholder"><p>تم تسجيل دخولك بصلاحية {roleNames[staff.role]}. الشاشات الخاصة بالدور ده هتتضاف في خطوة لاحقة.</p></div></>
        ) : view === 'overview' ? (
          <>
            <div className="portal-heading"><span className="eyebrow">لوحة الموظفين</span><h1>نظرة عامة وإحصائيات</h1><p>أرقام مجمعة عن الطلبات، من غير عرض بيانات الباحثين أو تفاصيل طلباتهم.</p></div>
            {!canViewOverview ? <div className="portal-card staff-placeholder"><h2>أهلًا يا {staff.full_name}</h2><p>تابع إدارة الطلبات من التبويب المخصص.</p></div> : loadingOverview ? <div className="portal-card loading"><span className="spinner" /> بنحمّل الأرقام...</div> : error ? <p className="message error" role="alert">{error}</p> : (
              <>
                <div className="staff-stat-grid">
                  <article className="portal-card staff-stat-card"><span>إجمالي الطلبات</span><strong>{total.toLocaleString('ar-EG')}</strong><small>كل الطلبات المسجلة</small></article>
                  <article className="portal-card staff-stat-card"><span>طلبات المصريين</span><strong>{egyptian.toLocaleString('ar-EG')}</strong><small>حسب نوع الباحث</small></article>
                  <article className="portal-card staff-stat-card"><span>طلبات الوافدين</span><strong>{foreign.toLocaleString('ar-EG')}</strong><small>حسب نوع الباحث</small></article>
                </div>
                <section className="portal-card staff-status-card" aria-labelledby="status-heading">
                  <div className="staff-section-heading"><div><span className="eyebrow">توزيع الطلبات</span><h2 id="status-heading">حسب الحالة</h2></div><span className="role-badge">عرض مجمّع</span></div>
                  {summaryStatuses.length ? <ul className="staff-status-list">{summaryStatuses.map((row) => <li key={row.category}><span>{row.label}</span><strong>{Number(row.request_count).toLocaleString('ar-EG')}</strong></li>)}</ul> : <p className="empty-state">مفيش حالات طلبات للعرض حاليًا.</p>}
                </section>
              </>
            )}
          </>
        ) : view === 'cashier' ? (
          <>
            <div className="portal-heading"><span className="eyebrow">الخزينة</span><h1>مراجعة إيصالات السداد</h1><p>راجع المبلغ والإيصال والخدمات المشمولة قبل اعتماد السداد أو طلب إعادة الإرسال.</p></div>
            {notice && <p className="message success" role="status">{notice}</p>}
            {error && <p className="message error" role="alert">{error}</p>}
            {cashierLoading ? <div className="portal-card loading"><span className="spinner" /> بنحمّل الإيصالات...</div> : cashierRows.length ? <div className="request-list cashier-receipt-list">
              {cashierRows.map(({ payment, contact, items: coveredItems }) => <article className="portal-card cashier-receipt-card" data-testid="cashier-receipt" data-payment-id={payment.payment_id} key={payment.payment_id}>
                <div className="cashier-receipt-heading"><div><span className="eyebrow">إيصال بانتظار المراجعة</span><h2>{contact?.work_title ?? `طلب رقم ${payment.request_id}`}</h2></div><span className="status-pill">بانتظار مراجعة الخزينة</span></div>
                <dl className="cashier-receipt-facts">
                  <dt>رقم الطلب</dt><dd><span dir="ltr">#{payment.request_id}</span></dd>
                  <dt>الباحث</dt><dd>{contact?.full_name ?? 'بيانات الباحث غير متاحة'} <small dir="ltr">{contact?.email ?? ''}</small></dd>
                  <dt>نوع الباحث</dt><dd>{contact?.applicant_type === 'egyptian' ? 'مصري' : 'وافد'}</dd>
                  <dt>رقم الإيصال</dt><dd><span dir="ltr">{payment.receipt_no}</span></dd>
                  <dt>تاريخ السداد</dt><dd>{formatDate(payment.paid_at)}</dd>
                  <dt>قناة السداد</dt><dd>{payment.channel === 'treasury' ? 'الخزينة' : 'البنك'}</dd>
                  <dt>إجمالي المبلغ</dt><dd><strong><span dir="ltr">{Number(payment.amount).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} {payment.currency}</span></strong></dd>
                  <dt>وصل للمراجعة</dt><dd><time dateTime={payment.submitted_by_researcher_at}>{formatDate(payment.submitted_by_researcher_at)}</time></dd>
                </dl>
                <section className="cashier-covered-items"><h3>الخدمات المشمولة</h3>{coveredItems.length ? <ul>{coveredItems.map((item) => <li key={item.item_id}>
                  <span>{item.service_name}{item.option_code ? ` · ${item.option_code}` : ''}</span><span className="cashier-item-meta">{statusById.get(item.status_id)?.name_ar ?? 'غير محدد'} · <span dir="ltr">{Number(item.amount_due).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} {item.currency}</span></span>
                </li>)}</ul> : <p className="empty-state">مفيش بنود مرتبطة بإذن الدفع.</p>}</section>
                <div className="cashier-receipt-actions">
                  <button className="quiet-button" disabled={cashierBusyPayment !== null} onClick={() => void singleFlight(() => previewReceipt(payment))}>إنشاء رابط معاينة آمن</button>
                  {cashierSignedUrls[payment.payment_id] && <a className="quiet-button" href={cashierSignedUrls[payment.payment_id]} target="_blank" rel="noreferrer">معاينة الإيصال</a>}
                  <button className="primary-button" disabled={cashierBusyPayment !== null || !coveredItems.length} onClick={() => void singleFlight(() => approveReceipt(payment))}>{cashierBusyPayment === payment.payment_id ? 'بنحفظ...' : 'اعتماد السداد'}</button>
                </div>
                <form className="cashier-rejection-form" onSubmit={(event) => { event.preventDefault(); const reason = cashierReasons[payment.payment_id] ?? ''; void singleFlight(() => rejectReceipt(payment, reason)) }}>
                  <label>سبب الرفض<textarea required minLength={3} maxLength={500} value={cashierReasons[payment.payment_id] ?? ''} onChange={(event) => setCashierReasons((current) => ({ ...current, [payment.payment_id]: event.target.value }))} placeholder="اكتب سببًا واضحًا للباحث" /></label>
                  <button className="quiet-button" type="submit" disabled={cashierBusyPayment !== null}>رفض الإيصال وإبلاغ الباحث</button>
                </form>
              </article>)}
            </div> : <div className="portal-card empty-requests"><h2>مفيش إيصالات بانتظار المراجعة</h2><p>أي إيصال جديد هتلاقيه هنا مع تفاصيل المبلغ والخدمات.</p></div>}
            {!cashierLoading && cashierRows.length > 0 && <nav className="queue-pagination" aria-label="التنقل بين إيصالات السداد">
              <button className="quiet-button" disabled={cashierPageIndex === 0} onClick={previousCashierPage}>السابق</button>
              <span>صفحة {(cashierPageIndex + 1).toLocaleString('ar-EG')}</span>
              <button className="quiet-button" disabled={!cashierHasMore} onClick={nextCashierPage}>التالي</button>
            </nav>}
          </>
        ) : view === 'requests' ? (
          <>
            <div className="portal-heading"><span className="eyebrow">إدارة المركز</span><h1>إدارة الطلبات والتعيينات</h1><p>راجع الطلبات وبنودها وعيّن مراجع أو إحصائي نشط لكل طلب.</p></div>
            {notice && <p className="message success" role="status">{notice}</p>}
            {error && <p className="message error" role="alert">{error}</p>}
            <div className="queue-filters portal-card">
              <label>الحالة<select aria-label="فلترة بالحالة" value={filterStatus} onChange={(event) => { setFilterStatus(event.target.value); resetPagination() }}><option value="all">كل الحالات</option>{statuses.map((status) => <option key={status.code} value={status.code}>{status.name_ar}</option>)}<option value="MIXED">مراحل مختلفة</option><option value="NO_ITEMS">بدون بنود</option></select></label>
              <label>نوع العمل<select aria-label="فلترة بنوع العمل" value={filterWorkType} onChange={(event) => { setFilterWorkType(event.target.value); resetPagination() }}><option value="all">كل أنواع العمل</option><option value="thesis">رسالة علمية</option><option value="paper">بحث للنشر</option></select></label>
              <span className="queue-result-count">طلبات الصفحة: {requests.length.toLocaleString('ar-EG')}</span>
            </div>
            {queueLoading ? <div className="portal-card loading"><span className="spinner" /> بنحمّل الطلبات...</div> : error && !requests.length ? null : requests.length ? (
              <div className="request-list admin-request-list">
                {requests.map((request) => {
                  const requestItems = items.filter((item) => item.request_id === request.request_id)
                  const assignedIds = [...new Set(requestItems.map((item) => item.assigned_staff_id).filter(Boolean))] as string[]
                  const selectedStaffId = assignedIds.length === 1 && requestItems.every((item) => item.assigned_staff_id === assignedIds[0]) ? assignedIds[0] : ''
                  const assignedNames = assignedIds.map((id) => staffMembers.find((member) => member.staff_id === id)?.full_name ?? 'موظف غير متاح')
                  const requester = requesters.get(request.researcher_id)
                  const overall = getRequestStatus(request)
                  return (
                    <article className="portal-card admin-request-card" data-testid="admin-request-row" data-request-id={request.request_id} key={request.request_id}>
                      <div className="admin-request-heading"><div><span className="request-type">{request.work_type === 'thesis' ? 'رسالة علمية' : 'بحث للنشر'}</span><h2>{request.work_title}</h2></div><span className="request-card-status">{overall.label}</span></div>
                      <dl className="admin-request-facts">
                        <dt>رقم الطلب</dt><dd><span dir="ltr">#{request.request_id}</span></dd>
                        <dt>الباحث</dt><dd>{requester?.full_name ?? 'بيانات الباحث غير متاحة'} <small dir="ltr">{requester?.email ?? ''}</small></dd>
                        <dt>نوع الباحث</dt><dd>{request.applicant_type === 'egyptian' ? 'مصري' : 'وافد'}</dd>
                        <dt>تاريخ التقديم</dt><dd>{formatDate(request.created_at)}</dd>
                        <dt>عدد البنود</dt><dd>{request.item_count.toLocaleString('ar-EG')}</dd>
                        <dt>المعيّنون حاليًا</dt><dd className="assigned-staff-names">{assignedNames.length ? assignedNames.join('، ') : 'لسه مفيش تعيين'}</dd>
                      </dl>
                      <div className="admin-request-assignment">
                        <label>تعيين المراجع أو الإحصائي<select aria-label="تعيين المراجع أو الإحصائي" value={selectedStaffId} disabled={busyRequest !== null || !requestItems.length} onChange={(event) => { const staffId = event.target.value; void singleFlight(() => assignRequest(request, staffId)) }}>
                          <option value="">اختار موظف نشط</option>{assignableStaff.map((member) => <option value={member.staff_id} key={member.staff_id}>{member.full_name} · {roleNames[member.role]}</option>)}
                        </select></label>
                        {busyRequest === request.request_id && <span className="assignment-saving">بنحفظ التعيين...</span>}
                      </div>
                    </article>
                  )
                })}
              </div>
            ) : <div className="portal-card empty-requests"><h2>مفيش طلبات مطابقة</h2><p>غيّر الفلاتر علشان تعرض طلبات تانية.</p></div>}
            {!queueLoading && !error && requests.length > 0 && <nav className="queue-pagination" aria-label="التنقل بين صفحات الطلبات">
              <button className="quiet-button" disabled={pageIndex === 0} onClick={previousPage}>السابق</button>
              <span>صفحة {(pageIndex + 1).toLocaleString('ar-EG')}</span>
              <button className="quiet-button" disabled={!pageHasMore} onClick={nextPage}>التالي</button>
            </nav>}
          </>
        ) : (
          <>
            <div className="portal-heading"><span className="eyebrow">مساحة العمل</span><h1>{isAdmin ? 'كل الطلبات والبنود' : 'الطلبات المسندة إليّ'}</h1><p>{isAdmin ? 'بصفتك مدير النظام، تظهر هنا بنود جميع الطلبات ويمكنك متابعة حالاتها وقرارات النشر.' : 'حدّث البنود المسندة لك وسجّل ملاحظتك في مسار الطلب.'}</p></div>
            {notice && <p className="message success" role="status">{notice}</p>}
            {error && <p className="message error" role="alert">{error}</p>}
            {operationLoading ? <div className="portal-card loading"><span className="spinner" /> بنحمّل الطلبات...</div> : items.length ? <div className="request-list operational-list">
              {items.map((item) => {
                const request = requests.find((row) => row.request_id === item.request_id)
                const current = statusById.get(item.status_id)
                const publication = publications.find((row) => row.item_id === item.item_id)
                const itemHistory = history.filter((row) => row.item_id === item.item_id)
                if (!request) return null
                return <article className="portal-card operational-item" data-testid="assigned-case" data-item-id={item.item_id} key={item.item_id}>
                  <div className="admin-request-heading"><div><span className="request-type">{request.work_type === 'thesis' ? 'رسالة علمية' : 'بحث للنشر'}</span><h2>{request.work_title}</h2></div><span className="request-card-status">{current?.name_ar ?? 'غير محدد'}</span></div>
                  <p className="operational-meta">رقم الطلب <span dir="ltr">#{request.request_id}</span> · البند <span dir="ltr">#{item.item_id}</span></p>
                  <form className="operation-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void singleFlight(() => updateStatus(item, String(form.get('status')), String(form.get('note') ?? ''))) }}>
                    <label>الحالة التشغيلية<select name="status" aria-label="الحالة التشغيلية" defaultValue=""><option value="" disabled>اختار الحالة</option>{statuses.filter((status) => ['IN_PROGRESS', 'REVISIONS', 'COMPLETED', 'DELIVERED'].includes(status.code)).map((status) => <option value={status.code} key={status.code}>{status.name_ar}</option>)}</select></label>
                    <label>ملاحظة للسجل<input name="note" placeholder="اكتب ملاحظة مختصرة (اختياري)" /><small>الملاحظة هتظهر للباحث</small></label>
                    <button className="primary-button" disabled={busyItem !== null}>{busyItem === item.item_id ? 'بنحفظ...' : 'حفظ الحالة'}</button>
                  </form>
                  <section className="timeline"><h4>سجل الحالة</h4>{itemHistory.length ? itemHistory.map((entry) => <div className="timeline-row" key={entry.history_id}><span className="timeline-dot" /><div><strong>{statusById.get(entry.status_id)?.name_ar ?? 'تحديث'}</strong>{entry.note && <p>{entry.note}</p>}<time dateTime={entry.changed_at}>{formatDate(entry.changed_at)}</time></div></div>) : <p className="empty-state">لسه مفيش تحديثات ظاهرة.</p>}</section>
                  {publication && <form className="publication-editor" onSubmit={(event) => { event.preventDefault(); const formElement = event.currentTarget; void singleFlight(() => updatePublication(item.item_id, formElement)) }}>
                    <h4>قرار النشر</h4><label>القرار<select name="decision" defaultValue={publication.decision}><option value="pending">قيد المراجعة</option><option value="revisions">تعديلات</option><option value="accepted">مقبول</option><option value="rejected">مرفوض</option></select></label>
                    <label>المجلة<select name="journal_id" value={selectedJournalByItem[item.item_id] ?? publication.journal_id} onChange={(event) => {
                      const journalId = Number(event.target.value)
                      setSelectedJournalByItem((current) => ({ ...current, [item.item_id]: journalId }))
                      setSelectedIssueByItem((current) => ({ ...current, [item.item_id]: '' }))
                      void loadJournalIssues(journalId)
                    }}>{journals.map((journal) => <option value={journal.journal_id} key={journal.journal_id}>{journal.name_ar}</option>)}</select></label>
                    <label>العدد<select name="issue_id" value={selectedIssueByItem[item.item_id] ?? publication.issue_id ?? ''} onChange={(event) => setSelectedIssueByItem((current) => ({ ...current, [item.item_id]: event.target.value ? Number(event.target.value) : '' }))}><option value="">من غير عدد</option>{issues.filter((issue) => issue.journal_id === (selectedJournalByItem[item.item_id] ?? publication.journal_id)).map((issue) => <option value={issue.issue_id} key={issue.issue_id}>{issue.issue_month}/{issue.issue_year}</option>)}</select></label>
                    <button className="primary-button" disabled={busyItem !== null}>{busyItem === item.item_id ? 'بنحفظ...' : 'حفظ قرار النشر'}</button>
                  </form>}
                </article>
              })}
            </div> : <div className="portal-card empty-requests"><h2>{isAdmin ? 'مفيش بنود للعرض' : 'مفيش طلبات مسندة ليك'}</h2><p>{isAdmin ? 'لا توجد بنود ضمن الصفحة الحالية.' : 'هنا هتظهر البنود اللي الأدمن عيّنها لحسابك.'}</p></div>}
            {!operationLoading && !error && requests.length > 0 && <nav className="queue-pagination" aria-label="التنقل بين صفحات الطلبات المسندة">
              <button className="quiet-button" disabled={pageIndex === 0} onClick={previousPage}>السابق</button>
              <span>صفحة {(pageIndex + 1).toLocaleString('ar-EG')}</span>
              <button className="quiet-button" disabled={!pageHasMore} onClick={nextPage}>التالي</button>
            </nav>}
          </>
        )}
      </section>
      <footer className="page-footer"><span>CRDC</span><span>مركز الاستشارات والبحوث والتطوير</span><span>لوحة الموظفين</span></footer>
    </main>
  )
}

