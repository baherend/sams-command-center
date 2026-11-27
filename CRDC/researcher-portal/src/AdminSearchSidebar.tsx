import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { type Lang } from './i18n'

type Hit = { request_id: number; work_type: 'thesis' | 'paper'; work_title: string; researcher_name: string }

export default function AdminSearchSidebar({ isEn }: { lang: Lang; isEn: boolean }) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const q = query.trim().replace(/[%_]/g, '')
    if (q.length < 2 || !supabase) { setHits([]); return }
    let alive = true
    setBusy(true)
    const t = setTimeout(async () => {
      try {
        const [{ data: byTitle }, { data: byName }] = await Promise.all([
          supabase!.schema('crdc').from('service_requests').select('request_id, researcher_id, work_type, work_title').ilike('work_title', `%${q}%`).limit(10),
          supabase!.schema('crdc').from('researchers').select('researcher_id, full_name').ilike('full_name', `%${q}%`).limit(10),
        ])
        const names = new Map((byName ?? []).map((r) => [r.researcher_id, r.full_name]))
        const { data: byResReqs } = names.size
          ? await supabase!.schema('crdc').from('service_requests').select('request_id, researcher_id, work_type, work_title').in('researcher_id', [...names.keys()]).limit(10)
          : { data: [] }
        const merged = new Map([...(byTitle ?? []), ...(byResReqs ?? [])].map((r) => [r.request_id, r]))
        const missing = [...new Set([...merged.values()].map((r) => r.researcher_id).filter((id) => !names.has(id)))]
        if (missing.length) {
          const { data: extra } = await supabase!.schema('crdc').from('researchers').select('researcher_id, full_name').in('researcher_id', missing)
          for (const r of extra ?? []) names.set(r.researcher_id, r.full_name)
        }
        if (alive) setHits([...merged.values()].map((r) => ({ request_id: r.request_id, work_type: r.work_type, work_title: r.work_title, researcher_name: names.get(r.researcher_id) ?? '' })))
      } finally { if (alive) setBusy(false) }
    }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [query])

  return (
    <aside className="admin-search-sidebar">
      <label className="sidebar-search-label" htmlFor="admin-global-search">{isEn ? 'Search Research & Researchers' : 'بحث في الأبحاث والباحثين'}</label>
      <input id="admin-global-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={isEn ? 'Researcher, paper, or thesis...' : 'اسم الباحث أو البحث أو الرسالة...'} />
      {busy && <small className="sidebar-status">{isEn ? 'Searching...' : 'جاري البحث...'}</small>}
      {!busy && query.trim().length >= 2 && !hits.length && <small className="sidebar-status">{isEn ? 'No results.' : 'لا توجد نتائج.'}</small>}
      <ul className="sidebar-results-list">
        {hits.map((h) => (
          <li key={h.request_id} className="sidebar-result-item">
            <small>{h.work_type === 'thesis' ? (isEn ? 'Thesis' : 'رسالة علمية') : (isEn ? 'Paper' : 'بحث')} · #{h.request_id}</small>
            <strong>{h.work_title}</strong>
            <span>{h.researcher_name}</span>
          </li>
        ))}
      </ul>
    </aside>
  )
}
