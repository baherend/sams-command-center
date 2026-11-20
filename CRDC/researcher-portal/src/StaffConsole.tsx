import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'

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
}
type Requester = { researcher_id: string; full_name: string; email: string; applicant_type: 'egyptian' | 'foreign' }
type RequestItem = { item_id: number; request_id: number; status_id: number; assigned_staff_id: string | null }
type RequestStatus = { status_id: number; code: string; name_ar: string; sort_order: number }

const roleNames: Record<StaffRole, string> = {
  admin: 'مدير النظام', reviewer: 'مراجع', statistician: 'إحصائي', cashier: 'أمين خزينة', viewer: 'مشاهد',
}
const pageSize = 500

async function fetchRequests(): Promise<QueueRequest[]> {
  if (!supabase) return []
  const result: QueueRequest[] = []
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.schema('crdc').from('service_requests')
      .select('request_id, researcher_id, applicant_type, work_type, work_title, page_count, created_at')
      .order('created_at', { ascending: false }).range(offset, offset + pageSize - 1)
    if (error) throw error
    result.push(...(data ?? []) as QueueRequest[])
    if (!data || data.length < pageSize) return result
  }
}

async function fetchRequestItems(): Promise<RequestItem[]> {
  if (!supabase) return []
  const result: RequestItem[] = []
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.schema('crdc').from('request_items')
      .select('item_id, request_id, status_id, assigned_staff_id')
      .order('item_id').range(offset, offset + pageSize - 1)
    if (error) throw error
    result.push(...(data ?? []) as RequestItem[])
    if (!data || data.length < pageSize) return result
  }
}

const formatDate = (value: string) => new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium' }).format(new Date(value))

export default function StaffConsole({ staff, onSignOut }: { staff: StaffProfile; onSignOut: () => void }) {
  const [rows, setRows] = useState<SummaryRow[]>([])
  const [loadingOverview, setLoadingOverview] = useState(staff.role === 'admin' || staff.role === 'viewer')
  const [view, setView] = useState<'overview' | 'requests'>('overview')
  const [requests, setRequests] = useState<QueueRequest[]>([])
  const [requesters, setRequesters] = useState<Map<string, Requester>>(new Map())
  const [items, setItems] = useState<RequestItem[]>([])
  const [statuses, setStatuses] = useState<RequestStatus[]>([])
  const [staffMembers, setStaffMembers] = useState<StaffProfile[]>([])
  const [queueLoading, setQueueLoading] = useState(false)
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterWorkType, setFilterWorkType] = useState('all')
  const [busyRequest, setBusyRequest] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const canViewOverview = staff.role === 'admin' || staff.role === 'viewer'
  const isAdmin = staff.role === 'admin'

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
    if (!isAdmin || view !== 'requests' || !supabase) return
    let alive = true
    setQueueLoading(true)
    setError('')
    void (async () => {
      try {
        const [requestRows, itemRows, statusResult, staffResult] = await Promise.all([
          fetchRequests(),
          fetchRequestItems(),
          supabase.schema('crdc').from('request_statuses').select('status_id, code, name_ar, sort_order').order('sort_order'),
          supabase.schema('crdc').from('staff_users').select('staff_id, full_name, role, is_active').order('full_name'),
        ])
        if (statusResult.error) throw statusResult.error
        if (staffResult.error) throw staffResult.error
        const researcherIds = [...new Set(requestRows.map((request) => request.researcher_id))]
        const researcherRows: Requester[] = []
        for (let offset = 0; offset < researcherIds.length; offset += 100) {
          const { data, error: researcherError } = await supabase.schema('crdc').from('researchers')
            .select('researcher_id, full_name, email, applicant_type')
            .in('researcher_id', researcherIds.slice(offset, offset + 100))
          if (researcherError) throw researcherError
          researcherRows.push(...(data ?? []) as Requester[])
        }
        if (!alive) return
        setRequests(requestRows)
        setItems(itemRows)
        setStatuses((statusResult.data ?? []) as RequestStatus[])
        setStaffMembers((staffResult.data ?? []) as StaffProfile[])
        setRequesters(new Map(researcherRows.map((researcher) => [researcher.researcher_id, researcher])))
      } catch {
        if (alive) setError('حصلت مشكلة وإحنا بنحمّل الطلبات. راجع الاتصال أو صلاحيات الحساب وحاول تاني.')
      } finally {
        if (alive) setQueueLoading(false)
      }
    })()
    return () => { alive = false }
  }, [isAdmin, view])

  const countFor = (metric: string, category: string) =>
    Number(rows.find((row) => row.metric === metric && row.category === category)?.request_count ?? 0)
  const total = countFor('total', 'all')
  const egyptian = countFor('applicant_type', 'egyptian')
  const foreign = countFor('applicant_type', 'foreign')
  const summaryStatuses = rows.filter((row) => row.metric === 'status')
  const statusById = useMemo(() => new Map(statuses.map((status) => [status.status_id, status])), [statuses])
  const assignableStaff = staffMembers.filter((member) => member.is_active && (member.role === 'reviewer' || member.role === 'statistician'))

  const getRequestStatus = (requestId: number) => {
    const requestItems = items.filter((item) => item.request_id === requestId)
    const codes = [...new Set(requestItems.map((item) => statusById.get(item.status_id)?.code).filter(Boolean))] as string[]
    if (!codes.length) return { code: 'NO_ITEMS', label: 'بدون بنود' }
    if (codes.length > 1) return { code: 'MIXED', label: 'مراحل مختلفة' }
    return { code: codes[0], label: statusById.get(requestItems[0].status_id)?.name_ar ?? 'غير محدد' }
  }

  const visibleRequests = requests.filter((request) => {
    if (filterWorkType !== 'all' && request.work_type !== filterWorkType) return false
    return filterStatus === 'all' || getRequestStatus(request.request_id).code === filterStatus
  })

  async function assignRequest(request: QueueRequest, staffId: string) {
    if (!supabase || !staffId) return
    setBusyRequest(request.request_id)
    setError('')
    setNotice('')
    try {
      const requestItems = items.filter((item) => item.request_id === request.request_id)
      if (!requestItems.length) throw new Error('الطلب ده مفيهوش بنود ينفع تتعيّن.')
      const selectedStaff = assignableStaff.find((member) => member.staff_id === staffId)
      if (!selectedStaff) throw new Error('اختار مراجع أو إحصائي نشط من القائمة.')
      const { data, error: updateError } = await supabase.schema('crdc').from('request_items')
        .update({ assigned_staff_id: staffId })
        .eq('request_id', request.request_id)
        .select('item_id')
      if (updateError) throw updateError
      if ((data ?? []).length !== requestItems.length) throw new Error('ماقدرناش نأكد تعيين كل بنود الطلب. حدّث القائمة وراجع الطلب.')
      setItems((current) => current.map((item) => item.request_id === request.request_id ? { ...item, assigned_staff_id: staffId } : item))
      setNotice(`اتعيّن ${roleNames[selectedStaff.role]} ${selectedStaff.full_name} على كل بنود الطلب رقم ${request.request_id}.`)
    } catch (assignmentError) {
      const detail = assignmentError instanceof Error ? assignmentError.message : ''
      setError(detail && !detail.includes('permission denied') ? detail : 'التعيين مرفوض. اتأكد إن الحساب أدمن والموظف مراجع أو إحصائي نشط.')
    } finally {
      setBusyRequest(null)
    }
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
        {isAdmin && <button className={view === 'requests' ? 'active' : ''} aria-current={view === 'requests' ? 'page' : undefined} onClick={() => { setView('requests'); setError(''); setNotice('') }}>إدارة الطلبات والتعيينات</button>}
      </nav>

      <section className="portal-content" id="staff-home">
        {!canViewOverview && !isAdmin ? (
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
        ) : (
          <>
            <div className="portal-heading"><span className="eyebrow">إدارة المركز</span><h1>إدارة الطلبات والتعيينات</h1><p>راجع الطلبات وبنودها وعيّن مراجع أو إحصائي نشط لكل طلب.</p></div>
            {notice && <p className="message success" role="status">{notice}</p>}
            {error && <p className="message error" role="alert">{error}</p>}
            <div className="queue-filters portal-card">
              <label>الحالة<select aria-label="فلترة بالحالة" value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)}><option value="all">كل الحالات</option>{statuses.map((status) => <option key={status.code} value={status.code}>{status.name_ar}</option>)}<option value="MIXED">مراحل مختلفة</option><option value="NO_ITEMS">بدون بنود</option></select></label>
              <label>نوع العمل<select aria-label="فلترة بنوع العمل" value={filterWorkType} onChange={(event) => setFilterWorkType(event.target.value)}><option value="all">كل أنواع العمل</option><option value="thesis">رسالة علمية</option><option value="paper">بحث للنشر</option></select></label>
              <span className="queue-result-count">النتائج: {visibleRequests.length.toLocaleString('ar-EG')}</span>
            </div>
            {queueLoading ? <div className="portal-card loading"><span className="spinner" /> بنحمّل الطلبات...</div> : error && !requests.length ? null : visibleRequests.length ? (
              <div className="request-list admin-request-list">
                {visibleRequests.map((request) => {
                  const requestItems = items.filter((item) => item.request_id === request.request_id)
                  const assignedIds = [...new Set(requestItems.map((item) => item.assigned_staff_id).filter(Boolean))] as string[]
                  const selectedStaffId = assignedIds.length === 1 && requestItems.every((item) => item.assigned_staff_id === assignedIds[0]) ? assignedIds[0] : ''
                  const assignedNames = assignedIds.map((id) => staffMembers.find((member) => member.staff_id === id)?.full_name ?? 'موظف غير متاح')
                  const requester = requesters.get(request.researcher_id)
                  const overall = getRequestStatus(request.request_id)
                  return (
                    <article className="portal-card admin-request-card" data-testid="admin-request-row" data-request-id={request.request_id} key={request.request_id}>
                      <div className="admin-request-heading"><div><span className="request-type">{request.work_type === 'thesis' ? 'رسالة علمية' : 'بحث للنشر'}</span><h2>{request.work_title}</h2></div><span className="request-card-status">{overall.label}</span></div>
                      <dl className="admin-request-facts">
                        <dt>رقم الطلب</dt><dd>#{request.request_id}</dd>
                        <dt>الباحث</dt><dd>{requester?.full_name ?? 'بيانات الباحث غير متاحة'} <small>{requester?.email ?? ''}</small></dd>
                        <dt>نوع الباحث</dt><dd>{request.applicant_type === 'egyptian' ? 'مصري' : 'وافد'}</dd>
                        <dt>تاريخ التقديم</dt><dd>{formatDate(request.created_at)}</dd>
                        <dt>عدد البنود</dt><dd>{requestItems.length.toLocaleString('ar-EG')}</dd>
                        <dt>المعيّنون حاليًا</dt><dd className="assigned-staff-names">{assignedNames.length ? assignedNames.join('، ') : 'لسه مفيش تعيين'}</dd>
                      </dl>
                      <div className="admin-request-assignment">
                        <label>تعيين المراجع أو الإحصائي<select aria-label="تعيين المراجع أو الإحصائي" value={selectedStaffId} disabled={busyRequest === request.request_id || !requestItems.length} onChange={(event) => void assignRequest(request, event.target.value)}>
                          <option value="">اختار موظف نشط</option>{assignableStaff.map((member) => <option value={member.staff_id} key={member.staff_id}>{member.full_name} · {roleNames[member.role]}</option>)}
                        </select></label>
                        {busyRequest === request.request_id && <span className="assignment-saving">بنحفظ التعيين...</span>}
                      </div>
                    </article>
                  )
                })}
              </div>
            ) : <div className="portal-card empty-requests"><h2>مفيش طلبات مطابقة</h2><p>غيّر الفلاتر علشان تعرض طلبات تانية.</p></div>}
          </>
        )}
      </section>
      <footer className="page-footer"><span>CRDC</span><span>مركز الاستشارات والبحوث والتطوير</span><span>لوحة الموظفين</span></footer>
    </main>
  )
}

