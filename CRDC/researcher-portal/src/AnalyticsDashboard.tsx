import { useEffect, useId, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from './supabase'
import { UiError, friendlyErrorText, type LocalizedText } from './errors'
import { useI18n, translateDbText } from './i18n'

type Days = number | null
type Kpis = {
  total_requests: number; total_items: number; active_items: number; completed_items: number
  avg_turnaround_days: number | null; verified_revenue_egp: number; verified_revenue_usd: number
}
type ServiceRow = { service_code: string; service_name_ar: string; item_count: number; revenue_egp: number; revenue_usd: number }
type StatusRow = { status_code: string; status_name_ar: string; item_count: number }
type TrendRow = { month: string; request_count: number; revenue_egp: number; revenue_usd: number }
type Dashboard = {
  kpis: Kpis; by_service: ServiceRow[]; by_status: StatusRow[]; monthly_trend: TrendRow[]
  applicant_mix: { egyptian_requests: number; foreign_requests: number }
}

const getRanges = (isEn: boolean): { label: string; value: Days }[] => [
  { label: isEn ? 'All' : 'الكل', value: null },
  { label: isEn ? 'Last 30 Days' : 'آخر 30 يوم', value: 30 },
  { label: isEn ? 'Last 90 Days' : 'آخر 90 يوم', value: 90 },
  { label: isEn ? 'Last Year' : 'آخر سنة', value: 365 },
]

const getLocale = () => (document.documentElement.lang === 'en' ? 'en-US' : 'ar-EG')
const num = { format: (v: number) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 2 }).format(v) }
const compact = { format: (v: number) => new Intl.NumberFormat(getLocale(), { notation: 'compact', maximumFractionDigits: 1 }).format(v) }
const n = (value: unknown) => { const x = Number(value); return Number.isFinite(x) ? x : 0 }
const list = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : [])

function normalize(raw: unknown): Dashboard {
  if (!raw || typeof raw !== 'object') throw new UiError('مش قادرين نقرأ بيانات المؤشرات. جرّب تاني بعد شوية.', 'Unable to parse analytics data. Please try again shortly.')
  const d = raw as Record<string, unknown>
  const k = (d.kpis ?? {}) as Record<string, unknown>
  const mix = (d.applicant_mix ?? {}) as Record<string, unknown>
  return {
    kpis: {
      total_requests: n(k.total_requests), total_items: n(k.total_items), active_items: n(k.active_items),
      completed_items: n(k.completed_items), avg_turnaround_days: k.avg_turnaround_days == null ? null : n(k.avg_turnaround_days),
      verified_revenue_egp: n(k.verified_revenue_egp), verified_revenue_usd: n(k.verified_revenue_usd),
    },
    by_service: list<ServiceRow>(d.by_service).map((r) => ({ ...r, item_count: n(r.item_count), revenue_egp: n(r.revenue_egp), revenue_usd: n(r.revenue_usd) })),
    by_status: list<StatusRow>(d.by_status).map((r) => ({ ...r, item_count: n(r.item_count) })),
    monthly_trend: list<TrendRow>(d.monthly_trend).map((r) => ({ ...r, request_count: n(r.request_count), revenue_egp: n(r.revenue_egp), revenue_usd: n(r.revenue_usd) })),
    applicant_mix: { egyptian_requests: n(mix.egyptian_requests), foreign_requests: n(mix.foreign_requests) },
  }
}

const Money = ({ value, currency }: { value: number; currency: 'EGP' | 'USD' }) => <span dir="ltr">{num.format(value)} {currency}</span>

function monthParts(month: string) {
  const [year, mon] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, (mon || 1) - 1, 1))
  return {
    short: new Intl.DateTimeFormat(getLocale(), { month: 'short', timeZone: 'UTC' }).format(date),
    year: new Intl.DateTimeFormat(getLocale(), { year: 'numeric', timeZone: 'UTC' }).format(date),
    isJanuary: (mon || 1) === 1,
    full: new Intl.DateTimeFormat(getLocale(), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date),
  }
}

type BarItem = { key: string; name: string; value: number; extra?: ReactNode }

function BarList({ rows, label, tone = 'main' }: { rows: BarItem[]; label: string; tone?: 'main' | 'alt' }) {
  const max = Math.max(1, ...rows.map((row) => row.value))
  return (
    <ul className="analytics-bars" aria-label={label}>
      {rows.map((row) => {
        const width = row.value > 0 ? Math.max(1.5, (row.value / max) * 100) : 0
        const text = `${row.name}: ${num.format(row.value)}`
        return (
          <li className="analytics-bar-row" key={row.key}>
            <span className="analytics-bar-name">{row.name}</span>
            <svg className="analytics-bar-svg" viewBox="0 0 100 12" preserveAspectRatio="none" role="img" aria-label={text}>
              <title>{text}</title>
              <rect className="track" x="0" y="0" width="100" height="12" rx="2" />
              <rect className={`fill ${tone === 'alt' ? 'alt' : ''}`} x={100 - width} y="0" width={width} height="12" rx="2" />
            </svg>
            <strong dir="ltr">{num.format(row.value)}</strong>
            {row.extra}
          </li>
        )
      })}
    </ul>
  )
}

function MixChart({ egyptian, foreign }: { egyptian: number; foreign: number }) {
  const total = egyptian + foreign
  const isEn = document.documentElement.lang === 'en'
  if (!total) return <p className="card-description">{isEn ? 'No requests in the selected period.' : 'لا توجد طلبات في الفترة المختارة.'}</p>
  const ePct = (egyptian / total) * 100
  const label = isEn ? `Egyptian: ${num.format(egyptian)} requests, International: ${num.format(foreign)} requests` : `مصريون ${num.format(egyptian)} طلب، ووافدون ${num.format(foreign)} طلب`
  return (
    <div className="analytics-mix">
      <svg className="analytics-mix-svg" viewBox="0 0 100 14" preserveAspectRatio="none" role="img" aria-label={label}>
        <title>{label}</title>
        <rect className="fill" x={100 - ePct} y="0" width={ePct} height="14" />
        <rect className="fill alt" x="0" y="0" width={100 - ePct} height="14" />
      </svg>
      <ul className="analytics-mix-legend">
        <li><span className="analytics-swatch" />{isEn ? 'Egyptian ' : 'مصريون '} <strong dir="ltr">{num.format(egyptian)} ({num.format(Math.round(ePct))}%)</strong></li>
        <li><span className="analytics-swatch alt" />{isEn ? 'International ' : 'وافدون '} <strong dir="ltr">{num.format(foreign)} ({num.format(Math.round(100 - ePct))}%)</strong></li>
      </ul>
    </div>
  )
}

function TrendChart({ title, rows, pick, kind, format, color }: {
  title: string; rows: TrendRow[]; pick: (row: TrendRow) => number; kind: 'count' | 'money'; format: (v: number) => string; color: string
}) {
  const id = useId()
  const W = 640, H = 214, padL = 62, padR = 10, padT = 14, padB = 42
  const plotW = W - padL - padR, plotH = H - padT - padB
  const step = plotW / Math.max(rows.length, 1)
  const values = rows.map(pick)
  const max = Math.max(0, ...values)
  const top = max > 0 ? (kind === 'count' ? Math.max(2, Math.ceil(max / 2) * 2) : max) : 1
  const x = (i: number) => padL + (i + 0.5) * step
  const y = (v: number) => padT + plotH - (v / top) * plotH
  const bw = step * 0.58
  const parts = rows.map((row) => monthParts(row.month))
  const summary = rows.map((_, i) => `${parts[i].full}: ${format(values[i])}`).join('، ')
  const ticks = [0, top / 2, top]
  return (
    <figure className="analytics-trend">
      <figcaption className="analytics-trend-title">{title}</figcaption>
      <div className="analytics-chart-scroll" dir="ltr">
      <svg className="analytics-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${id}-t ${id}-d`}>
        <title id={`${id}-t`}>{title}</title>
        <desc id={`${id}-d`}>{summary}</desc>
        {ticks.map((tick) => (
          <g key={tick}>
            <line className="grid" x1={padL} x2={W - padR} y1={y(tick)} y2={y(tick)} />
            <text x={padL - 8} y={y(tick) + 4} textAnchor="end" direction="ltr">{kind === 'count' ? num.format(tick) : compact.format(tick)}</text>
          </g>
        ))}
        {kind === 'count'
          ? rows.map((row, i) => (
            <rect key={row.month} className="bar" style={{ fill: color }} x={x(i) - bw / 2} y={y(values[i])} width={bw} height={padT + plotH - y(values[i])} rx="2">
              <title>{`${parts[i].full}: ${format(values[i])}`}</title>
            </rect>
          ))
          : (
            <>
              <polyline className="line" style={{ stroke: color }} points={rows.map((_, i) => `${x(i)},${y(values[i])}`).join(' ')} />
              {rows.map((row, i) => (
                <circle key={row.month} className="dot" style={{ fill: color }} cx={x(i)} cy={y(values[i])} r="3.5">
                  <title>{`${parts[i].full}: ${format(values[i])}`}</title>
                </circle>
              ))}
            </>
          )}
        {rows.map((row, i) => (
          <text key={row.month} x={x(i)} y={H - 22} textAnchor="middle">
            {parts[i].short}
            {(i === 0 || parts[i].isJanuary) && <tspan x={x(i)} dy="14">{parts[i].year}</tspan>}
          </text>
        ))}
      </svg>
      </div>
    </figure>
  )
}

export default function AnalyticsDashboard() {
  const { lang, isEn } = useI18n()
  const [days, setDays] = useState<Days>(null)
  const [data, setData] = useState<Dashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<LocalizedText | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        if (!supabase) throw new UiError('الخدمة غير متاحة دلوقتي. جرّب تاني بعد شوية.', 'Service is currently unavailable. Please try again shortly.')
        const { data: raw, error: rpcError } = await supabase.schema('crdc').rpc('get_analytics_dashboard', { p_days: days })
        if (rpcError) throw rpcError
        const parsed = normalize(raw)
        if (alive) setData(parsed)
      } catch (loadError) {
        if (alive) { setData(null); setError(friendlyErrorText(loadError)) }
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [days, reload])

  const k = data?.kpis
  const cards: { label: string; value: ReactNode; note: string }[] = k ? [
    { label: isEn ? 'Total Requests' : 'إجمالي الطلبات', value: <span dir="ltr">{num.format(k.total_requests)}</span>, note: isEn ? 'Within selected period' : 'ضمن الفترة المختارة' },
    { label: isEn ? 'Total Service Items' : 'إجمالي البنود', value: <span dir="ltr">{num.format(k.total_items)}</span>, note: isEn ? 'Services inside requests' : 'خدمات داخل الطلبات' },
    { label: isEn ? 'Active Items' : 'البنود النشطة', value: <span dir="ltr">{num.format(k.active_items)}</span>, note: isEn ? 'Not completed yet' : 'لم تكتمل بعد' },
    { label: isEn ? 'Completed Items' : 'البنود المكتملة', value: <span dir="ltr">{num.format(k.completed_items)}</span>, note: isEn ? 'Completed or delivered' : 'مكتملة أو تم تسليمها' },
    { label: isEn ? 'Avg. Turnaround' : 'متوسط مدة الإنجاز', value: k.avg_turnaround_days == null ? <span>—</span> : <><span dir="ltr">{num.format(k.avg_turnaround_days)}</span><span className="analytics-kpi-unit">{isEn ? 'days' : 'يوم'}</span></>, note: isEn ? 'From submission to completion' : 'من التقديم حتى الاكتمال' },
    { label: isEn ? 'Verified Revenue (EGP)' : 'الإيراد الموثّق (جنيه)', value: <Money value={k.verified_revenue_egp} currency="EGP" />, note: isEn ? 'Receipts verified by treasury' : 'إيصالات اعتمدتها الخزينة' },
    { label: isEn ? 'Verified Revenue (USD)' : 'الإيراد الموثّق (دولار)', value: <Money value={k.verified_revenue_usd} currency="USD" />, note: isEn ? 'Receipts verified by treasury' : 'إيصالات اعتمدتها الخزينة' },
  ] : []

  return (
    <>
      <div className="portal-heading"><span className="eyebrow">{isEn ? 'Staff Dashboard' : 'لوحة الموظفين'}</span><h1>{isEn ? 'Analytics & KPIs' : 'الإحصائيات والمؤشرات'}</h1><p>{isEn ? 'Aggregated figures for requests and revenue, without exposing researcher personal details.' : 'أرقام مجمعة عن الطلبات والإيرادات، من غير عرض بيانات الباحثين أو تفاصيل طلباتهم.'}</p></div>
      <div className="analytics-toolbar">
        <div className="analytics-range" role="group" aria-label={isEn ? 'Time Period' : 'الفترة الزمنية'}>
          {getRanges(isEn).map((range) => (
            <button key={range.label} type="button" aria-pressed={days === range.value} onClick={() => setDays(range.value)}>{range.label}</button>
          ))}
        </div>
        {loading && data && <span className="analytics-updating" role="status"><span className="spinner" /> {isEn ? 'Updating figures...' : 'بنحدّث الأرقام...'}</span>}
      </div>

      {error ? (
        <div className="portal-card analytics-error"><p className="message error" role="alert">{error[lang]}</p><button type="button" className="quiet-button" onClick={() => setReload((v) => v + 1)}>{isEn ? 'Retry' : 'إعادة المحاولة'}</button></div>
      ) : !data ? (
        <div className="portal-card loading"><span className="spinner" /> {isEn ? 'Loading KPIs...' : 'بنحمّل المؤشرات...'}</div>
      ) : (
        <div className={loading ? 'analytics-body is-loading' : 'analytics-body'} aria-busy={loading}>
          <div className="analytics-kpis">
            {cards.map((card) => (
              <article className="portal-card staff-stat-card" key={card.label}><span>{card.label}</span><strong>{card.value}</strong><small>{card.note}</small></article>
            ))}
          </div>

          <div className="analytics-grid">
            <section className="portal-card wide" aria-labelledby="an-service">
              <div className="staff-section-heading"><div><span className="eyebrow">{isEn ? 'By Service' : 'حسب الخدمة'}</span><h2 id="an-service">{isEn ? 'Items & Verified Revenue per Service' : 'البنود والإيراد الموثّق لكل خدمة'}</h2></div></div>
              <BarList
                label={isEn ? 'Items count per service' : 'عدد البنود لكل خدمة'}
                rows={data.by_service.map((s) => ({
                  key: s.service_code, name: translateDbText(s.service_name_ar, isEn), value: s.item_count,
                  extra: <small className="analytics-bar-extra">{isEn ? 'Verified revenue: ' : 'إيراد موثّق: '}<Money value={s.revenue_egp} currency="EGP" /> · <Money value={s.revenue_usd} currency="USD" /></small>,
                }))}
              />
            </section>

            <section className="portal-card" aria-labelledby="an-status">
              <div className="staff-section-heading"><div><span className="eyebrow">{isEn ? 'Workflow Stages' : 'مراحل العمل'}</span><h2 id="an-status">{isEn ? 'Items by Status' : 'البنود حسب الحالة'}</h2></div></div>
              <BarList label={isEn ? 'Items count per status' : 'عدد البنود لكل حالة'} rows={data.by_status.map((s) => ({ key: s.status_code, name: translateDbText(s.status_name_ar, isEn), value: s.item_count }))} />
            </section>

            <section className="portal-card" aria-labelledby="an-mix">
              <div className="staff-section-heading"><div><span className="eyebrow">{isEn ? 'Applicant Type' : 'نوع الباحث'}</span><h2 id="an-mix">{isEn ? 'Egyptian vs. International' : 'مصريون ووافدون'}</h2></div></div>
              <MixChart egyptian={data.applicant_mix.egyptian_requests} foreign={data.applicant_mix.foreign_requests} />
            </section>

            <section className="portal-card wide" aria-labelledby="an-trend">
              <div className="staff-section-heading"><div><span className="eyebrow">{isEn ? 'Last 12 Months' : 'آخر 12 شهرًا'}</span><h2 id="an-trend">{isEn ? 'Monthly Trend' : 'الاتجاه الشهري'}</h2></div></div>
              <p className="card-description">{isEn ? 'Range is fixed to the last 12 months regardless of the selected filter. Months are ordered chronologically from oldest (left) to newest (right).' : 'المدى ثابت على آخر 12 شهرًا بغض النظر عن الفترة المختارة. الأشهر مرتبة زمنيًا من الأقدم (يسار) إلى الأحدث (يمين).'}</p>
              <div className="analytics-trend-stack">
                <TrendChart title={isEn ? 'Monthly Requests' : 'عدد الطلبات شهريًا'} rows={data.monthly_trend} pick={(r) => r.request_count} kind="count" format={(v) => num.format(v)} color="#185b48" />
                <TrendChart title={isEn ? 'Monthly Verified Revenue (EGP)' : 'الإيراد الموثّق شهريًا (جنيه)'} rows={data.monthly_trend} pick={(r) => r.revenue_egp} kind="money" format={(v) => `${num.format(v)} EGP`} color="#d88b55" />
                <TrendChart title={isEn ? 'Monthly Verified Revenue (USD)' : 'الإيراد الموثّق شهريًا (دولار)'} rows={data.monthly_trend} pick={(r) => r.revenue_usd} kind="money" format={(v) => `${num.format(v)} USD`} color="#4f7f9a" />
              </div>
              <details className="analytics-details">
                <summary>{isEn ? 'View figures in table' : 'عرض الأرقام في جدول'}</summary>
                <div className="analytics-table-wrap">
                  <table className="analytics-table">
                    <thead><tr><th scope="col">{isEn ? 'Month' : 'الشهر'}</th><th scope="col">{isEn ? 'Requests' : 'الطلبات'}</th><th scope="col">{isEn ? 'Revenue (EGP)' : 'إيراد (جنيه)'}</th><th scope="col">{isEn ? 'Revenue (USD)' : 'إيراد (دولار)'}</th></tr></thead>
                    <tbody>
                      {data.monthly_trend.map((r) => (
                        <tr key={r.month}><th scope="row">{monthParts(r.month).full}</th><td dir="ltr">{num.format(r.request_count)}</td><td><Money value={r.revenue_egp} currency="EGP" /></td><td><Money value={r.revenue_usd} currency="USD" /></td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </section>
          </div>
        </div>
      )}
    </>
  )
}
