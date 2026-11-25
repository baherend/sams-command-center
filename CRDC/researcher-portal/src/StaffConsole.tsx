import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { UiError, friendlyErrorText, useSingleFlight, type LocalizedText } from './errors'
const AnalyticsDashboard = lazy(() => import('./AnalyticsDashboard'))
import { useI18n, pickName } from './i18n'

type StaffRole = 'admin' | 'reviewer' | 'statistician' | 'cashier' | 'viewer'
type StaffProfile = { staff_id: string; full_name: string; role: StaffRole; is_active: boolean }
type SummaryRow = { metric: string; category: string; label: string; label_en?: string | null; request_count: number | string }
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
type RequestStatus = { status_id: number; code: string; name_ar: string; name_en?: string | null; sort_order: number }
type HistoryRow = { history_id: number; item_id: number; status_id: number; changed_at: string; note: string | null }
type PublicationRow = { submission_id: number; item_id: number; journal_id: number; issue_id: number | null; decision: 'pending' | 'revisions' | 'accepted' | 'rejected'; accepted_at: string | null }
type Journal = { journal_id: number; name_ar: string; name_en?: string | null }
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
type CashierItemDisplay = CashierItem & { service_name: string; service_name_en?: string | null; option_code: string }
type CashierCursor = { submitted_by_researcher_at: string; payment_id: number }
type CashierQueueRow = { payment: CashierPayment; contact: CashierContact | undefined; items: CashierItemDisplay[] }

const ROLE_NAMES: Record<StaffRole, LocalizedText> = {
  admin: { ar: 'مدير النظام', en: 'System Admin' },
  reviewer: { ar: 'مراجع', en: 'Reviewer' },
  statistician: { ar: 'إحصائي', en: 'Statistician' },
  cashier: { ar: 'أمين خزينة', en: 'Cashier' },
  viewer: { ar: 'مشاهد', en: 'Viewer' },
}
type PageCursor = { created_at: string; request_id: number }
const receiptPageSize = 20
const pageSize = 20

const formatDate = (value: string) => new Intl.DateTimeFormat(document.documentElement.lang === 'en' ? 'en-US' : 'ar-EG', { dateStyle: 'medium' }).format(new Date(value))

export default function StaffConsole({ staff, onSignOut }: { staff: StaffProfile; onSignOut: () => void }) {
  const { t, lang, dir, isEn } = useI18n()
  const [rows, setRows] = useState<SummaryRow[]>([])
  const [loadingOverview, setLoadingOverview] = useState(staff.role === 'admin' || staff.role === 'viewer')
  const [view, setView] = useState<'overview' | 'analytics' | 'requests' | 'assigned' | 'cashier'>(staff.role === 'cashier' ? 'cashier' : staff.role === 'viewer' ? 'analytics' : 'overview')
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
  const [error, setError] = useState<LocalizedText | null>(null)
  const [notice, setNotice] = useState<LocalizedText | null>(null)
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
    setError(null)
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
          supabase.schema('crdc').from('request_statuses').select('status_id,code,name_ar,name_en,sort_order').order('sort_order'),
        ])
        if (itemResult.error || contactResult.error || statusResult.error) throw itemResult.error ?? contactResult.error ?? statusResult.error
        const itemRows = (itemResult.data ?? []) as CashierItem[]
        const serviceIds = [...new Set(itemRows.map((item) => item.service_id))]
        const feeIds = [...new Set(itemRows.map((item) => item.fee_id))]
        const [serviceResult, feeResult] = await Promise.all([
          serviceIds.length ? supabase.schema('crdc').from('services').select('service_id,name_ar,name_en').in('service_id', serviceIds) : Promise.resolve({ data: [], error: null }),
          feeIds.length ? supabase.schema('crdc').from('fee_schedule').select('fee_id,option_code').in('fee_id', feeIds) : Promise.resolve({ data: [], error: null }),
        ])
        if (serviceResult.error || feeResult.error) throw serviceResult.error ?? feeResult.error
        if (!alive) return
        const serviceRows = new Map((serviceResult.data ?? []).map((row) => [row.service_id, row]))
        const feeCodes = new Map((feeResult.data ?? []).map((row) => [row.fee_id, row.option_code]))
        const contacts = new Map(((contactResult.data ?? []) as CashierContact[]).map((row) => [row.request_id, row]))
        const itemsByPayment = new Map<number, CashierItemDisplay[]>()
        for (const item of itemRows) {
          const display = { ...item, service_name: serviceRows.get(item.service_id)?.name_ar ?? 'SERVICE_FALLBACK', service_name_en: serviceRows.get(item.service_id)?.name_en ?? null, option_code: feeCodes.get(item.fee_id) ?? '' }
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
        if (alive) setError(friendlyErrorText(queueError))
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
          .select('metric, category, label, label_en, request_count')
        if (!alive) return
        if (queryError) setError({ ar: 'مش قادرين نحمّل الإحصائيات دلوقتي. جرّب تاني بعد شوية.', en: 'Unable to load statistics right now. Please try again shortly.' })
        else setRows((data ?? []) as SummaryRow[])
      } catch {
        if (alive) setError({ ar: 'مش قادرين نحمّل الإحصائيات دلوقتي. جرّب تاني بعد شوية.', en: 'Unable to load statistics right now. Please try again shortly.' })
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
    setError(null)

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
          supabase.schema('crdc').from('request_statuses').select('status_id, code, name_ar, name_en, sort_order').order('sort_order'),
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
              supabase.schema('crdc').from('journals').select('journal_id, name_ar, name_en').in('journal_id', journalIds),
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
          ? { ar: 'حصلت مشكلة وإحنا بنحمّل الطلبات. راجع الاتصال أو صلاحيات الحساب وحاول تاني.', en: 'Failed to load requests. Check your connection or permissions and try again.' }
          : { ar: 'مش قادرين نحمّل الطلبات المسندة. جرّب تاني بعد شوية.', en: 'Unable to load assigned requests right now. Please try again shortly.' })
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
    label: request.queue_status_code === 'MIXED' ? t('مراحل مختلفة', 'Mixed Stages')
      : request.queue_status_code === 'NO_ITEMS' ? t('بدون بنود', 'No Items')
        : (() => { const s = statusByCode.get(request.queue_status_code); return s ? pickName(s, lang) : t('غير محدد', 'Unspecified') })(),
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
    setError(null)
    const { data, error: signedError } = await supabase.storage.from('payment-receipts')
      .createSignedUrl(payment.receipt_storage_path, 300, { download: true })
    if (signedError) { setError(friendlyErrorText(signedError)); return }
    setCashierSignedUrls((current) => ({ ...current, [payment.payment_id]: data.signedUrl }))
  }

  async function approveReceipt(payment: CashierPayment) {
    if (!supabase) return
    setCashierBusyPayment(payment.payment_id); setError(null); setNotice(null)
    try {
      const { error: approveError } = await supabase.schema('crdc').rpc('approve_payment_receipt', { p_payment_id: payment.payment_id })
      if (approveError) throw approveError
      setNotice({ ar: 'تم اعتماد السداد وتحديث حالات الخدمات.', en: 'Payment approved and service item statuses updated.' })
      setCashierSignedUrls((current) => { const next = { ...current }; delete next[payment.payment_id]; return next })
      setCashierRefreshToken((value) => value + 1)
    } catch (approveError) {
      setError(friendlyErrorText(approveError))
    } finally {
      setCashierBusyPayment(null)
    }
  }

  async function rejectReceipt(payment: CashierPayment, reason: string) {
    if (!supabase) return
    setCashierBusyPayment(payment.payment_id); setError(null); setNotice(null)
    try {
      const { error: rejectError } = await supabase.schema('crdc').rpc('reject_payment_receipt', {
        p_payment_id: payment.payment_id,
        p_reason: reason.trim(),
      })
      if (rejectError) throw rejectError
      setNotice({ ar: 'تم رفض الإيصال وإرسال السبب للباحث.', en: 'Receipt rejected and reason sent to the researcher.' })
      setCashierSignedUrls((current) => { const next = { ...current }; delete next[payment.payment_id]; return next })
      setCashierReasons((current) => ({ ...current, [payment.payment_id]: '' }))
      setCashierRefreshToken((value) => value + 1)
    } catch (rejectError) {
      setError(friendlyErrorText(rejectError))
    } finally {
      setCashierBusyPayment(null)
    }
  }

  async function assignRequest(request: QueueRequest, staffId: string) {
    if (!supabase || !staffId) return
    setBusyRequest(request.request_id)
    setError(null)
    setNotice(null)
    try {
      const requestItems = items.filter((item) => item.request_id === request.request_id)
      if (!requestItems.length) throw new UiError('الطلب ده مفيهوش بنود ينفع تتعيّن.', 'This request has no assignable service items.')
      const selectedStaff = assignableStaff.find((member) => member.staff_id === staffId)
      if (!selectedStaff) throw new UiError('اختار مراجع أو إحصائي نشط من القائمة.', 'Please select an active reviewer or statistician from the list.')
      const { data, error: updateError } = await supabase.schema('crdc').from('request_items')
        .update({ assigned_staff_id: staffId })
        .eq('request_id', request.request_id)
        .select('item_id')
      if (updateError) throw updateError
      if ((data ?? []).length !== requestItems.length) throw new UiError('ماقدرناش نأكد تعيين كل بنود الطلب. حدّث القائمة وراجع الطلب.', 'Could not confirm assignment for all request items. Refresh and review.')
      setItems((current) => current.map((item) => item.request_id === request.request_id ? { ...item, assigned_staff_id: staffId } : item))
      setNotice({ ar: `اتعيّن ${ROLE_NAMES[selectedStaff.role].ar} ${selectedStaff.full_name} على كل بنود الطلب رقم ${request.request_id}.`, en: `Assigned ${ROLE_NAMES[selectedStaff.role].en} ${selectedStaff.full_name} to all items of request #${request.request_id}.` })
    } catch (assignmentError) {
      setError(friendlyErrorText(assignmentError, { '42501': { ar: 'التعيين مرفوض. اتأكد إن الحساب أدمن والموظف مراجع أو إحصائي نشط.', en: 'Assignment denied. Ensure you are an admin and the staff member is an active reviewer or statistician.' } }))
    } finally {
      setBusyRequest(null)
    }
  }

  async function updateStatus(item: RequestItem, statusCode: string, note: string) {
    if (!supabase || !statusCode) return
    setBusyItem(item.item_id); setError(null); setNotice(null)
    try {
      const { error: rpcError } = await supabase.schema('crdc').rpc('set_request_item_status', { p_item_id: item.item_id, p_status_code: statusCode, p_note: note.trim() || null })
      if (rpcError) throw rpcError
      const nextStatus = statuses.find((status) => status.code === statusCode)
      if (!nextStatus) throw new UiError('الحالة غير متاحة.', 'Selected status is unavailable.')
      const { data: savedHistory, error: historyError } = await supabase.schema('crdc').from('request_status_history')
        .select('history_id, item_id, status_id, changed_at, note').eq('item_id', item.item_id).order('changed_at', { ascending: false })
      if (historyError) throw historyError
      setItems((current) => current.map((row) => row.item_id === item.item_id ? { ...row, status_id: nextStatus.status_id } : row))
      setHistory((current) => [
        ...current.filter((row) => row.item_id !== item.item_id),
        ...((savedHistory ?? []) as HistoryRow[]),
      ])
      setNotice({ ar: 'تم تحديث حالة البند وتسجيلها في السجل.', en: 'Item status updated and logged in history.' })
    } catch (operationError) { setError(friendlyErrorText(operationError)) }
    finally { setBusyItem(null) }
  }

  async function loadJournalIssues(journalId: number) {
    if (!supabase || issues.some((issue) => issue.journal_id === journalId)) return
    const { data, error: issueError } = await supabase.schema('crdc').from('journal_issues')
      .select('issue_id, journal_id, issue_year, issue_month').eq('journal_id', journalId).order('issue_year', { ascending: false })
    if (issueError) { setError(friendlyErrorText(issueError)); return }
    setIssues((current) => [...current.filter((issue) => issue.journal_id !== journalId), ...((data ?? []) as JournalIssue[])])
  }

  async function updatePublication(itemId: number, form: HTMLFormElement) {
    if (!supabase) return
    setBusyItem(itemId); setError(null); setNotice(null)
    const data = new FormData(form)
    try {
      const { error: rpcError } = await supabase.schema('crdc').rpc('update_publication_submission', {
        p_item_id: itemId, p_decision: String(data.get('decision')), p_journal_id: Number(data.get('journal_id')), p_issue_id: data.get('issue_id') ? Number(data.get('issue_id')) : null,
      })
      if (rpcError) throw rpcError
      const decision = String(data.get('decision')) as PublicationRow['decision']
      setPublications((current) => current.map((row) => row.item_id === itemId ? { ...row, decision, journal_id: Number(data.get('journal_id')), issue_id: data.get('issue_id') ? Number(data.get('issue_id')) : null, accepted_at: decision === 'accepted' ? (row.accepted_at ?? new Date().toISOString().slice(0, 10)) : null } : row))
      setNotice({ ar: 'تم حفظ قرار النشر.', en: 'Publication decision saved.' })
    } catch (operationError) { setError(friendlyErrorText(operationError)) }
    finally { setBusyItem(null) }
  }

  const analyticsButton = canViewOverview ? <button className={view === 'analytics' ? 'active' : ''} aria-current={view === 'analytics' ? 'page' : undefined} onClick={() => { setView('analytics'); setError(null); setNotice(null) }}>{isEn ? 'Analytics & KPIs' : 'الإحصائيات والمؤشرات'}</button> : null

  return (
    <main className="page-shell researcher-shell staff-shell" dir={dir}>
      <header className="topbar">
        <a className="brand" href="#staff-home" aria-label={t('مركز الاستشارات والبحوث والتطوير', 'Consultation, Research & Development Center')}>
          <span className="brand-mark">{isEn ? 'C' : 'م'}</span>
          <span><strong>{isEn ? 'Consultation, Research' : 'مركز الاستشارات'}</strong><small>{isEn ? '& Development Center · Staff Console' : 'والبحوث والتطوير · لوحة الموظفين'}</small></span>
        </a>
        <div className="staff-top-actions"><span className="staff-name">{staff.full_name}</span><span className="role-badge">{ROLE_NAMES[staff.role][lang]}</span><button className="quiet-button" onClick={onSignOut}>{isEn ? 'Sign Out' : 'تسجيل الخروج'}</button></div>
      </header>

      <nav className="researcher-nav" aria-label={t('التنقل في لوحة الموظف', 'Staff console navigation')}>
        {staff.role === 'viewer' && analyticsButton}
        {canViewOverview && <button className={view === 'overview' ? 'active' : ''} aria-current={view === 'overview' ? 'page' : undefined} onClick={() => { setView('overview'); setError(null); setNotice(null) }}>{isEn ? 'Overview & Statistics' : 'نظرة عامة وإحصائيات'}</button>}
        {isAdmin && analyticsButton}
        {(isAdmin || isCashier) && <button className={view === 'cashier' ? 'active' : ''} aria-current={view === 'cashier' ? 'page' : undefined} onClick={() => { setView('cashier'); setError(null); setNotice(null) }}>{isEn ? 'Review Payment Receipts' : 'مراجعة إيصالات السداد'}</button>}
        {isAdmin && <button className={view === 'requests' ? 'active' : ''} aria-current={view === 'requests' ? 'page' : undefined} onClick={() => { setView('requests'); setError(null); setNotice(null) }}>{isEn ? 'Requests & Assignments' : 'إدارة الطلبات والتعيينات'}</button>}
        {canOperate && <button className={view === 'assigned' ? 'active' : ''} aria-current={view === 'assigned' ? 'page' : undefined} onClick={() => { setView('assigned'); setError(null); setNotice(null) }}>{isAdmin ? (isEn ? 'All Requests & Items' : 'كل الطلبات والبنود') : (isEn ? 'My Assigned Requests' : 'الطلبات المسندة إليّ')}</button>}
      </nav>

      <section className="portal-content" id="staff-home">
        {!canViewOverview && !isAdmin && !canOperate && !isCashier ? (
          <><div className="portal-heading"><span className="eyebrow">{t('لوحة الموظفين', 'Staff Dashboard')}</span><h1>{t('أهلًا يا', 'Welcome,')} {staff.full_name}</h1></div><div className="portal-card staff-placeholder"><p>{t(`تم تسجيل دخولك بصلاحية ${ROLE_NAMES[staff.role].ar}. الشاشات الخاصة بالدور ده هتتضاف في خطوة لاحقة.`, `Signed in as ${ROLE_NAMES[staff.role].en}. Role-specific screens will be added in a future update.`)}</p></div></>
        ) : view === 'analytics' && canViewOverview ? (
          <Suspense fallback={<div className="portal-card loading" aria-busy="true"><span className="spinner" /> {t('بنحمّل لوحة التحليلات...', 'Loading analytics...')}</div>}><AnalyticsDashboard /></Suspense>
        ) : view === 'overview' ? (
          <>
            <div className="portal-heading"><span className="eyebrow">لوحة الموظفين</span><h1>{isEn ? 'Overview & Statistics' : 'نظرة عامة وإحصائيات'}</h1><p>أرقام مجمعة عن الطلبات، من غير عرض بيانات الباحثين أو تفاصيل طلباتهم.</p></div>
            {!canViewOverview ? <div className="portal-card staff-placeholder"><h2>{t('أهلًا يا', 'Welcome,')} {staff.full_name}</h2><p>{t('تابع إدارة الطلبات من التبويب المخصص.', 'Manage requests from the dedicated tab.')}</p></div> : loadingOverview ? <div className="portal-card loading"><span className="spinner" /> {isEn ? 'Loading figures...' : 'بنحمّل الأرقام...'}</div> : error ? <p className="message error" role="alert">{error[lang]}</p> : (
              <>
                <div className="staff-stat-grid">
                  <article className="portal-card staff-stat-card"><span>{isEn ? 'Total Requests' : 'إجمالي الطلبات'}</span><strong>{total.toLocaleString(isEn ? 'en-US' : 'ar-EG')}</strong><small>{isEn ? 'All registered requests' : 'كل الطلبات المسجلة'}</small></article>
                  <article className="portal-card staff-stat-card"><span>{isEn ? 'Egyptian Requests' : 'طلبات المصريين'}</span><strong>{egyptian.toLocaleString(isEn ? 'en-US' : 'ar-EG')}</strong><small>{isEn ? 'By applicant type' : 'حسب نوع الباحث'}</small></article>
                  <article className="portal-card staff-stat-card"><span>{isEn ? 'International Requests' : 'طلبات الوافدين'}</span><strong>{foreign.toLocaleString(isEn ? 'en-US' : 'ar-EG')}</strong><small>{isEn ? 'By applicant type' : 'حسب نوع الباحث'}</small></article>
                </div>
                <section className="portal-card staff-status-card" aria-labelledby="status-heading">
                  <div className="staff-section-heading"><div><span className="eyebrow">{isEn ? 'Request Distribution' : 'توزيع الطلبات'}</span><h2 id="status-heading">{isEn ? 'By Status' : 'حسب الحالة'}</h2></div><span className="role-badge">{isEn ? 'Aggregated View' : 'عرض مجمّع'}</span></div>
                  {summaryStatuses.length ? <ul className="staff-status-list">{summaryStatuses.map((row) => <li key={row.category}><span>{pickName({ name_ar: row.label, name_en: row.label_en }, lang)}</span><strong>{Number(row.request_count).toLocaleString(isEn ? 'en-US' : 'ar-EG')}</strong></li>)}</ul> : <p className="empty-state">{t('مفيش حالات طلبات للعرض حاليًا.', 'No request statuses to display right now.')}</p>}
                </section>
              </>
            )}
          </>
        ) : view === 'cashier' ? (
          <>
            <div className="portal-heading"><span className="eyebrow">الخزينة</span><h1>{isEn ? 'Review Payment Receipts' : 'مراجعة إيصالات السداد'}</h1><p>راجع المبلغ والإيصال والخدمات المشمولة قبل اعتماد السداد أو طلب إعادة الإرسال.</p></div>
            {notice && <p className="message success" role="status">{notice[lang]}</p>}
            {error && <p className="message error" role="alert">{error[lang]}</p>}
            {cashierLoading ? <div className="portal-card loading"><span className="spinner" /> {t('بنحمّل الإيصالات...', 'Loading receipts...')}</div> : cashierRows.length ? <div className="request-list cashier-receipt-list">
              {cashierRows.map(({ payment, contact, items: coveredItems }) => <article className="portal-card cashier-receipt-card" data-testid="cashier-receipt" data-payment-id={payment.payment_id} key={payment.payment_id}>
                <div className="cashier-receipt-heading"><div><span className="eyebrow">{t('إيصال بانتظار المراجعة', 'Receipt Pending Review')}</span><h2>{contact?.work_title ?? t(`طلب رقم ${payment.request_id}`, `Request #${payment.request_id}`)}</h2></div><span className="status-pill">{t('بانتظار مراجعة الخزينة', 'Pending Treasury Review')}</span></div>
                <dl className="cashier-receipt-facts">
                  <dt>{t('رقم الطلب', 'Request ID')}</dt><dd><span dir="ltr">#{payment.request_id}</span></dd>
                  <dt>{t('الباحث', 'Researcher')}</dt><dd>{contact?.full_name ?? t('بيانات الباحث غير متاحة', 'Researcher details unavailable')} <small dir="ltr">{contact?.email ?? ''}</small></dd>
                  <dt>{t('نوع الباحث', 'Applicant Type')}</dt><dd>{contact?.applicant_type === 'egyptian' ? t('مصري', 'Egyptian') : t('وافد', 'International')}</dd>
                  <dt>{t('رقم الإيصال', 'Receipt No.')}</dt><dd><span dir="ltr">{payment.receipt_no}</span></dd>
                  <dt>{t('تاريخ السداد', 'Payment Date')}</dt><dd>{formatDate(payment.paid_at)}</dd>
                  <dt>{t('قناة السداد', 'Payment Channel')}</dt><dd>{payment.channel === 'treasury' ? t('الخزينة', 'Treasury') : t('البنك', 'Bank')}</dd>
                  <dt>{t('إجمالي المبلغ', 'Total Amount')}</dt><dd><strong><span dir="ltr">{Number(payment.amount).toLocaleString(isEn ? 'en-US' : 'ar-EG', { maximumFractionDigits: 2 })} {payment.currency}</span></strong></dd>
                  <dt>{t('وصل للمراجعة', 'Submitted At')}</dt><dd><time dateTime={payment.submitted_by_researcher_at}>{formatDate(payment.submitted_by_researcher_at)}</time></dd>
                </dl>
                <section className="cashier-covered-items"><h3>{t('الخدمات المشمولة', 'Covered Services')}</h3>{coveredItems.length ? <ul>{coveredItems.map((item) => <li key={item.item_id}>
                  <span>{item.service_name === 'SERVICE_FALLBACK' ? t('خدمة', 'Service') : pickName({ name_ar: item.service_name, name_en: item.service_name_en }, lang)}{item.option_code ? ` · ${item.option_code}` : ''}</span><span className="cashier-item-meta">{(() => { const s = statusById.get(item.status_id); return s ? pickName(s, lang) : t('غير محدد', 'Unspecified') })()} · <span dir="ltr">{Number(item.amount_due).toLocaleString(isEn ? 'en-US' : 'ar-EG', { maximumFractionDigits: 2 })} {item.currency}</span></span>
                </li>)}</ul> : <p className="empty-state">{t('مفيش بنود مرتبطة بإذن الدفع.', 'No items linked to this payment order.')}</p>}</section>
                <div className="cashier-receipt-actions">
                  <button className="quiet-button" disabled={cashierBusyPayment !== null} onClick={() => void singleFlight(() => previewReceipt(payment))}>{t('إنشاء رابط معاينة آمن', 'Generate Secure Preview Link')}</button>
                  {cashierSignedUrls[payment.payment_id] && <a className="quiet-button" href={cashierSignedUrls[payment.payment_id]} target="_blank" rel="noreferrer">{t('معاينة الإيصال', 'Preview Receipt')}</a>}
                  <button className="primary-button" disabled={cashierBusyPayment !== null || !coveredItems.length} onClick={() => void singleFlight(() => approveReceipt(payment))}>{cashierBusyPayment === payment.payment_id ? t('بنحفظ...', 'Saving...') : t('اعتماد السداد', 'Approve Payment')}</button>
                </div>
                <form className="cashier-rejection-form" onSubmit={(event) => { event.preventDefault(); const reason = cashierReasons[payment.payment_id] ?? ''; void singleFlight(() => rejectReceipt(payment, reason)) }}>
                  <label>{t('سبب الرفض', 'Rejection Reason')}<textarea required minLength={3} maxLength={500} value={cashierReasons[payment.payment_id] ?? ''} onChange={(event) => setCashierReasons((current) => ({ ...current, [payment.payment_id]: event.target.value }))} placeholder={t('اكتب سببًا واضحًا للباحث', 'Write a clear reason for the researcher')} /></label>
                  <button className="quiet-button" type="submit" disabled={cashierBusyPayment !== null}>{isEn ? 'Reject Receipt & Notify Researcher' : 'رفض الإيصال وإبلاغ الباحث'}</button>
                </form>
              </article>)}
            </div> : <div className="portal-card empty-requests"><h2>{t('مفيش إيصالات بانتظار المراجعة', 'No Receipts Pending Review')}</h2><p>{t('أي إيصال جديد هتلاقيه هنا مع تفاصيل المبلغ والخدمات.', 'Any newly uploaded receipts will appear here with amount and service details.')}</p></div>}
            {!cashierLoading && cashierRows.length > 0 && <nav className="queue-pagination" aria-label={t('التنقل بين إيصالات السداد', 'Payment receipts pagination')}>
              <button className="quiet-button" disabled={cashierPageIndex === 0} onClick={previousCashierPage}>{t('السابق', 'Previous')}</button>
              <span>{t('صفحة ', 'Page ')}{(cashierPageIndex + 1).toLocaleString(isEn ? 'en-US' : 'ar-EG')}</span>
              <button className="quiet-button" disabled={!cashierHasMore} onClick={nextCashierPage}>{t('التالي', 'Next')}</button>
            </nav>}
          </>
        ) : view === 'requests' ? (
          <>
            <div className="portal-heading"><span className="eyebrow">{isEn ? 'Center Administration' : 'إدارة المركز'}</span><h1>{isEn ? 'Requests & Assignments' : 'إدارة الطلبات والتعيينات'}</h1><p>{isEn ? 'Review requests and items, and assign an active reviewer or statistician to each request.' : 'راجع الطلبات وبنودها وعيّن مراجع أو إحصائي نشط لكل طلب.'}</p></div>
            {notice && <p className="message success" role="status">{notice[lang]}</p>}
            {error && <p className="message error" role="alert">{error[lang]}</p>}
            <div className="queue-filters portal-card">
              <label>{isEn ? 'Status' : 'الحالة'}<select aria-label={t('فلترة بالحالة', 'Filter by status')} value={filterStatus} onChange={(event) => { setFilterStatus(event.target.value); resetPagination() }}><option value="all">{isEn ? 'All Statuses' : 'كل الحالات'}</option>{statuses.map((status) => <option key={status.code} value={status.code}>{pickName(status, lang)}</option>)}<option value="MIXED">{isEn ? 'Mixed Stages' : 'مراحل مختلفة'}</option><option value="NO_ITEMS">{isEn ? 'No Items' : 'بدون بنود'}</option></select></label>
              <label>{isEn ? 'Work Type' : 'نوع العمل'}<select aria-label={t('فلترة بنوع العمل', 'Filter by work type')} value={filterWorkType} onChange={(event) => { setFilterWorkType(event.target.value); resetPagination() }}><option value="all">{isEn ? 'All Work Types' : 'كل أنواع العمل'}</option><option value="thesis">{isEn ? 'Academic Thesis' : 'رسالة علمية'}</option><option value="paper">{isEn ? 'Research Paper' : 'بحث للنشر'}</option></select></label>
              <span className="queue-result-count">{isEn ? 'Page requests: ' : 'طلبات الصفحة: '}{requests.length.toLocaleString(isEn ? 'en-US' : 'ar-EG')}</span>
            </div>
            {queueLoading ? <div className="portal-card loading"><span className="spinner" /> {t('بنحمّل الطلبات...', 'Loading requests...')}</div> : error && !requests.length ? null : requests.length ? (
              <div className="request-list admin-request-list">
                {requests.map((request) => {
                  const requestItems = items.filter((item) => item.request_id === request.request_id)
                  const assignedIds = [...new Set(requestItems.map((item) => item.assigned_staff_id).filter(Boolean))] as string[]
                  const selectedStaffId = assignedIds.length === 1 && requestItems.every((item) => item.assigned_staff_id === assignedIds[0]) ? assignedIds[0] : ''
                  const assignedNames = assignedIds.map((id) => staffMembers.find((member) => member.staff_id === id)?.full_name ?? t('موظف غير متاح', 'Unavailable staff'))
                  const requester = requesters.get(request.researcher_id)
                  const overall = getRequestStatus(request)
                  return (
                    <article className="portal-card admin-request-card" data-testid="admin-request-row" data-request-id={request.request_id} key={request.request_id}>
                      <div className="admin-request-heading"><div><span className="request-type">{request.work_type === 'thesis' ? t('رسالة علمية', 'Academic Thesis') : t('بحث للنشر', 'Research Paper')}</span><h2>{request.work_title}</h2></div><span className="request-card-status">{overall.label}</span></div>
                      <dl className="admin-request-facts">
                        <dt>{t('رقم الطلب', 'Request ID')}</dt><dd><span dir="ltr">#{request.request_id}</span></dd>
                        <dt>الباحث</dt><dd>{requester?.full_name ?? t('بيانات الباحث غير متاحة', 'Researcher details unavailable')} <small dir="ltr">{requester?.email ?? ''}</small></dd>
                        <dt>نوع الباحث</dt><dd>{request.applicant_type === 'egyptian' ? t('مصري', 'Egyptian') : t('وافد', 'International')}</dd>
                        <dt>{t('تاريخ التقديم', 'Submitted On')}</dt><dd>{formatDate(request.created_at)}</dd>
                        <dt>{t('عدد البنود', 'Service Items')}</dt><dd>{request.item_count.toLocaleString(isEn ? 'en-US' : 'ar-EG')}</dd>
                        <dt>{t('المعيّنون حاليًا', 'Currently Assigned')}</dt><dd className="assigned-staff-names">{assignedNames.length ? assignedNames.join('، ') : t('لسه مفيش تعيين', 'Not assigned yet')}</dd>
                      </dl>
                      <div className="admin-request-assignment">
                        <label>{t('تعيين المراجع أو الإحصائي', 'Assign Reviewer or Statistician')}<select aria-label={t('تعيين المراجع أو الإحصائي', 'Assign Reviewer or Statistician')} value={selectedStaffId} disabled={busyRequest !== null || !requestItems.length} onChange={(event) => { const staffId = event.target.value; void singleFlight(() => assignRequest(request, staffId)) }}>
                          <option value="">{t('اختار موظف نشط', 'Select an active staff member')}</option>{assignableStaff.map((member) => <option value={member.staff_id} key={member.staff_id}>{member.full_name} · {ROLE_NAMES[member.role][lang]}</option>)}
                        </select></label>
                        {busyRequest === request.request_id && <span className="assignment-saving">{t('بنحفظ التعيين...', 'Saving assignment...')}</span>}
                      </div>
                    </article>
                  )
                })}
              </div>
            ) : <div className="portal-card empty-requests"><h2>{t('مفيش طلبات مطابقة', 'No Matching Requests')}</h2><p>{t('غيّر الفلاتر علشان تعرض طلبات تانية.', 'Adjust filters to view other requests.')}</p></div>}
            {!queueLoading && !error && requests.length > 0 && <nav className="queue-pagination" aria-label={t('التنقل بين صفحات الطلبات', 'Requests pagination')}>
              <button className="quiet-button" disabled={pageIndex === 0} onClick={previousPage}>{t('السابق', 'Previous')}</button>
              <span>{t('صفحة ', 'Page ')}{(pageIndex + 1).toLocaleString(isEn ? 'en-US' : 'ar-EG')}</span>
              <button className="quiet-button" disabled={!pageHasMore} onClick={nextPage}>{t('التالي', 'Next')}</button>
            </nav>}
          </>
        ) : (
          <>
            <div className="portal-heading"><span className="eyebrow">{isEn ? 'Workspace' : 'مساحة العمل'}</span><h1>{isAdmin ? (isEn ? 'All Requests & Items' : 'كل الطلبات والبنود') : (isEn ? 'My Assigned Requests' : 'الطلبات المسندة إليّ')}</h1><p>{isAdmin ? t('بصفتك مدير النظام، تظهر هنا بنود جميع الطلبات ويمكنك متابعة حالاتها وقرارات النشر.', 'As System Admin, all request items appear here so you can track statuses and publication decisions.') : t('حدّث البنود المسندة لك وسجّل ملاحظتك في مسار الطلب.', 'Update items assigned to you and log notes in the request timeline.')}</p></div>
            {notice && <p className="message success" role="status">{notice[lang]}</p>}
            {error && <p className="message error" role="alert">{error[lang]}</p>}
            {operationLoading ? <div className="portal-card loading"><span className="spinner" /> {t('بنحمّل الطلبات...', 'Loading requests...')}</div> : items.length ? <div className="request-list operational-list">
              {items.map((item) => {
                const request = requests.find((row) => row.request_id === item.request_id)
                const current = statusById.get(item.status_id)
                const publication = publications.find((row) => row.item_id === item.item_id)
                const itemHistory = history.filter((row) => row.item_id === item.item_id)
                if (!request) return null
                return <article className="portal-card operational-item" data-testid="assigned-case" data-item-id={item.item_id} key={item.item_id}>
                  <div className="admin-request-heading"><div><span className="request-type">{request.work_type === 'thesis' ? t('رسالة علمية', 'Academic Thesis') : t('بحث للنشر', 'Research Paper')}</span><h2>{request.work_title}</h2></div><span className="request-card-status">{current ? pickName(current, lang) : t('غير محدد', 'Unspecified')}</span></div>
                  <p className="operational-meta">{t('رقم الطلب', 'Request')} <span dir="ltr">#{request.request_id}</span> · {t('البند', 'Item')} <span dir="ltr">#{item.item_id}</span></p>
                  <form className="operation-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void singleFlight(() => updateStatus(item, String(form.get('status')), String(form.get('note') ?? ''))) }}>
                    <label>{t('الحالة التشغيلية', 'Operational Status')}<select name="status" aria-label={t('الحالة التشغيلية', 'Operational Status')} defaultValue=""><option value="" disabled>{t('اختار الحالة', 'Select status')}</option>{statuses.filter((status) => ['IN_PROGRESS', 'REVISIONS', 'COMPLETED', 'DELIVERED'].includes(status.code)).map((status) => <option value={status.code} key={status.code}>{pickName(status, lang)}</option>)}</select></label>
                    <label>{t('ملاحظة للسجل', 'History Note')}<input name="note" placeholder={t('اكتب ملاحظة مختصرة (اختياري)', 'Write a brief note (optional)')} /><small>{t('الملاحظة هتظهر للباحث', 'This note will be visible to the researcher')}</small></label>
                    <button className="primary-button" disabled={busyItem !== null}>{busyItem === item.item_id ? t('بنحفظ...', 'Saving...') : t('حفظ الحالة', 'Save Status')}</button>
                  </form>
                  <section className="timeline"><h4>{t('سجل الحالة', 'Status History')}</h4>{itemHistory.length ? itemHistory.map((entry) => <div className="timeline-row" key={entry.history_id}><span className="timeline-dot" /><div><strong>{(() => { const s = statusById.get(entry.status_id); return s ? pickName(s, lang) : t('تحديث', 'Update') })()}</strong>{entry.note && <p>{entry.note}</p>}<time dateTime={entry.changed_at}>{formatDate(entry.changed_at)}</time></div></div>) : <p className="empty-state">{t('لسه مفيش تحديثات ظاهرة.', 'No visible updates yet.')}</p>}</section>
                  {publication && <form className="publication-editor" onSubmit={(event) => { event.preventDefault(); const formElement = event.currentTarget; void singleFlight(() => updatePublication(item.item_id, formElement)) }}>
                    <h4>{t('قرار النشر', 'Publication Decision')}</h4><label>{t('القرار', 'Decision')}<select name="decision" defaultValue={publication.decision}><option value="pending">{t('قيد المراجعة', 'Under Review')}</option><option value="revisions">{t('تعديلات', 'Revisions')}</option><option value="accepted">{t('مقبول', 'Accepted')}</option><option value="rejected">{t('مرفوض', 'Rejected')}</option></select></label>
                    <label>{t('المجلة', 'Journal')}<select name="journal_id" value={selectedJournalByItem[item.item_id] ?? publication.journal_id} onChange={(event) => {
                      const journalId = Number(event.target.value)
                      setSelectedJournalByItem((current) => ({ ...current, [item.item_id]: journalId }))
                      setSelectedIssueByItem((current) => ({ ...current, [item.item_id]: '' }))
                      void loadJournalIssues(journalId)
                    }}>{journals.map((journal) => <option value={journal.journal_id} key={journal.journal_id}>{pickName(journal, lang)}</option>)}</select></label>
                    <label>{t('العدد', 'Issue')}<select name="issue_id" value={selectedIssueByItem[item.item_id] ?? publication.issue_id ?? ''} onChange={(event) => setSelectedIssueByItem((current) => ({ ...current, [item.item_id]: event.target.value ? Number(event.target.value) : '' }))}><option value="">{t('من غير عدد', 'No issue assigned')}</option>{issues.filter((issue) => issue.journal_id === (selectedJournalByItem[item.item_id] ?? publication.journal_id)).map((issue) => <option value={issue.issue_id} key={issue.issue_id}>{issue.issue_month}/{issue.issue_year}</option>)}</select></label>
                    <button className="primary-button" disabled={busyItem !== null}>{busyItem === item.item_id ? t('بنحفظ...', 'Saving...') : t('حفظ قرار النشر', 'Save Publication Decision')}</button>
                  </form>}
                </article>
              })}
            </div> : <div className="portal-card empty-requests"><h2>{isAdmin ? t('مفيش بنود للعرض', 'No Items to Display') : t('مفيش طلبات مسندة ليك', 'No Assigned Requests')}</h2><p>{isAdmin ? t('لا توجد بنود ضمن الصفحة الحالية.', 'There are no items on the current page.') : t('هنا هتظهر البنود اللي الأدمن عيّنها لحسابك.', 'Items assigned to your account by the admin will appear here.')}</p></div>}
            {!operationLoading && !error && requests.length > 0 && <nav className="queue-pagination" aria-label={t('التنقل بين صفحات الطلبات المسندة', 'Assigned requests pagination')}>
              <button className="quiet-button" disabled={pageIndex === 0} onClick={previousPage}>{t('السابق', 'Previous')}</button>
              <span>{t('صفحة ', 'Page ')}{(pageIndex + 1).toLocaleString(isEn ? 'en-US' : 'ar-EG')}</span>
              <button className="quiet-button" disabled={!pageHasMore} onClick={nextPage}>{t('التالي', 'Next')}</button>
            </nav>}
          </>
        )}
      </section>
      <footer className="page-footer"><span>CRDC</span><span>{isEn ? 'Consultation, Research & Development Center' : 'مركز الاستشارات والبحوث والتطوير'}</span><span>{isEn ? 'Staff Console' : 'لوحة الموظفين'}</span></footer>
    </main>
  )
}

