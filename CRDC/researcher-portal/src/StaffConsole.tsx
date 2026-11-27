import { Suspense, lazy, useEffect, useMemo, useState, useRef } from 'react'
import { supabase } from './supabase'
import { UiError, friendlyErrorText, useSingleFlight, type LocalizedText } from './errors'
const AnalyticsDashboard = lazy(() => import('./AnalyticsDashboard'))
import { useI18n, pickName, type Lang } from './i18n'
import AdminSearchSidebar from './AdminSearchSidebar'
import CashierQueueView from './CashierQueueView'

type StaffRole = 'admin' | 'reviewer' | 'publication_reviewer' | 'language_reviewer' | 'statistician' | 'digital_transformation_officer' | 'plagiarism_officer' | 'cashier' | 'viewer'
type StaffProfile = { staff_id: string; full_name: string; full_name_en?: string | null; role: StaffRole; is_active: boolean }
const staffName = (m: { full_name: string; full_name_en?: string | null }, lang: string) =>
  lang === 'en' ? (m.full_name_en?.trim() || m.full_name) : m.full_name
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
  file_url?: string | null
}
type Requester = { researcher_id: string; full_name: string; email: string; applicant_type: 'egyptian' | 'foreign' }
type RequestItem = { item_id: number; request_id: number; service_id: number; status_id: number; assigned_staff_id: string | null; payment_id?: number | null }
type RequestStatus = { status_id: number; code: string; name_ar: string; name_en?: string | null; sort_order: number }
type HistoryRow = { history_id: number; item_id: number; status_id: number; changed_at: string; note: string | null }
type PublicationRow = { submission_id: number; item_id: number; journal_id: number; issue_id: number | null; decision: 'pending' | 'revisions' | 'accepted' | 'rejected'; accepted_at: string | null }
type Journal = { journal_id: number; name_ar: string; name_en?: string | null }
type JournalIssue = { issue_id: number; journal_id: number; issue_year: number; issue_month: number }

const OPERATIONAL_ROLES: StaffRole[] = ['reviewer', 'publication_reviewer', 'language_reviewer', 'statistician', 'digital_transformation_officer', 'plagiarism_officer']
const roleMatchesService = (role: StaffRole, serviceId: number): boolean => role === 'reviewer' || (role === 'publication_reviewer' && serviceId === 1) || (role === 'language_reviewer' && serviceId === 2) || (role === 'statistician' && serviceId === 3) || (role === 'digital_transformation_officer' && serviceId === 4) || (role === 'plagiarism_officer' && serviceId === 5)
const ROLE_NAMES: Record<StaffRole, LocalizedText> = {
  admin: { ar: 'مدير النظام', en: 'System Admin' },
  reviewer: { ar: 'مراجع', en: 'Reviewer' },
  publication_reviewer: { ar: 'مسؤول التحكيم والنشر', en: 'Publication Reviewer' },
  language_reviewer: { ar: 'مدقق لغوي', en: 'Language Reviewer' },
  statistician: { ar: 'إحصائي', en: 'Statistician' },
  digital_transformation_officer: { ar: 'مسؤول التحول الرقمي', en: 'Digital Transformation Officer' },
  plagiarism_officer: { ar: 'مسؤول قياس الاقتباس', en: 'Plagiarism Officer' },
  cashier: { ar: 'أمين خزينة', en: 'Cashier' },
  viewer: { ar: 'مشاهد', en: 'Viewer' },
}
type PageCursor = { created_at: string; request_id: number }
const pageSize = 20

const formatDate = (value: string, lang: Lang = 'ar') => new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'ar-EG', { dateStyle: 'medium' }).format(new Date(value))

export default function StaffConsole({ staff, onSignOut }: { staff: StaffProfile; onSignOut: () => void }) {
  const { t, lang, dir, isEn } = useI18n()
  const [rows, setRows] = useState<SummaryRow[]>([])
  const [loadingOverview, setLoadingOverview] = useState(staff.role === 'admin' || staff.role === 'viewer')
  const [view, setView] = useState<'overview' | 'analytics' | 'requests' | 'assigned' | 'cashier'>(staff.role === 'cashier' ? 'cashier' : staff.role === 'viewer' ? 'analytics' : 'overview')
  const [requests, setRequests] = useState<QueueRequest[]>([])
  const [requesters, setRequesters] = useState<Map<string, Requester>>(new Map())
  const [items, setItems] = useState<RequestItem[]>([])
  const [statuses, setStatuses] = useState<RequestStatus[]>([])
  const [services, setServices] = useState<{ service_id: number; name_ar: string; name_en?: string | null }[]>([])
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
  const catalogLoadedRef = useRef(false)
  const [selectedJournalByItem, setSelectedJournalByItem] = useState<Record<number, number>>({})
  const [selectedIssueByItem, setSelectedIssueByItem] = useState<Record<number, number | ''>>({})
  const [operationLoading, setOperationLoading] = useState(false)
  const [busyItem, setBusyItem] = useState<number | null>(null)
  const singleFlight = useSingleFlight()
  const canViewOverview = staff.role === 'admin' || staff.role === 'viewer'
  const isAdmin = staff.role === 'admin'
  const isCashier = staff.role === 'cashier'
  const canOperate = isAdmin || OPERATIONAL_ROLES.includes(staff.role)
  const pageCursor = cursorStack[pageIndex] ?? null

  useEffect(() => {
    if (!canViewOverview || !supabase) return
    let alive = true
    void (async () => {
      try {
        const { data, error: queryError } = await supabase.schema('crdc').from('staff_dashboard_overview')
          .select('metric, category, label, label_en, request_count')
        if (!alive) return
        if (queryError) setError({ ar: 'تعذّر تحميل الإحصائيات حاليًا. يُرجى المحاولة بعد قليل.', en: 'Unable to load statistics right now. Please try again shortly.' })
        else setRows((data ?? []) as SummaryRow[])
      } catch {
        if (alive) setError({ ar: 'تعذّر تحميل الإحصائيات حاليًا. يُرجى المحاولة بعد قليل.', en: 'Unable to load statistics right now. Please try again shortly.' })
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
          ? supabase.schema('crdc').from('request_items').select('item_id, request_id, service_id, status_id, assigned_staff_id, payment_id').in('request_id', requestIds).order('item_id')
          : Promise.resolve({ data: [], error: null })
        const filePromise = requestIds.length ? supabase.schema('crdc').from('service_requests').select('request_id, file_url').in('request_id', requestIds) : Promise.resolve({ data: [], error: null });
        const [itemResult, statusResult, staffResult, serviceResult, fileResult] = await Promise.all([
          itemPromise,
          supabase.schema('crdc').from('request_statuses').select('status_id, code, name_ar, name_en, sort_order').order('sort_order'),
          isAdmin && view === 'requests'
            ? supabase.schema('crdc').from('staff_users').select('staff_id, full_name, full_name_en, role, is_active').order('full_name')
            : Promise.resolve({ data: [], error: null }),
          supabase.schema('crdc').from('services').select('service_id, name_ar, name_en').order('service_id'),
          filePromise,
        ])
        if (itemResult.error || statusResult.error || staffResult.error || serviceResult.error) throw itemResult.error ?? statusResult.error ?? staffResult.error ?? serviceResult.error
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
        let loadedCatalog: { journals: Journal[]; issues: JournalIssue[] } | null = null
        if (view === 'assigned') {
          if (!catalogLoadedRef.current) {
            const [journalResult, issueResult] = await Promise.all([
              supabase.schema('crdc').from('journals').select('journal_id, name_ar, name_en').order('journal_id'),
              supabase.schema('crdc').from('journal_issues').select('issue_id, journal_id, issue_year, issue_month').order('issue_year', { ascending: false }),
            ])
            if (journalResult.error || issueResult.error) throw journalResult.error ?? issueResult.error
            loadedCatalog = { journals: (journalResult.data ?? []) as Journal[], issues: (issueResult.data ?? []) as JournalIssue[] }
          }
          if (itemIds.length) {
            const [historyResult, publicationResult] = await Promise.all([
              supabase.schema('crdc').from('request_status_history').select('history_id, item_id, status_id, changed_at, note').in('item_id', itemIds).order('changed_at', { ascending: false }),
              supabase.schema('crdc').from('publication_submissions').select('submission_id, item_id, journal_id, issue_id, decision, accepted_at').in('item_id', itemIds),
            ])
            if (historyResult.error || publicationResult.error) throw historyResult.error ?? publicationResult.error
            historyRows = (historyResult.data ?? []) as HistoryRow[]
            publicationRows = (publicationResult.data ?? []) as PublicationRow[]
          }
        }

        if (!alive) return
        const fileMap = new Map(((fileResult.data ?? []) as { request_id: number; file_url: string | null }[]).map((r) => [r.request_id, r.file_url]));
        setRequests(requestRows.map((r) => ({ ...r, file_url: fileMap.get(r.request_id) ?? null })))
        setPageHasMore(Boolean(fetchedRows[0]?.has_more))
        setItems(itemRows)
        setStatuses((statusResult.data ?? []) as RequestStatus[])
        setServices((serviceResult.data ?? []) as { service_id: number; name_ar: string; name_en?: string | null }[])
        setStaffMembers((staffResult.data ?? []) as StaffProfile[])
        setRequesters(new Map(researcherRows.map((researcher) => [researcher.researcher_id, researcher])))
        setHistory(historyRows)
        setPublications(publicationRows)
        if (loadedCatalog) {
          catalogLoadedRef.current = true
          setJournals(loadedCatalog.journals)
          setIssues(loadedCatalog.issues)
        }
        setSelectedJournalByItem({})
        setSelectedIssueByItem({})
      } catch {
        if (alive) setError(view === 'requests'
          ? { ar: 'حدثت مشكلة أثناء تحميل الطلبات. تحقّق من الاتصال أو صلاحيات الحساب وحاول مرة أخرى.', en: 'Failed to load requests. Check your connection or permissions and try again.' }
          : { ar: 'تعذّر تحميل الطلبات المسندة. يُرجى المحاولة بعد قليل.', en: 'Unable to load assigned requests right now. Please try again shortly.' })
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
  const assignableStaff = staffMembers.filter((member) => member.is_active && OPERATIONAL_ROLES.includes(member.role))
  const serviceById = useMemo(() => new Map(services.map((service) => [service.service_id, service])), [services])

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

  async function issuePaymentOrder(request: QueueRequest) {
    if (!supabase || !isAdmin) return
    setBusyRequest(request.request_id)
    setError(null)
    setNotice(null)
    try {
      const { data, error: rpcError } = await supabase.schema('crdc').rpc('issue_payment_order', { p_request_id: request.request_id })
      if (rpcError) throw rpcError
      const paymentIds = (data ?? []) as number[]
      const orderStatus = statuses.find((status) => status.code === 'PAYMENT_ORDER')
      if (orderStatus) {
        setItems((current) => current.map((item) =>
          item.request_id === request.request_id && item.payment_id == null
            ? { ...item, status_id: orderStatus.status_id, payment_id: paymentIds[0] ?? item.payment_id }
            : item))
      }
      setNotice({
        ar: `تم إصدار أمر الدفع للطلب رقم ${request.request_id} (${paymentIds.length} إذن).`,
        en: `Payment order issued for request #${request.request_id} (${paymentIds.length} order(s)).`,
      })
    } catch (issueError) {
      setError(friendlyErrorText(issueError, {
        '42501': { ar: 'تعذّر إصدار أمر الدفع: حسابك ليس مدير نظام، أو أنت باحث هذا الطلب.', en: 'Cannot issue payment order: you are not an admin, or you are the researcher of this request.' },
        '23514': { ar: 'لا توجد بنود مقدّمة وغير مدفوعة في هذا الطلب.', en: 'No submitted unpaid items in this request.' },
      }))
    } finally {
      setBusyRequest(null)
    }
  }

  async function assignItem(request: QueueRequest, item: RequestItem, staffId: string) {
    if (!supabase || !staffId) return
    setBusyRequest(request.request_id); setError(null); setNotice(null)
    try {
      const selectedStaff = assignableStaff.find((member) => member.staff_id === staffId)
      if (!selectedStaff) throw new UiError('اختر موظفًا نشطًا من القائمة.', 'Please select an active staff member from the list.')
      if (!roleMatchesService(selectedStaff.role, item.service_id)) throw new UiError('تخصص الموظف لا يطابق هذه الخدمة.', 'Staff specialization does not match this service.')
      const { data, error: updateError } = await supabase.schema('crdc').from('request_items').update({ assigned_staff_id: staffId }).eq('item_id', item.item_id).select('item_id')
      if (updateError) throw updateError
      if (!(data ?? []).length) throw new UiError('تعذّر تأكيد تعيين البند. حدّث القائمة وراجع الطلب.', 'Could not confirm item assignment. Refresh and review.')
      setItems((current) => current.map((row) => row.item_id === item.item_id ? { ...row, assigned_staff_id: staffId } : row))
      const service = serviceById.get(item.service_id); const serviceLabel = service ? pickName(service, lang) : t('الخدمة', 'Service')
      setNotice({ ar: `تم تعيين ${ROLE_NAMES[selectedStaff.role].ar} ${selectedStaff.full_name} على بند ${serviceLabel} في الطلب رقم ${request.request_id}.`, en: `Assigned ${ROLE_NAMES[selectedStaff.role].en} ${staffName(selectedStaff, 'en')} to ${serviceLabel} on request #${request.request_id}.` })
    } catch (assignmentError) {
      setError(friendlyErrorText(assignmentError, { '42501': { ar: 'تم رفض التعيين. تأكّد من أن تخصص الموظف يطابق الخدمة وأنه نشط.', en: 'Assignment denied. Ensure the staff member is active and matches this service.' } }))
    } finally { setBusyRequest(null) }
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

  async function updatePublication(itemId: number, form: HTMLFormElement) {
    if (!supabase) return
    setBusyItem(itemId); setError(null); setNotice(null)
    const data = new FormData(form)
    const journalId = Number(data.get('journal_id'))
    const issueRaw = data.get('issue_id')
    const issueId = issueRaw ? Number(issueRaw) : null
    try {
      if (!Number.isInteger(journalId) || journalId <= 0 || !journals.some((journal) => journal.journal_id === journalId)) {
        throw new UiError({ ar: 'اختر مجلة صالحة من القائمة.', en: 'Select a valid journal from the list.' })
      }
      const decision = String(data.get('decision')) as PublicationRow['decision']
      const { error: rpcError } = await supabase.schema('crdc').rpc('update_publication_submission', {
        p_item_id: itemId, p_decision: decision, p_journal_id: journalId, p_issue_id: issueId,
      })
      if (rpcError) throw rpcError
      setPublications((current) => current.map((row) => row.item_id === itemId ? { ...row, decision, journal_id: journalId, issue_id: issueId, accepted_at: decision === 'accepted' ? (row.accepted_at ?? new Date().toISOString().slice(0, 10)) : null } : row))
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
        <div className="staff-top-actions"><span className="staff-name">{staffName(staff, lang)}</span><span className="role-badge">{ROLE_NAMES[staff.role][lang]}</span><button className="quiet-button" onClick={onSignOut}>{isEn ? 'Sign Out' : 'تسجيل الخروج'}</button></div>
      </header>

      <nav className="researcher-nav" aria-label={t('التنقل في لوحة الموظف', 'Staff console navigation')}>
        {staff.role === 'viewer' && analyticsButton}
        {canViewOverview && <button className={view === 'overview' ? 'active' : ''} aria-current={view === 'overview' ? 'page' : undefined} onClick={() => { setView('overview'); setError(null); setNotice(null) }}>{isEn ? 'Overview & Statistics' : 'نظرة عامة وإحصائيات'}</button>}
        {isAdmin && analyticsButton}
        {(isAdmin || isCashier) && <button className={view === 'cashier' ? 'active' : ''} aria-current={view === 'cashier' ? 'page' : undefined} onClick={() => { setView('cashier'); setError(null); setNotice(null) }}>{isEn ? 'Review Payment Receipts' : 'مراجعة إيصالات السداد'}</button>}
        {isAdmin && <button className={view === 'requests' ? 'active' : ''} aria-current={view === 'requests' ? 'page' : undefined} onClick={() => { setView('requests'); setError(null); setNotice(null) }}>{isEn ? 'Requests & Assignments' : 'إدارة الطلبات والتعيينات'}</button>}
        {canOperate && <button className={view === 'assigned' ? 'active' : ''} aria-current={view === 'assigned' ? 'page' : undefined} onClick={() => { setView('assigned'); setError(null); setNotice(null) }}>{isAdmin ? (isEn ? 'All Requests & Items' : 'كل الطلبات والبنود') : (isEn ? 'My Assigned Requests' : 'الطلبات المسندة إليّ')}</button>}
      </nav>

      <div className={isAdmin ? "admin-workspace-layout" : undefined}>{isAdmin && <AdminSearchSidebar lang={lang} isEn={isEn} />}<section className="portal-content" id="staff-home">
        {!canViewOverview && !isAdmin && !canOperate && !isCashier ? (
          <><div className="portal-heading"><span className="eyebrow">{t('لوحة الموظفين', 'Staff Dashboard')}</span><h1>{t('أهلًا،', 'Welcome,')} {staffName(staff, lang)}</h1></div><div className="portal-card staff-placeholder"><p>{t(`تم تسجيل دخولك بصلاحية ${ROLE_NAMES[staff.role].ar}. ستُضاف الشاشات الخاصة بهذا الدور في مرحلة لاحقة.`, `Signed in as ${ROLE_NAMES[staff.role].en}. Role-specific screens will be added in a future update.`)}</p></div></>
        ) : view === 'analytics' && canViewOverview ? (
          <Suspense fallback={<div className="portal-card loading" aria-busy="true"><span className="spinner" /> {t('بنحمّل لوحة التحليلات...', 'Loading analytics...')}</div>}><AnalyticsDashboard /></Suspense>
        ) : view === 'overview' ? (
          <>
            <div className="portal-heading"><span className="eyebrow">{t('لوحة الموظفين', 'Staff Dashboard')}</span><h1>{isEn ? 'Overview & Statistics' : 'نظرة عامة وإحصائيات'}</h1><p>أرقام مجمّعة عن الطلبات، دون عرض بيانات الباحثين أو تفاصيل طلباتهم.</p></div>
            {!canViewOverview ? <div className="portal-card staff-placeholder"><h2>{t('أهلًا،', 'Welcome,')} {staffName(staff, lang)}</h2><p>{t('تابع إدارة الطلبات من التبويب المخصص.', 'Manage requests from the dedicated tab.')}</p></div> : loadingOverview ? <div className="portal-card loading"><span className="spinner" /> {isEn ? 'Loading figures...' : 'جارٍ تحميل الأرقام...'}</div> : error ? <p className="message error" role="alert">{error[lang]}</p> : (
              <>
                <div className="staff-stat-grid">
                  <article className="portal-card staff-stat-card"><span>{isEn ? 'Total Requests' : 'إجمالي الطلبات'}</span><strong>{total.toLocaleString(isEn ? 'en-US' : 'ar-EG')}</strong><small>{isEn ? 'All registered requests' : 'كل الطلبات المسجلة'}</small></article>
                  <article className="portal-card staff-stat-card"><span>{isEn ? 'Egyptian Requests' : 'طلبات المصريين'}</span><strong>{egyptian.toLocaleString(isEn ? 'en-US' : 'ar-EG')}</strong><small>{isEn ? 'By applicant type' : 'حسب نوع الباحث'}</small></article>
                  <article className="portal-card staff-stat-card"><span>{isEn ? 'International Requests' : 'طلبات الوافدين'}</span><strong>{foreign.toLocaleString(isEn ? 'en-US' : 'ar-EG')}</strong><small>{isEn ? 'By applicant type' : 'حسب نوع الباحث'}</small></article>
                </div>
                <section className="portal-card staff-status-card" aria-labelledby="status-heading">
                  <div className="staff-section-heading"><div><span className="eyebrow">{isEn ? 'Request Distribution' : 'توزيع الطلبات'}</span><h2 id="status-heading">{isEn ? 'By Status' : 'حسب الحالة'}</h2></div><span className="role-badge">{isEn ? 'Aggregated View' : 'عرض مجمّع'}</span></div>
                  {summaryStatuses.length ? <ul className="staff-status-list">{summaryStatuses.map((row) => <li key={row.category}><span>{pickName({ name_ar: row.label, name_en: row.label_en }, lang)}</span><strong>{Number(row.request_count).toLocaleString(isEn ? 'en-US' : 'ar-EG')}</strong></li>)}</ul> : <p className="empty-state">{t('لا توجد حالات طلبات للعرض حاليًا.', 'No request statuses to display right now.')}</p>}
                </section>
              </>
            )}
          </>
        ) : view === 'cashier' ? (
          <CashierQueueView isAdmin={isAdmin} isCashier={isCashier} statusById={statusById} onStatusesLoaded={setStatuses} onServicesLoaded={setServices} />
        ) : view === 'requests' ? (
          <>
            <div className="portal-heading"><span className="eyebrow">{isEn ? 'Center Administration' : 'إدارة المركز'}</span><h1>{isEn ? 'Requests & Assignments' : 'إدارة الطلبات والتعيينات'}</h1><p>{isEn ? 'Review requests and items, and assign an active reviewer or statistician to each request.' : 'راجع الطلبات وبنودها، وعيّن مراجعًا أو إحصائيًا نشطًا لكل طلب.'}</p></div>
            {notice && <p className="message success" role="status">{notice[lang]}</p>}
            {error && <p className="message error" role="alert">{error[lang]}</p>}
            <div className="queue-filters portal-card">
              <label>{isEn ? 'Status' : 'الحالة'}<select aria-label={t('التصفية حسب الحالة', 'Filter by status')} value={filterStatus} onChange={(event) => { setFilterStatus(event.target.value); resetPagination() }}><option value="all">{isEn ? 'All Statuses' : 'كل الحالات'}</option>{statuses.map((status) => <option key={status.code} value={status.code}>{pickName(status, lang)}</option>)}<option value="MIXED">{isEn ? 'Mixed Stages' : 'مراحل مختلفة'}</option><option value="NO_ITEMS">{isEn ? 'No Items' : 'بدون بنود'}</option></select></label>
              <label>{isEn ? 'Work Type' : 'نوع العمل'}<select aria-label={t('التصفية حسب نوع العمل', 'Filter by work type')} value={filterWorkType} onChange={(event) => { setFilterWorkType(event.target.value); resetPagination() }}><option value="all">{isEn ? 'All Work Types' : 'كل أنواع العمل'}</option><option value="thesis">{isEn ? 'Academic Thesis' : 'رسالة علمية'}</option><option value="paper">{isEn ? 'Research Paper' : 'بحث للنشر'}</option></select></label>
              <span className="queue-result-count">{isEn ? 'Page requests: ' : 'طلبات الصفحة: '}{requests.length.toLocaleString(isEn ? 'en-US' : 'ar-EG')}</span>
            </div>
            {queueLoading ? <div className="portal-card loading"><span className="spinner" /> {t('جارٍ تحميل الطلبات...', 'Loading requests...')}</div> : error && !requests.length ? null : requests.length ? (
              <div className="request-list admin-request-list">
                {requests.map((request) => {
                  const requestItems = items.filter((item) => item.request_id === request.request_id)
                  const assignedIds = [...new Set(requestItems.map((item) => item.assigned_staff_id).filter(Boolean))] as string[]
                  const assignedNames = assignedIds.map((id) => { const m = staffMembers.find((member) => member.staff_id === id); return m ? staffName(m, lang) : t('موظف غير متاح', 'Unavailable staff') })
                  const requester = requesters.get(request.researcher_id)
                  const overall = getRequestStatus(request)
                  const canIssueOrder = requestItems.some((item) => item.payment_id == null && statuses.find((s) => s.status_id === item.status_id)?.code === 'SUBMITTED')
                  return (
                    <article className="portal-card admin-request-card" data-testid="admin-request-row" data-request-id={request.request_id} key={request.request_id}>
                      <div className="admin-request-heading"><div><span className="request-type">{request.work_type === 'thesis' ? t('رسالة علمية', 'Academic Thesis') : t('بحث للنشر', 'Research Paper')}</span><h2>{request.work_title}</h2></div><span className="request-card-status">{overall.label}</span></div>
                      <dl className="admin-request-facts">
                        <dt>{t('رقم الطلب', 'Request ID')}</dt><dd><span dir="ltr">#{request.request_id}</span></dd>
                        <dt>{t('الباحث', 'Researcher')}</dt><dd>{requester?.full_name ?? t('بيانات الباحث غير متاحة', 'Researcher details unavailable')} <small dir="ltr">{requester?.email ?? ''}</small></dd>
                        <dt>{t('نوع الباحث', 'Applicant Type')}</dt><dd>{request.applicant_type === 'egyptian' ? t('مصري', 'Egyptian') : t('وافد', 'International')}</dd>
                        <dt>{t('تاريخ التقديم', 'Submitted On')}</dt><dd>{formatDate(request.created_at, lang)}</dd>
                        <dt>{t('عدد البنود', 'Service Items')}</dt><dd>{request.item_count.toLocaleString(isEn ? 'en-US' : 'ar-EG')}</dd>
                        <dt>{t('المعيّنون حاليًا', 'Currently Assigned')}</dt><dd className="assigned-staff-names">{assignedNames.length ? assignedNames.join('، ') : t('لم يُعيَّن أحد بعد', 'Not assigned yet')}</dd>
                      </dl>
                      <div className="admin-request-assignment">
                        {canIssueOrder && <div className="admin-request-payment-order">
                          <button className="primary-button" disabled={busyRequest !== null} onClick={() => void singleFlight(() => issuePaymentOrder(request))}>
                            {t('إصدار أمر الدفع', 'Issue Payment Order')}
                          </button>
                        </div>}
                        <div className="admin-item-assignments">{requestItems.map((item) => { const service = serviceById.get(item.service_id); const serviceLabel = service ? pickName(service, lang) : t('خدمة', 'Service'); const itemStatus = statusById.get(item.status_id); const eligibleStaff = assignableStaff.filter((member) => roleMatchesService(member.role, item.service_id)); return (<div className="admin-item-assignment-row" key={item.item_id}><div className="admin-item-assignment-meta"><strong>{serviceLabel}</strong>{itemStatus && <small className="item-status-badge">{pickName(itemStatus, lang)}</small>}</div><label className="admin-item-assignment-field">{t('تعيين المراجع أو الإحصائي', 'Assign Reviewer or Statistician')}<select aria-label={t('تعيين المراجع أو الإحصائي', 'Assign Reviewer or Statistician')} value={item.assigned_staff_id ?? ''} disabled={busyRequest !== null} onChange={(event) => { const staffId = event.target.value; void singleFlight(() => assignItem(request, item, staffId)) }}><option value="">{t('اختر موظفًا نشطًا', 'Select an active staff member')}</option>{eligibleStaff.map((member) => <option value={member.staff_id} key={member.staff_id}>{staffName(member, lang)} · {ROLE_NAMES[member.role][lang]}</option>)}</select></label></div>) })}</div>
                        {busyRequest === request.request_id && <span className="assignment-saving">{t('جارٍ حفظ التعيين...', 'Saving assignment...')}</span>}
                      </div>
                    </article>
                  )
                })}
              </div>
            ) : <div className="portal-card empty-requests"><h2>{t('لا توجد طلبات مطابقة', 'No Matching Requests')}</h2><p>{t('غيّر عوامل التصفية لعرض طلبات أخرى.', 'Adjust filters to view other requests.')}</p></div>}
            {!queueLoading && !error && requests.length > 0 && <nav className="queue-pagination" aria-label={t('التنقل بين صفحات الطلبات', 'Requests pagination')}>
              <button className="quiet-button" disabled={pageIndex === 0} onClick={previousPage}>{t('السابق', 'Previous')}</button>
              <span>{t('صفحة ', 'Page ')}{(pageIndex + 1).toLocaleString(isEn ? 'en-US' : 'ar-EG')}</span>
              <button className="quiet-button" disabled={!pageHasMore} onClick={nextPage}>{t('التالي', 'Next')}</button>
            </nav>}
          </>
        ) : (
          <>
            <div className="portal-heading"><span className="eyebrow">{isEn ? 'Workspace' : 'مساحة العمل'}</span><h1>{isAdmin ? (isEn ? 'All Requests & Items' : 'كل الطلبات والبنود') : (isEn ? 'My Assigned Requests' : 'الطلبات المسندة إليّ')}</h1><p>{isAdmin ? t('بصفتك مدير النظام، تظهر هنا بنود جميع الطلبات ويمكنك متابعة حالاتها وقرارات النشر.', 'As System Admin, all request items appear here so you can track statuses and publication decisions.') : t('حدّث البنود المسندة إليك، وسجّل ملاحظتك في مسار الطلب.', 'Update items assigned to you and log notes in the request timeline.')}</p></div>
            {notice && <p className="message success" role="status">{notice[lang]}</p>}
            {error && <p className="message error" role="alert">{error[lang]}</p>}
            {operationLoading ? <div className="portal-card loading"><span className="spinner" /> {t('جارٍ تحميل الطلبات...', 'Loading requests...')}</div> : items.length ? <div className="request-list operational-list">
              {items.map((item) => {
                const request = requests.find((row) => row.request_id === item.request_id)
                const current = statusById.get(item.status_id)
                const service = serviceById.get(item.service_id)
                const serviceLabel = service ? pickName(service, lang) : ''
                const publication = publications.find((row) => row.item_id === item.item_id)
                const itemHistory = history.filter((row) => row.item_id === item.item_id)
                if (!request) return null
                return <article className="portal-card operational-item" data-testid="assigned-case" data-item-id={item.item_id} key={item.item_id}>
                  <div className="admin-request-heading"><div><span className="request-type">{serviceLabel ? `${serviceLabel} · ` : ''}{request.work_type === 'thesis' ? t('رسالة علمية', 'Academic Thesis') : t('بحث للنشر', 'Research Paper')}</span><h2>{request.work_title}</h2></div><span className="request-card-status">{current ? pickName(current, lang) : t('غير محدد', 'Unspecified')}</span></div>
                  <p className="operational-meta">{t('رقم الطلب', 'Request')} <span dir="ltr">#{request.request_id}</span> · {t('البند', 'Item')} <span dir="ltr">#{item.item_id}</span>{request.file_url ? <> · <a className="quiet-button" href={request.file_url} target="_blank" rel="noopener noreferrer">{t('عرض / تحميل البحث', 'View / Download Research')}</a></> : null}</p>
                  <form className="operation-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void singleFlight(() => updateStatus(item, String(form.get('status')), String(form.get('note') ?? ''))) }}>
                    <label>{t('الحالة التشغيلية', 'Operational Status')}<select name="status" aria-label={t('الحالة التشغيلية', 'Operational Status')} defaultValue=""><option value="" disabled>{t('اختر الحالة', 'Select status')}</option>{statuses.filter((status) => ['IN_PROGRESS', 'REVISIONS', 'COMPLETED', 'DELIVERED'].includes(status.code)).map((status) => <option value={status.code} key={status.code}>{pickName(status, lang)}</option>)}</select></label>
                    <label>{t('ملاحظة للسجل', 'History Note')}<input name="note" placeholder={t('اكتب ملاحظة مختصرة (اختياري)', 'Write a brief note (optional)')} /><small>{t('ستظهر الملاحظة للباحث', 'This note will be visible to the researcher')}</small></label>
                    <button className="primary-button" disabled={busyItem !== null}>{busyItem === item.item_id ? t('جارٍ الحفظ...', 'Saving...') : t('حفظ الحالة', 'Save Status')}</button>
                  </form>
                  <section className="timeline"><h4>{t('سجل الحالة', 'Status History')}</h4>{itemHistory.length ? itemHistory.map((entry) => <div className="timeline-row" key={entry.history_id}><span className="timeline-dot" /><div><strong>{(() => { const s = statusById.get(entry.status_id); return s ? pickName(s, lang) : t('تحديث', 'Update') })()}</strong>{entry.note && <p>{entry.note}</p>}<time dateTime={entry.changed_at}>{formatDate(entry.changed_at, lang)}</time></div></div>) : <p className="empty-state">{t('لا توجد تحديثات بعد.', 'No visible updates yet.')}</p>}</section>
                  {publication && <form className="publication-editor" onSubmit={(event) => { event.preventDefault(); const formElement = event.currentTarget; void singleFlight(() => updatePublication(item.item_id, formElement)) }}>
                    <h4>{t('قرار النشر', 'Publication Decision')}</h4><label>{t('القرار', 'Decision')}<select name="decision" defaultValue={publication.decision}><option value="pending">{t('قيد المراجعة', 'Under Review')}</option><option value="revisions">{t('تعديلات', 'Revisions')}</option><option value="accepted">{t('مقبول', 'Accepted')}</option><option value="rejected">{t('مرفوض', 'Rejected')}</option></select></label>
                    <label>{t('المجلة', 'Journal')}<select name="journal_id" value={selectedJournalByItem[item.item_id] ?? publication.journal_id} onChange={(event) => {
                      const journalId = Number(event.target.value)
                      setSelectedJournalByItem((current) => ({ ...current, [item.item_id]: journalId }))
                      setSelectedIssueByItem((current) => ({ ...current, [item.item_id]: '' }))
                    }}>{journals.map((journal) => <option value={journal.journal_id} key={journal.journal_id}>{pickName(journal, lang)}</option>)}</select></label>
                    <label>{t('العدد', 'Issue')}<select name="issue_id" value={selectedIssueByItem[item.item_id] ?? publication.issue_id ?? ''} onChange={(event) => setSelectedIssueByItem((current) => ({ ...current, [item.item_id]: event.target.value ? Number(event.target.value) : '' }))}><option value="">{t('دون عدد', 'No issue assigned')}</option>{issues.filter((issue) => issue.journal_id === (selectedJournalByItem[item.item_id] ?? publication.journal_id)).map((issue) => <option value={issue.issue_id} key={issue.issue_id}>{issue.issue_month}/{issue.issue_year}</option>)}</select></label>
                    <button className="primary-button" disabled={busyItem !== null}>{busyItem === item.item_id ? t('جارٍ الحفظ...', 'Saving...') : t('حفظ قرار النشر', 'Save Publication Decision')}</button>
                  </form>}
                </article>
              })}
            </div> : <div className="portal-card empty-requests"><h2>{isAdmin ? t('لا توجد بنود للعرض', 'No Items to Display') : t('لا توجد طلبات مسندة إليك', 'No Assigned Requests')}</h2><p>{isAdmin ? t('لا توجد بنود ضمن الصفحة الحالية.', 'There are no items on the current page.') : t('ستظهر هنا البنود التي عيّنها مدير النظام لحسابك.', 'Items assigned to your account by the admin will appear here.')}</p></div>}
            {!operationLoading && !error && requests.length > 0 && <nav className="queue-pagination" aria-label={t('التنقل بين صفحات الطلبات المسندة', 'Assigned requests pagination')}>
              <button className="quiet-button" disabled={pageIndex === 0} onClick={previousPage}>{t('السابق', 'Previous')}</button>
              <span>{t('صفحة ', 'Page ')}{(pageIndex + 1).toLocaleString(isEn ? 'en-US' : 'ar-EG')}</span>
              <button className="quiet-button" disabled={!pageHasMore} onClick={nextPage}>{t('التالي', 'Next')}</button>
            </nav>}
          </>
        )}
      </section></div>
      <footer className="page-footer"><span>CRDC</span><span>{isEn ? 'Consultation, Research & Development Center' : 'مركز الاستشارات والبحوث والتطوير'}</span><span>{isEn ? 'Staff Console' : 'لوحة الموظفين'}</span></footer>
    </main>
  )
}





