import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { supabase } from './supabase'
import MorshedAvatar from './MorshedAvatar'
import { useI18n } from './i18n'
import { MurshidEngine } from './murshid/engine'
import type { Audience } from './murshid/engine'
import { loadEmbedder, loadFees, loadIndex } from './murshid/load'
import { linkSegments } from './murshid/text'
import type { Answer, Option } from './murshid/types'

// Morshed runs the Murshid engine in the researcher's browser (src/murshid/, a port of CRDC/chatbot/rag/).
// No server and no text generation: every answer is a passage of the procedural guide, a fee computed
// from crdc.fee_schedule, or a journal suggestion from journals.json. Anything else is refused.

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  answer?: Answer
}

type ModelState = { status: 'idle' | 'loading' | 'ready' | 'failed'; progress: number }

// Each starter is checked to get a sourced answer (scripts/murshid-eval.ts runs the same engine).
const SUGGESTIONS_AR = [
  'احسب رسوم نشر بحث 30 صفحة',
  'أنشر بحثي في أي مجلة؟',
  'ما نسبة الاقتباس المقبولة؟',
  'الفرق بين الرسالة العلمية والبحث',
]

const SUGGESTIONS_EN = [
  'Calculate publication fees for 30 pages',
  'Which journal fits my paper?',
  'What similarity percentage is accepted?',
  'Difference between a thesis and a paper',
]

const AUDIENCE: Record<string, Audience> = { egyptian: 'eg', expat: 'intl', staff: null, all: null }

function Linked({ text }: { text: string }) {
  return (
    <>
      {linkSegments(text).map((s, i): ReactNode =>
        s.kind === 'url' ? <a key={i} href={s.value} target="_blank" rel="noopener noreferrer" dir="ltr">{s.value}</a>
          : s.kind === 'email' ? <a key={i} href={`mailto:${s.value}`} dir="ltr">{s.value}</a>
            : <span key={i}>{s.value}</span>)}
    </>
  )
}

/** The answer's source as a short chain; a real "not in the guide" refusal gets a broken chain. */
function SourceChain({ answer }: { answer: Answer }) {
  const en = answer.lang === 'en'
  if (!answer.answered) {
    if (answer.route !== 'refusal' || ['not_ready', 'fees_unavailable', 'fees_which_service'].includes(answer.topId ?? '')) return null
    const label = en ? 'No source in the guide' : 'لا يوجد مصدر في الدليل'
    return <div className="kb-chain kb-chain-broken" aria-label={label}><span>{label}</span></div>
  }
  if (!answer.sources.length) return null
  const s = answer.sources[0]
  const proposed = s.title.includes('مقترح') || s.title.includes('proposed')
  const steps = answer.route === 'calculator' ? (en ? ['Fee table', 'Computed'] : ['جدول الرسوم', 'حساب آلي'])
    : answer.route === 'journal' ? (en ? ['Center journals', proposed ? 'Proposed routing' : 'Approved routing']
      : ['مجلات المركز', proposed ? 'توجيه مقترح' : 'توجيه معتمد'])
      : [en ? 'Procedural guide' : 'الدليل الإجرائي', s.title]
  return (
    <div className="kb-chain" aria-label={`${en ? 'Source' : 'المصدر'}: ${steps.join(en ? ', ' : '، ')}`}>
      {steps.map((step, i) => (
        <span key={i} className="kb-chain-step">
          {i > 0 && <i aria-hidden="true" />}
          <span className="kb-chain-node">{step}</span>
        </span>
      ))}
    </div>
  )
}

export default function AssistantWidget({ audience }: { audience: 'egyptian' | 'expat' | 'staff' | 'all' }) {
  const { t, dir, isEn } = useI18n()
  const [open, setOpen] = useState(false)
  const [showGreeting, setShowGreeting] = useState(false)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [model, setModel] = useState<ModelState>({ status: 'idle', progress: 0 })
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: t('أهلًا بك! أنا «مرشد»، مساعد الباحث في مركز الاستشارات والبحوث والتطوير. أجيب من الدليل الإجرائي فقط، وأذكر مصدر كل إجابة، وإذا لم تكن المعلومة في الدليل أخبرك بذلك بدلًا من التخمين. ويمكنني حساب رسوم النشر والتدقيق بعدد الصفحات، وترشيح المجلة المناسبة لتخصصك.',
        'Welcome! I am Morshed, the researcher\'s assistant at CRDC. I answer only from the procedural guide and show the source of every answer; if the guide does not cover something, I say so instead of guessing. I can also calculate publication and proofreading fees by page count and suggest the right journal for your field.'),
    },
  ])
  const engineRef = useRef<Promise<MurshidEngine> | null>(null)
  const modelRef = useRef<Promise<void> | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const t1 = window.setTimeout(() => { if (!open) setShowGreeting(true) }, 1000)
    const t2 = window.setTimeout(() => setShowGreeting(false), 8500)
    return () => { window.clearTimeout(t1); window.clearTimeout(t2) }
  }, [])

  // Loaded the first time the panel opens: index + fee table first (fast), then the embedding
  // model in the background (about 135 MB once, then cached by the browser).
  function getEngine(): Promise<MurshidEngine> {
    if (!engineRef.current) {
      engineRef.current = (async () => {
        const [index, fees] = await Promise.all([loadIndex(), loadFees(supabase)])
        const engine = new MurshidEngine(index, { fees, embed: null, audience: AUDIENCE[audience] })
        setModel({ status: 'loading', progress: 0 })
        modelRef.current = loadEmbedder(index, (p) => setModel({ status: 'loading', progress: p }))
          .then((embed) => {
            engine.setEmbed(embed)
            setModel({ status: 'ready', progress: 1 })
          })
          .catch(() => setModel({ status: 'failed', progress: 0 }))
        return engine
      })()
      engineRef.current.catch(() => { engineRef.current = null })
    }
    return engineRef.current
  }

  useEffect(() => {
    if (open) void getEngine().catch(() => undefined)
  }, [open])

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  function toggleOpen() {
    setShowGreeting(false)
    setOpen((v) => !v)
  }

  async function askQuestion(rawText: string, shown?: string) {
    const clean = rawText.trim()
    if (!clean || busy) return

    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', text: shown ?? clean }])
    setQuery('')
    setBusy(true)

    try {
      const engine = await getEngine()
      let answer = await engine.ask(clean)
      // A guide question asked while the model is still downloading: wait for it, then answer.
      if (answer.topId === 'not_ready' && modelRef.current) {
        await modelRef.current
        answer = await engine.ask(clean)
      }
      setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: 'assistant', text: answer.text, answer }])
    } catch {
      setMessages((prev) => [...prev, {
        id: `e-${Date.now()}`,
        role: 'assistant',
        text: t('تعذّر تشغيل المساعد الآن. تأكد من اتصالك بالإنترنت وحاول مرة أخرى.', 'The assistant could not start. Check your internet connection and try again.'),
      }])
    } finally {
      setBusy(false)
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    void askQuestion(query)
  }

  const pct = Math.round(model.progress * 100)

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
                  <small>{t('يجيب من الدليل الإجرائي فقط', 'Answers only from the procedural guide')}</small>
                </div>
              </div>
              <button type="button" className="kb-close-btn" onClick={() => setOpen(false)} aria-label={t('إغلاق مرشد', 'Close Morshed')}>
                ×
              </button>
            </header>

            {model.status === 'loading' && (
              <div className="kb-model-status" role="status">
                <span>{t(`جارٍ تجهيز مرشد على جهازك (مرة واحدة، نحو 135 ميجابايت) ${pct}%`, `Preparing Morshed on your device (once, about 135 MB) ${pct}%`)}</span>
                <progress max={100} value={pct} aria-label={t('تحميل محرك البحث', 'Loading the search engine')} />
              </div>
            )}
            {model.status === 'failed' && (
              <div className="kb-model-status kb-model-failed" role="status">
                {t('تعذّر تحميل محرك البحث، لذا يمكنني حاليًا حساب الرسوم وترشيح المجلة فقط.', 'The search engine did not load, so for now I can only calculate fees and suggest a journal.')}
              </div>
            )}

            <div className="kb-assistant-body" ref={bodyRef} aria-live="polite">
              {messages.map((m) => (
                <motion.div
                  key={m.id}
                  className={`kb-msg kb-msg-${m.role}${m.answer && !m.answer.answered ? ' kb-msg-refusal' : ''}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22 }}
                >
                  {m.role === 'assistant' ? (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                      <MorshedAvatar size={28} compact />
                      <div style={{ minWidth: 0 }}>
                        <p className="kb-answer-text" dir={m.answer ? (m.answer.lang === 'en' ? 'ltr' : 'rtl') : undefined}><Linked text={m.text} /></p>
                        {m.answer && <SourceChain answer={m.answer} />}
                      </div>
                    </div>
                  ) : (
                    <p style={{ whiteSpace: 'pre-line', margin: 0 }}>{m.text}</p>
                  )}

                  {m.answer && m.answer.options.length > 0 && (
                    <div className="kb-options">
                      {m.answer.options.map((opt: Option) => (
                        <button key={opt.value} type="button" disabled={busy} onClick={() => void askQuestion(opt.value, opt.label)}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {m.answer && m.answer.suggestions.length > 0 && (
                    <div className="kb-related">
                      <span>{m.answer.lang === 'en' ? 'Related:' : 'أسئلة قريبة:'}</span>
                      {m.answer.suggestions.map((s) => (
                        <button key={s} type="button" disabled={busy} onClick={() => void askQuestion(s)}>{s}</button>
                      ))}
                    </div>
                  )}
                </motion.div>
              ))}
              {busy && (
                <div className="kb-msg kb-msg-assistant">
                  <p>{model.status === 'loading'
                    ? t(`في انتظار اكتمال تحميل محرك البحث (${pct}%)…`, `Waiting for the search engine to finish loading (${pct}%)…`)
                    : t('جاري البحث في الدليل الإجرائي...', 'Searching the procedural guide...')}</p>
                </div>
              )}
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
                maxLength={500}
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
            <span>{t('أهلًا بك! أنا مرشد، اضغط لفتح الكتاب 👋', 'Welcome! I am Morshed, click to open the book 👋')}</span>
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
