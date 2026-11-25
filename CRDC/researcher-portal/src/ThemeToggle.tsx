import { useEffect, useState } from 'react'
import { useI18n } from './i18n'

export default function ThemeToggle() {
  const { t } = useI18n()
  const [dark, setDark] = useState<boolean>(() => {
    try {
      return localStorage.getItem('crdc-theme') === 'dark'
    } catch {
      return false
    }
  })

  useEffect(() => {
    const root = document.documentElement
    if (dark) {
      root.setAttribute('data-theme', 'dark')
      try { localStorage.setItem('crdc-theme', 'dark') } catch {}
    } else {
      root.removeAttribute('data-theme')
      try { localStorage.setItem('crdc-theme', 'light') } catch {}
    }
  }, [dark])

  return (
    <button
      type="button"
      className="theme-toggle-fab" style={{ position: 'static', inset: 'auto', width: 'auto' }}
      onClick={() => setDark((d) => !d)}
      aria-label={dark ? t('التبديل إلى الوضع النهاري', 'Switch to light mode') : t('التبديل إلى الوضع الليلي', 'Switch to dark mode')}
      title={dark ? t('الوضع النهاري', 'Light mode') : t('الوضع الليلي', 'Dark mode')}
    >
      <span key={dark ? 'sun' : 'moon'} className="theme-toggle-icon">
        {dark ? t('☀️ نهاري', '☀️ Light') : t('🌙 ليلي', '🌙 Dark')}
      </span>
    </button>
  )
}