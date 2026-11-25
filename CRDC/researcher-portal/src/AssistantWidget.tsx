import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { supabase } from './supabase'
import { friendlyError } from './errors'
import { runAssistantLocalTools } from './assistantTools'
import type { QuickOption } from './assistantTools'
import MorshedAvatar from './MorshedAvatar'

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
  options?: QuickOption[]
  links?: { label: string; url: string }[]
}

const SUGGESTIONS = [
  'احسب رسوم نشر بحث 30 صفحة',
  'أنشر بحثي في أي مجلة؟',
  'المستندات المطلوبة للتقديم',
  'خطوات سداد الرسوم',
]

export default function AssistantWidget({ audience }: { audience: 'egyptian' | 'expat' | 'staff' | 'all' }) {
  const [open, setOpen] = useState(false)
  const [showGreeting, setShowGreeting] = useState(false)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: 'أهلاً بك! أنا «مرشد»، المساعد الذكي لمركز الاستشارات والبحوث والتطوير. اسألني عن الإجراءات، احسب رسوم النشر والتدقيق بعدد الصفحات، أو اسألني عن المجلة المناسبة لتخصصك.',
    },
  ])

  useEffect(() => {
    const t1 = window.setTimeout(() => { if (!open) setShowGreeting(true) }, 1000)
    const t2 = window.setTimeout(() => setShowGreeting(false), 8500)
    return () => { window.clearTimeout(t1); window.clearTimeout(t2) }
  }, [])

  function toggleOpen() {
    setShowGreeting(false)
    setOpen((v) => !v)
  }

  async function askQuestion(rawText: string) {
    const clean = rawText.trim()
    if (!clean || busy) return

    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', text: clean }])
    setQuery('')

    const localReply = runAssistantLocalTools(clean, audience)
    if (localReply) {
      setMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: 'assistant', text: localReply.text, options: localReply.options, links: localReply.links },
      ])
      return
    }

    if (!supabase) return
    setBusy(true)

    try {
      const { data, error } = await supabase
        .schema('crdc')
        .rpc('search_kb', { p_query: clean, p_audience: audience, p_limit: 3 })

      if (error) throw error
      const rows = (data ?? []) as KbResult[]

      const botMsg: ChatMessage = rows.length > 0
        ? { id: `a-${Date.now()}`, role: 'assistant', text: `وجدت ${rows.length === 1 ? 'معلومة مطابقة' : `${rows.length} معلومات مطابقة`} في الدليل الإجرائي:`, results: rows }
        : { id: `a-${Date.now()}`, role: 'assistant', text: 'لم أجد إجابة مطابقة بدقة في الدليل الإجرائي. جرّب إعادة صياغة سؤالك أو اسألني مثلاً: (رسوم نشر 30 صفحة، أو أنشر بحثي فين؟).' }

      setMessages((prev) => [...prev, botMsg])
    } catch (err) {
      setMessages((prev) => [...prev, { id: `e-${Date.now()}`, role: 'assistant', text: friendlyError(err) }])
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
      <AnimatePresence>
        {open && (
          <motion.section
            className="kb-assistant-panel"
            aria-label="مرشد - المساعد الذكي للدليل الإجرائي"
            style={{
              transformOrigin: '48px calc(100% + 42px)',
              borderTop: '2px solid #D4AF37',
              boxShadow: '0 22px 48px rgba(15, 23, 42, 0.35), 0 0 24px rgba(212, 175, 55, 0.22)',
            }}
            initial={{ opacity: 0, scale: 0.12, y: 36 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.12, y: 36 }}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
          >
            <header className="kb-assistant-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <MorshedAvatar size={42} compact />
                <div>
                  <strong>مرشد</strong>
                  <small>الدليل الإجرائي • الحاسبة • المجلات</small>
                </div>
              </div>
              <button type="button" className="kb-close-btn" onClick={() => setOpen(false)} aria-label="إغلاق مرشد">
                ×
              </button>
            </header>

            <div className="kb-assistant-body">
              {messages.map((m) => (
                <motion.div
                  key={m.id}
                  className={`kb-msg kb-msg-${m.role}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22 }}
                >
                  {m.role === 'assistant' ? (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                      <MorshedAvatar size={28} compact />
                      <p style={{ whiteSpace: 'pre-line', margin: 0 }}>{m.text}</p>
                    </div>
                  ) : (
                    <p style={{ whiteSpace: 'pre-line', margin: 0 }}>{m.text}</p>
                  )}

                  {m.options && m.options.length > 0 && (
                    <div className="kb-suggestions" style={{ padding: '8px 0 2px', borderTop: 'none' }}>
                      {m.options.map((opt) => (
                        <button key={opt.value} type="button" disabled={busy} onClick={() => void askQuestion(opt.value)}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {m.links && m.links.length > 0 && (
                    <div className="kb-suggestions" style={{ padding: '8px 0 2px', borderTop: 'none' }}>
                      {m.links.map((lnk) => (
                        <a
                          key={lnk.url}
                          href={lnk.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="kb-source-badge"
                          style={{ textDecoration: 'none', padding: '6px 10px', display: 'inline-block' }}
                        >
                          {lnk.label} ↗
                        </a>
                      ))}
                    </div>
                  )}

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
                </motion.div>
              ))}
              {busy && <div className="kb-msg kb-msg-assistant"><p>جاري البحث في الدليل الإجرائي...</p></div>}
            </div>

            <div className="kb-suggestions">
              {SUGGESTIONS.map((s) => (
                <motion.button key={s} type="button" disabled={busy} whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.96 }} onClick={() => void askQuestion(s)}>
                  {s}
                </motion.button>
              ))}
            </div>

            <form className="kb-assistant-form" onSubmit={handleSubmit}>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="اسأل مرشد عن الإجراءات أو الرسوم..."
                aria-label="سؤالك لمرشد"
                disabled={busy}
              />
              <button type="submit" disabled={busy || !query.trim()}>
                إرسال
              </button>
            </form>
          </motion.section>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showGreeting && !open && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.85 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.85 }}
            transition={{ type: 'spring', stiffness: 320, damping: 22 }}
            onClick={toggleOpen}
            role="status"
            style={{
              position: 'relative',
              background: '#0F172A',
              color: '#F8FAFC',
              border: '1.5px solid #D4AF37',
              borderRadius: '0.95rem',
              padding: '0.5rem 0.85rem',
              fontSize: '0.82rem',
              fontWeight: 600,
              boxShadow: '0 10px 24px rgba(0, 0, 0, 0.35), 0 0 14px rgba(212, 175, 55, 0.25)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              whiteSpace: 'nowrap',
            }}
          >
            <span>أهلاً بك! أنا مرشد، اضغط لفتح الكتاب 👋</span>
            <button
              type="button"
              aria-label="إغلاق الترحيب"
              onClick={(e) => { e.stopPropagation(); setShowGreeting(false) }}
              style={{ background: 'transparent', border: 'none', color: '#94A3B8', fontSize: '1rem', lineHeight: 1, cursor: 'pointer', padding: '0 0.15rem' }}
            >
              ×
            </button>
            <span
              aria-hidden="true"
              style={{
                position: 'absolute',
                bottom: '-6px',
                left: '42px',
                width: '10px',
                height: '10px',
