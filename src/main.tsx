import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './fonts-load'
import './index.css'
import App from './App.tsx'
import { startPwa } from './pwa'

startPwa()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
