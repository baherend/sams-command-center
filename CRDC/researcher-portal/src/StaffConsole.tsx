import { useEffect, useState } from 'react'
import { supabase } from './supabase'

type StaffRole = 'admin' | 'reviewer' | 'statistician' | 'cashier' | 'viewer'
type StaffProfile = { staff_id: string; full_name: string; role: StaffRole; is_active: boolean }
type SummaryRow = { metric: string; category: string; label: string; request_count: number | string }

const roleNames: Record<StaffRole, string> = {
  admin: 'مدير النظام', reviewer: 'مراجع', statistician: 'إحصائي', cashier: 'أمين خزينة', viewer: 'مشاهد',
}

export default function StaffConsole({ staff, onSignOut }: { staff: StaffProfile; onSignOut: () => void }) {
  const [rows, setRows] = useState<SummaryRow[]>([])
  const [loading, setLoading] = useState(staff.role === 'admin' || staff.role === 'viewer')
  const [error, setError] = useState('')
  const canViewOverview = staff.role === 'admin' || staff.role === 'viewer'

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
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [canViewOverview])

  const countFor = (metric: string, category: string) =>
    Number(rows.find((row) => row.metric === metric && row.category === category)?.request_count ?? 0)
  const total = countFor('total', 'all')
  const egyptian = countFor('applicant_type', 'egyptian')
  const foreign = countFor('applicant_type', 'foreign')
  const statuses = rows.filter((row) => row.metric === 'status')

  return (
    <main className="page-shell researcher-shell staff-shell" dir="rtl">
      <header className="topbar">
        <a className="brand" href="#staff-home" aria-label="مركز الاستشارات والبحوث والتطوير">
          <span className="brand-mark">م</span>
          <span><strong>مركز الاستشارات</strong><small>والبحوث والتطوير · لوحة الموظفين</small></span>
        </a>
        <div className="staff-top-actions"><span className="staff-name">{staff.full_name}</span><span className="role-badge">{roleNames[staff.role]}</span><button className="quiet-button" onClick={onSignOut}>تسجيل الخروج</button></div>
      </header>

      {canViewOverview && <nav className="researcher-nav" aria-label="التنقل في لوحة الموظف">
        <button className="active" aria-current="page">نظرة عامة وإحصائيات</button>
      </nav>}

      <section className="portal-content" id="staff-home">
        <div className="portal-heading"><span className="eyebrow">لوحة الموظفين</span><h1>نظرة عامة وإحصائيات</h1><p>أرقام مجمعة عن الطلبات، من غير عرض بيانات الباحثين أو تفاصيل طلباتهم.</p></div>
        {!canViewOverview ? (
          <div className="portal-card staff-placeholder"><h2>أهلًا يا {staff.full_name}</h2><p>تم تسجيل دخولك بصلاحية {roleNames[staff.role]}. الشاشات الخاصة بالدور ده هتتضاف في خطوة لاحقة.</p></div>
        ) : loading ? (
          <div className="portal-card loading"><span className="spinner" /> بنحمّل الأرقام...</div>
        ) : error ? (
          <p className="message error" role="alert">{error}</p>
        ) : (
          <>
            <div className="staff-stat-grid">
              <article className="portal-card staff-stat-card"><span>إجمالي الطلبات</span><strong>{total.toLocaleString('ar-EG')}</strong><small>كل الطلبات المسجلة</small></article>
              <article className="portal-card staff-stat-card"><span>طلبات المصريين</span><strong>{egyptian.toLocaleString('ar-EG')}</strong><small>حسب نوع الباحث</small></article>
              <article className="portal-card staff-stat-card"><span>طلبات الوافدين</span><strong>{foreign.toLocaleString('ar-EG')}</strong><small>حسب نوع الباحث</small></article>
            </div>
            <section className="portal-card staff-status-card" aria-labelledby="status-heading">
              <div className="staff-section-heading"><div><span className="eyebrow">توزيع الطلبات</span><h2 id="status-heading">حسب الحالة</h2></div><span className="role-badge">عرض مجمّع</span></div>
              {statuses.length ? <ul className="staff-status-list">{statuses.map((row) => <li key={row.category}><span>{row.label}</span><strong>{Number(row.request_count).toLocaleString('ar-EG')}</strong></li>)}</ul> : <p className="empty-state">مفيش حالات طلبات للعرض حاليًا.</p>}
            </section>
          </>
        )}
      </section>
      <footer className="page-footer"><span>CRDC</span><span>مركز الاستشارات والبحوث والتطوير</span><span>لوحة الموظفين</span></footer>
    </main>
  )
}

