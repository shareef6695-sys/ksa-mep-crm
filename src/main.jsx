import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
// Fonts are served from this site, not Google Fonts: no visitor IP / browser details go to a third party.
import '@fontsource/noto-sans/400.css'
import '@fontsource/noto-sans/500.css'
import '@fontsource/noto-sans/600.css'
import '@fontsource/noto-sans/700.css'
import '@fontsource/noto-sans-arabic/400.css'
import '@fontsource/noto-sans-arabic/500.css'
import '@fontsource/noto-sans-arabic/600.css'
import '@fontsource/noto-sans-arabic/700.css'
import './index.css'
import App from './App.jsx'

// Each screen has a URL (/sales_quotes, /fin_gl, /object/invoice/<id>). The host must serve index.html for every path
// (see README: SPA fallback).
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
