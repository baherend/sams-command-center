import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { motion } from 'motion/react'

export type Lang = 'ar' | 'en'

type I18nContextValue = {
  lang: Lang
  dir: 'rtl' | 'ltr'
  isEn: boolean
  setLang: (lang: Lang) => void
  toggleLang: () => void
  t: (ar: string, en: string) => string
}

const I18nContext = createContext<I18nContextValue>({
  lang: 'ar',
  dir: 'rtl',
  isEn: false,
  setLang: () => {},
  toggleLang: () => {},
  t: (ar) => ar,
})

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    try {
      return localStorage.getItem('crdc-lang') === 'en' ? 'en' : 'ar'
    } catch {
      return 'ar'
    }
  })

  useEffect(() => {
    const root = document.documentElement
    const dir = lang === 'en' ? 'ltr' : 'rtl'
    root.setAttribute('lang', lang)
    root.setAttribute('dir', dir)
    try {
      localStorage.setItem('crdc-lang', lang)
    } catch {}
  }, [lang])

  const value: I18nContextValue = {
    lang,
    dir: lang === 'en' ? 'ltr' : 'rtl',
    isEn: lang === 'en',
    setLang,
    toggleLang: () => setLang((prev) => (prev === 'ar' ? 'en' : 'ar')),
    t: (ar, en) => (lang === 'en' ? en : ar),
  }

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  return useContext(I18nContext)
}

export function LanguageToggle() {
  const { isEn, toggleLang } = useI18n()

  return (
    <motion.button
      type="button"
      className="theme-toggle-fab"
      style={{ insetInlineEnd: '7.5rem' }}
      onClick={toggleLang}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.94 }}
      aria-label={isEn ? 'Switch to Arabic' : 'التبديل إلى اللغة الإنجليزية'}
      title={isEn ? 'العربية' : 'English'}
    >
      <span>{isEn ? '🌐 عربي' : '🌐 EN'}</span>
    </motion.button>
  )
}