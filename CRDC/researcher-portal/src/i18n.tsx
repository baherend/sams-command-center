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
      style={{ position: 'static', inset: 'auto', width: 'auto' }}
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
const DB_EN_MAP: Record<string, string> = {
  'تحكيم ونشر الأبحاث العلمية': 'Scientific Research Arbitration & Publication',
  'تحكيم ونشر الأبحاث': 'Research Arbitration & Publication',
  'التدقيق اللغوي للرسائل العلمية': 'Thesis Proofreading',
  'التدقيق اللغوي': 'Proofreading',
  'التحليل الإحصائي والمراجعة الإحصائية': 'Statistical Analysis & Review',
  'التحليل الإحصائي والمراجعة الإحصائية للرسائل العلمية': 'Thesis Statistical Analysis & Review',
  'شهادة أساسيات التحول الرقمي': 'Digital Transformation Fundamentals Certificate',
  'التحول الرقمي': 'Digital Transformation',
  'قياس نسبة الاقتباس': 'Plagiarism Check',
  'ماجستير أكاديمي': 'Academic Master’s',
  'دكتوراه أكاديمي': 'Academic PhD',
  'ماجستير مهني': 'Professional Master’s',
  'دكتوراه مهني': 'Professional PhD',
  'تم التقديم': 'Submitted',
  'بانتظار مراجعة المستندات': 'Pending Document Review',
  'بانتظار السداد': 'Awaiting Payment',
  'مدفوع': 'Paid',
  'قيد التنفيذ': 'In Progress',
  'تم الانتهاء': 'Completed',
  'تم تسليم الإفادة': 'Certificate Delivered',
  'ملغي': 'Cancelled',
  'مرفوض': 'Rejected',
  'نشر بحث علمي': 'Publish Scientific Paper',
  'تدقيق لغوي': 'Proofreading',
  'مراجعة لغوية': 'Language Review',
  'شهادة التحول الرقمي': 'Digital Transformation Certificate',
  'التحليل والمراجعة الإحصائية': 'Statistical Analysis & Review',
  'مجلة البحوث الإدارية': 'Administrative Research Journal',
  'مجلة السادات للبحوث الإدارية والمالية': 'Sadat Journal for Administrative and Financial Research',
  'تحليل إحصائي': 'Statistical Analysis',
  'مراجعة إحصائية': 'Statistical Review',
}

export function translateDbText(text: string | null | undefined, isEn: boolean): string {
  if (!text) return ''
  if (!isEn) return text
  return DB_EN_MAP[text.trim()] ?? text
}

export function pickName(
  row: { name_ar?: string | null; name_en?: string | null } | null | undefined,
  lang: Lang,
): string {
  if (!row) return ''
  if (lang === 'en') {
    const en = row.name_en?.trim()
    if (en) return en
    return translateDbText(row.name_ar, true)
  }
  return row.name_ar ?? ''
}