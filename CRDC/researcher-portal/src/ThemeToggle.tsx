import { useEffect, useState } from 'react'
import { motion } from 'motion/react'

export default function ThemeToggle() {
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
    <motion.button
      type="button"
      className="theme-toggle-fab"
      onClick={() => setDark((d) => !d)}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.94 }}
      aria-label={dark ? 'التبديل إلى الوضع النهاري' : 'التبديل إلى الوضع الليلي'}
      title={dark ? 'الوضع النهاري' : 'الوضع الليلي'}
    >
      <motion.span
        key={dark ? 'sun' : 'moon'}
        initial={{ rotate: -90, opacity: 0 }}
        animate={{ rotate: 0, opacity: 1 }}
        transition={{ duration: 0.25 }}
      >
        {dark ? '☀️ نهاري' : '🌙 ليلي'}
      </motion.span>
    </motion.button>
  )
}
