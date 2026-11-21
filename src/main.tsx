import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppRoot } from './App'
import './styles.css'

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <AppRoot />
    </StrictMode>,
  )
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {})
  })
}
