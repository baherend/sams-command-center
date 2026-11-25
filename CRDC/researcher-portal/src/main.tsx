import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ThemeToggle from './ThemeToggle'
import { LanguageProvider, LanguageToggle } from './i18n'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LanguageProvider>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.6rem', padding: '0.65rem 1.25rem 0', maxWidth: '1240px', margin: '0 auto' }}>
        <LanguageToggle />
        <ThemeToggle />
      </div>
      <App />
    </LanguageProvider>
  </React.StrictMode>,
)