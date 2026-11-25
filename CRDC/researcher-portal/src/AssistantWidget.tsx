import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { supabase } from './supabase'
import { friendlyError } from './errors'
import { runAssistantLocalTools } from './assistantTools'
import type { QuickOption } from './assistantTools'
import MorshedAvatar from './MorshedAvatar'
import { useI18n } from './i18n'

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

const SUGGESTIONS_AR = [
  'احسب رسوم نشر بحث 30 صفحة',
  'أنشر بحثي في أي مجلة؟',
  'المستندات المطلوبة للتقديم',
  'خطوات سداد الرسوم',
]

const SUGGESTIONS_EN = [
  'Calculate publication fees for 30 pages',
  'Which journal fits my paper?',
  'Required documents for submission',
  'Fee payment steps',
]

export default function AssistantWidget({ audience }: { audience: 'egyptian' | 'expat' | 'staff' | 'all' }) {
  const { t, dir, isEn } = useI18n()
  const [open, setOpen] = useState(false)
  const [showGreeting, setShowGreeting] = useState(false)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: t('أهلاً بك! أنا «مرشد»، المساعد الذكي لمركز الاستشارات والبحوث والتطوير. اسألني عن الإجراءات، احسب رسوم النشر والتدقيق بعدد الصفحات، أو اسألني عن المجلة المناسبة لتخصصك.', 'Welcome! I am Morshed, the CRDC smart assistant. Ask me about procedures, calculate publication & proofreading fees by page count, or find the right journal for your specialty.'),
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
        ? { id: `a-${Date.now()}`, role: 'assistant', text: isEn ? `Found ${rows.length} matching ${rows.length === 1 ? 'entry' : 'entries'} in the procedural guide:` : `وجدت ${rows.length === 1 ? 'معلومة مطابقة' : ` معلومات مطابقة`} في الدليل الإجرائي:`, results: rows }
        : { id: `a-${Date.now()}`, role: 'assistant', text: t('لم أجد إجابة مطابقة بدقة في الدليل الإجرائي. جرّب إعادة صياغة سؤالك أو اسألني مثلاً: (رسوم نشر 30 صفحة، أو أنشر بحثي فين؟).', 'I could not find an exact match in the procedural guide. Try rephrasing your question or ask: (publication fees for 30 pages, or which journal should I publish in?).') }

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
    <div className="kb-assistant-root" dir={dir}>
      <AnimatePresence>
        {open && (
          <motion.section
            className="kb-assistant-panel"
            aria-label={t('مرشد - المساعد الذكي للدليل الإجرائي', 'Morshed - Smart Procedural Guide Assistant')}
            style={{
              transformOrigin: '48px calc(100% + 42px)',
              borderTop: '2px solid #00A3A9',
              boxShadow: '0 22px 48px rgba(15,23,42,0.35), 0 0 24px rgba(0,163,169,0.22)',
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
                  <strong>{t('مرشد', 'Morshed')}</strong>
                  <small>{t('الدليل الإجرائي • الحاسبة • المجلات', 'Guide • Calculator • Journals')}</small>
                </div>
              </div>
              <button type="button" className="kb-close-btn" onClick={() => setOpen(false)} aria-label={t('إغلاق مرشد', 'Close Morshed')}>
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
              {busy && <div className="kb-msg kb-msg-assistant"><p>{t('جاري البحث في الدليل الإجرائي...', 'Searching the procedural guide...')}</p></div>}
            </div>

            <div className="kb-suggestions">
              {(isEn ? SUGGESTIONS_EN : SUGGESTIONS_AR).map((s) => (
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
                placeholder={t('اسأل مرشد عن الإجراءات أو الرسوم...', 'Ask Morshed about procedures or fees...')}
                aria-label={t('سؤالك لمرشد', 'Your question for Morshed')}
                disabled={busy}
              />
              <button type="submit" disabled={busy || !query.trim()}>
                {t('إرسال', 'Send')}
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
            style={{
              position: 'relative',
              background: '#0f172a',
              color: '#f8fafc',
              border: '1.5px solid #00A3A9',
              borderRadius: '0.95rem',
              padding: '0.5rem 0.85rem',
              fontSize: '0.82rem',
              fontWeight: 600,
              boxShadow: '0 10px 24px rgba(0,0,0,0.35), 0 0 14px rgba(0,163,169,0.25)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              whiteSpace: 'nowrap',
            }}
          >
            <span>{t('أهلاً بك! أنا مرشد، اضغط لفتح الكتاب 👋', 'Welcome! I am Morshed, click to open the book 👋')}</span>
            <button
              type="button"
              aria-label={t('إغلاق الترحيب', 'Close greeting')}
              onClick={(e) => { e.stopPropagation(); setShowGreeting(false) }}
              style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '1rem', lineHeight: 1, cursor: 'pointer', padding: '0 0.15rem' }}
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
                background: '#0f172a',
                borderRight: '1.5px solid #00A3A9',
                borderBottom: '1.5px solid #00A3A9',
                transform: 'rotate(45deg)',
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        type="button"
        onClick={toggleOpen}
        whileHover={{ scale: 1.06, y: -3 }}
        whileTap={{ scale: 0.95 }}
        aria-expanded={open}
        aria-label={open ? t('إغلاق مرشد', 'Close Morshed') : t('فتح مرشد', 'Open Morshed')}
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          display: 'inline-flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '0.2rem',
          fontFamily: 'inherit',
        }}
      >
        <AnimatePresence mode="popLayout">
          {!open && (
            <motion.div
              key="morshed-character"
              initial={{ opacity: 0, scale: 0.45, y: 24 }}
              animate={{ opacity: 1, scale: 1, y: [0, -5, 0] }}
              exit={{ opacity: 0, scale: 0.55, y: 18, transition: { duration: 0.2 } }}
              transition={{
                opacity: { duration: 0.25 },
                scale: { type: 'spring', stiffness: 320, damping: 22 },
                y: { duration: 3, repeat: Infinity, ease: 'easeInOut' },
              }}
            >
              <MorshedAvatar size={96} isOpen={false} />
            </motion.div>
          )}
        </AnimatePresence>
        <span
          className="kb-assistant-fab"
          style={{
            padding: '0.45rem 1.15rem',
            fontSize: '0.88rem',
            fontWeight: 700,
            border: '1.5px solid #00A3A9',
            boxShadow: '0 8px 20px rgba(15,23,42,0.35)',
          }}
        >
          {open ? t('إغلاق مرشد', 'Close Morshed') : t('اسأل مرشد', 'Ask Morshed')}
        </span>
      </motion.button>
    </div>
  )
}