import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { pickName, type Lang } from './i18n'

type Hit = { request_id: number; researcher_id: string; work_type: 'thesis' | 'paper'; work_title: string; researcher_name: string; researcher_email: string }
type DetailItem = { item_id: number; service_ar: string; service_en?: string | null; status_ar: string; status_en?: string | null; staff_name?: string | null; amount_due?: number | string | null; currency?: string | null; journal_ar?: string; journal_en?: string | null; issue_label?: string; decision?: string }

export default function AdminSearchSidebar({ lang, isEn }: { lang: Lang; isEn: boolean }) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<Hit | null>(null)
  const [items, setItems] = useState<DetailItem[]>([])
  const [loadingModal, setLoadingModal] = useState(false)

  useEffect(() => {
    const q = query.trim().replace(/[%_]/g, '')
    if (q.length < 2 || !supabase) { setHits([]); return }
    let alive = true
    setBusy(true)
    const t = setTimeout(async () => {
      try {
        const [{ data: byTitle }, { data: byName }] = await Promise.all([
          supabase!.schema('crdc').from('service_requests').select('request_id, researcher_id, work_type, work_title').ilike('work_title', `%${q}%`).limit(10),
          supabase!.schema('crdc').from('researchers').select('researcher_id, full_name, email').ilike('full_name', `%${q}%`).limit(10),
        ])
        const resMap = new Map((byName ?? []).map((r) => [r.researcher_id, r]))
        const { data: byResReqs } = resMap.size
          ? await supabase!.schema('crdc').from('service_requests').select('request_id, researcher_id, work_type, work_title').in('researcher_id', [...resMap.keys()]).limit(10)
          : { data: [] }
        const merged = new Map([...(byTitle ?? []), ...(byResReqs ?? [])].map((r) => [r.request_id, r]))
        const missing = [...new Set([...merged.values()].map((r) => r.researcher_id).filter((id) => !resMap.has(id)))]
        if (missing.length) {
          const { data: extra } = await supabase!.schema('crdc').from('researchers').select('researcher_id, full_name, email').in('researcher_id', missing)
          for (const r of extra ?? []) resMap.set(r.researcher_id, r)
        }
        if (alive) setHits([...merged.values()].map((r) => ({
          request_id: r.request_id, researcher_id: r.researcher_id, work_type: r.work_type, work_title: r.work_title,
          researcher_name: resMap.get(r.researcher_id)?.full_name ?? '', researcher_email: resMap.get(r.researcher_id)?.email ?? '',
        })))
      } finally { if (alive) setBusy(false) }
    }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [query])

  async function openDetails(h: Hit) {
    setSelected(h); setHits([]); setLoadingModal(true)
    try {
      const [itRes, srvRes, stRes, stfRes, jrnRes, issRes] = await Promise.all([
        supabase!.schema('crdc').from('request_items').select('item_id, service_id, status_id, assigned_staff_id, amount_due, currency').eq('request_id', h.request_id).order('item_id'),
        supabase!.schema('crdc').from('services').select('service_id, name_ar, name_en'),
        supabase!.schema('crdc').from('request_statuses').select('status_id, name_ar, name_en'),
        supabase!.schema('crdc').from('staff_users').select('staff_id, full_name, full_name_en'),
        supabase!.schema('crdc').from('journals').select('journal_id, name_ar, name_en'),
        supabase!.schema('crdc').from('journal_issues').select('issue_id, issue_year, issue_month'),
      ])
      const ids = (itRes.data ?? []).map((i) => i.item_id)
      const { data: pubs } = ids.length ? await supabase!.schema('crdc').from('publication_submissions').select('item_id, journal_id, issue_id, decision').in('item_id', ids) : { data: [] }
      const srvs = new Map((srvRes.data ?? []).map((s) => [s.service_id, s])); const sts = new Map((stRes.data ?? []).map((s) => [s.status_id, s])); const stfs = new Map((stfRes.data ?? []).map((s) => [s.staff_id, s]))
      const jrns = new Map((jrnRes.data ?? []).map((j) => [j.journal_id, j])); const isss = new Map((issRes.data ?? []).map((is) => [is.issue_id, is])); const pubMap = new Map((pubs ?? []).map((p) => [p.item_id, p]))
      setItems((itRes.data ?? []).map((i) => {
        const p = pubMap.get(i.item_id); const j = p ? jrns.get(p.journal_id) : null; const is = p?.issue_id ? isss.get(p.issue_id) : null
        return {
          item_id: i.item_id, amount_due: i.amount_due, currency: i.currency,
          service_ar: srvs.get(i.service_id)?.name_ar ?? '', service_en: srvs.get(i.service_id)?.name_en,
          status_ar: sts.get(i.status_id)?.name_ar ?? '', status_en: sts.get(i.status_id)?.name_en,
          staff_name: i.assigned_staff_id ? (isEn ? stfs.get(i.assigned_staff_id)?.full_name_en || stfs.get(i.assigned_staff_id)?.full_name : stfs.get(i.assigned_staff_id)?.full_name) : null,
          journal_ar: j?.name_ar, journal_en: j?.name_en, issue_label: is ? `${is.issue_year}/${is.issue_month}` : undefined, decision: p?.decision,
        }
      }))
    } finally { setLoadingModal(false) }
  }

  return (
    <aside className="admin-search-sidebar">
      <input id="admin-global-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={isEn ? 'Researcher, paper, or thesis...' : 'اسم الباحث أو البحث أو الرسالة...'} />
      {busy && <small className="sidebar-status">{isEn ? 'Searching...' : 'جاري البحث...'}</small>}
      {!busy && query.trim().length >= 2 && !hits.length && !selected && <small className="sidebar-status">{isEn ? 'No results.' : 'لا توجد نتائج.'}</small>}
      {hits.length > 0 && (
        <ul className="sidebar-results-list">
          {hits.map((h) => (
            <li key={h.request_id}>
              <button type="button" className="sidebar-result-item" onClick={() => void openDetails(h)}>
                <small>{h.work_type === 'thesis' ? (isEn ? 'Thesis' : 'رسالة علمية') : (isEn ? 'Paper' : 'بحث')} · #{h.request_id}</small>
                <strong>{h.work_title}</strong>
                <span>{h.researcher_name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <div className="admin-search-modal-backdrop" onClick={() => setSelected(null)}>
          <div className="admin-search-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-head">
              <div><small>{selected.work_type === 'thesis' ? (isEn ? 'Thesis' : 'رسالة علمية') : (isEn ? 'Paper' : 'بحث')} · #{selected.request_id}</small><h3>{selected.work_title}</h3></div>
              <button type="button" onClick={() => setSelected(null)}>×</button>
            </div>
            <p className="admin-modal-researcher">{isEn ? 'Researcher:' : 'الباحث:'} <strong>{selected.researcher_name}</strong> {selected.researcher_email && <small dir="ltr">({selected.researcher_email})</small>}</p>
            {loadingModal ? <p className="sidebar-status">{isEn ? 'Loading...' : 'جاري التحميل...'}</p> : (
              <ul className="admin-modal-items">
                {items.map((it) => (
                  <li key={it.item_id}>
                    <div><strong>{pickName({ name_ar: it.service_ar, name_en: it.service_en }, lang)}</strong><span className="status-pill">{pickName({ name_ar: it.status_ar, name_en: it.status_en }, lang)}</span></div>
                    <small>{it.staff_name ? `${isEn ? "Assigned:" : "الموظف المسؤول:"} ${it.staff_name}` : (isEn ? "Unassigned" : "غير معيّن")}{it.amount_due != null && ` · ${it.amount_due} ${it.currency}`}</small>{it.journal_ar && <small style={{color:"var(--orange)",fontWeight:600}}>{isEn ? "Journal:" : "المجلة:"} {pickName({name_ar:it.journal_ar,name_en:it.journal_en},lang)}{it.issue_label && ` (${it.issue_label})`}{it.decision && ` — ${it.decision}`}</small>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </aside>
  )
}



