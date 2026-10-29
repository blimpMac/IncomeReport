import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import SofReport from './SofReport.jsx'
import './index.css'
import './hide-source-status.css'

function RootRouter() {
  const [hash, setHash] = useState(location.hash || '#/dashboard')
  useEffect(() => {
    const onHash = () => setHash(location.hash || '#/dashboard')
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [])
  return hash.replace(/^#\/?/, '') === 'sof' ? <SofReport /> : <App />
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RootRouter />
  </React.StrictMode>,
)
