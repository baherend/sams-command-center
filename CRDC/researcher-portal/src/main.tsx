import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ThemeToggle from './ThemeToggle'
import { LanguageProvider, LanguageToggle } from './i18n'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LanguageProvider>
      <LanguageToggle />
      <ThemeToggle />
      <App />
    </LanguageProvider>
  </React.StrictMode>,
)