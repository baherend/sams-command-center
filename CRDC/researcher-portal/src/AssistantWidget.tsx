import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from './supabase'
import { friendlyError } from './errors'

type KbResult = {
  chunk_id: number
  source: string
  section: string
  content: string
  audience: string
  score: number
}

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  results?: KbResult[]
}

const SUGGESTIONS = [
  'الفرق بين الرسالة العلمية والبحث المختصر',
  'المستندات المطلوبة للتقديم',
  'خطوات سداد الرسوم',
  'شروط المراجعة اللغوية والإحصائية',
]

export default function AssistantWidget({ audience }: { audience: 'egyptian' | 'expat' | 'staff' | 'all' }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: 'أهلاً بك في المساعد الذكي لمركز الاستشارات والبحوث والتطوير. اسألني عن الإجراءات، المستندات المطلوبة، أو الرسوم وسأجيبك من الدليل الإجرائي.',
    },
  ])

  async function askQuestion(rawText: string) {
    const clean = rawText.trim()
    if (!clean || busy || !supabase) return

    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', text: clean }
    setMessages((prev) => [...prev, userMsg])
    setQuery('')
    setBusy(true)

    try {
      const { data, error } = await supabase
        .schema('crdc')
        .rpc('search_kb', {
          p_query: clean,
          p_audience: audience,
          p_limit: 3,
        })

      if (error) throw error
      const rows = (data ?? []) as KbResult[]

      const botMsg: ChatMessage = rows.length > 0
        ? {
            id: `a-${Date.now()}`,
            role: 'assistant',
            text: `وجدت ${rows.length === 1 ? 'معلومة مطابقة' : `${rows.length} معلومات مطابقة`} في الدليل الإجرائي:`,
            results: rows,
          }
        : {
            id: `a-${Date.now()}`,
            role: 'assistant',
            text: 'لم أجد إجابة مطابقة بدقة في الدليل الإجرائي. جرّب إعادة صياغة سؤالك بكلمات أوضح مثل: (الرسوم، التقديم، المستندات، المراجعة).',
          }

      setMessages((prev) => [...prev, botMsg])
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { id: `e-${Date.now()}`, role: 'assistant', text: friendlyError(err) },
      ])
    } finally {
      setBusy(false)
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    void askQuestion(query)
  }

  return (
    <div className="kb-assistant-root" dir="rtl">
      {open && (
        <section className="kb-assistant-panel" aria-label="المساعد الذكي للدليل الإجرائي">
          <header className="kb-assistant-header">
            <div>
              <strong>المساعد الذكي للمركز</strong>
              <small>الدليل الإجرائي المعتمد</small>
            </div>
            <button type="button" className="kb-close-btn" onClick={() => setOpen(false)} aria-label="إغلاق المساعد">
              ×
            </button>
          </header>

          <div className="kb-assistant-body">
            {messages.map((m) => (
              <div key={m.id} className={`kb-msg kb-msg-${m.role}`}>
                <p>{m.text}</p>
                {m.results && m.results.length > 0 && (
                  <div className="kb-results">
                    {m.results.map((r) => (
                      <article key={r.chunk_id} className="kb-result-card">
                        <div className="kb-result-meta">
                          <span className="kb-source-badge">{r.source}</span>
                          <strong>{r.section}</strong>
                        </div>
                        <p className="kb-result-content">{r.content}</p>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {busy && <div className="kb-msg kb-msg-assistant"><p>جاري البحث في الدليل الإجرائي...</p></div>}
          </div>

          <div className="kb-suggestions">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" disabled={busy} onClick={() => void askQuestion(s)}>
                {s}
              </button>
            ))}
          </div>

          <form className="kb-assistant-form" onSubmit={handleSubmit}>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="اكتب سؤالك هنا..."
              aria-label="سؤالك للمساعد الذكي"
              disabled={busy}
            />
            <button type="submit" disabled={busy || !query.trim()}>
              إرسال
            </button>
          </form>
        </section>
      )}

      <button
        type="button"
        className="kb-assistant-fab"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="فتح المساعد الذكي"
      >
        {open ? 'إغلاق المساعد' : '💬 اسأل المساعد الذكي'}
      </button>
    </div>
  )
}
