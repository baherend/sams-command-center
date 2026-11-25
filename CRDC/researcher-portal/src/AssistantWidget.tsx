import { useState } from 'react'
import type { FormEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { supabase } from './supabase'
import { friendlyError } from './errors'
import { runAssistantLocalTools } from './assistantTools'
import type { QuickOption } from './assistantTools'

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
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: 'أهلاً بك في المساعد الذكي لمركز الاستشارات والبحوث والتطوير. اسألني عن الإجراءات، احسب رسوم النشر والتدقيق بعدد الصفحات، أو اسألني عن المجلة المناسبة لتخصصك.',
    },
  ])

  async function askQuestion(rawText: string) {
    const clean = rawText.trim()
    if (!clean || busy) return

    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', text: clean }
    setMessages((prev) => [...prev, userMsg])
    setQuery('')

    // 1. فحص حاسبة الرسوم وتوجيه المجلات محلياً بدقة 100%
    const localReply = runAssistantLocalTools(clean, audience)
    if (localReply) {
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: localReply.text,
          options: localReply.options,
          links: localReply.links,
        },
      ])
      return
    }

    // 2. البحث في قاعدة البيانات للدليل الإجرائي
    if (!supabase) return
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
            text: 'لم أجد إجابة مطابقة بدقة في الدليل الإجرائي. جرّب إعادة صياغة سؤالك أو اسألني مثلاً: (رسوم نشر 30 صفحة، أو أنشر بحثي فين؟).',
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
      <AnimatePresence>
        {open && (
          <motion.section
            className="kb-assistant-panel"
            aria-label="المساعد الذكي للدليل الإجرائي"
            initial={{ opacity: 0, y: 24, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
          >
            <header className="kb-assistant-header">
              <div>
                <strong>المساعد الذكي للمركز</strong>
                <small>الدليل الإجرائي • الحاسبة • المجلات</small>
              </div>
              <button type="button" className="kb-close-btn" onClick={() => setOpen(false)} aria-label="إغلاق المساعد">
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
                  <p style={{ whiteSpace: 'pre-line' }}>{m.text}</p>

                  {m.options && m.options.length > 0 && (
                    <div className="kb-suggestions" style={{ padding: '8px 0 2px', borderTop: 'none' }}>
                      {m.options.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          disabled={busy}
                          onClick={() => void askQuestion(opt.value)}
                        >
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
                <motion.button
                  key={s}
                  type="button"
                  disabled={busy}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => void askQuestion(s)}
                >
                  {s}
                </motion.button>
              ))}
            </div>

            <form className="kb-assistant-form" onSubmit={handleSubmit}>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="اكتب سؤالك أو عدد الصفحات هنا..."
                aria-label="سؤالك للمساعد الذكي"
                disabled={busy}
              />
              <button type="submit" disabled={busy || !query.trim()}>
                إرسال
              </button>
            </form>
          </motion.section>
        )}
      </AnimatePresence>

      <motion.button
        type="button"
        className="kb-assistant-fab"
        onClick={() => setOpen((v) => !v)}
        whileHover={{ scale: 1.05, y: -2 }}
        whileTap={{ scale: 0.95 }}
        aria-expanded={open}
        aria-label="فتح المساعد الذكي"
      >
        {open ? 'إغلاق المساعد' : '💬 اسأل المساعد الذكي'}
      </motion.button>
    </div>
  )
}
