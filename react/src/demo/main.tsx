import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '../lib/fonts/fonts.css'
import './demo.css'
import App from './App'

const container = document.getElementById('root')
if (!container) throw new Error('Demo mount point #root is missing from index.html')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
