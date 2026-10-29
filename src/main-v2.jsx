import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import SofReport from './SofReport.jsx'
import CostComparisonPage from './CostComparisonPage.jsx'
import DataUpload from './DataUpload.jsx'
import HoverNavigation from './HoverNavigation.jsx'
import './index.css'
import './hide-source-status.css'
import './sof-print.css'
import './sof-badge.css'
import './cost-comparison.css'
import './responsive-fixes.css'
import './ui-fixes.css'

function openSofPrintDialog() {
  const selectedSof = document.querySelector('main select')?.value || 'Report'
  const previousTitle = document.title
  document.title = `E-WORKS SOF ${selectedSof} Financial Progress Report`
  document.body.classList.add('printing-sof')
  const cleanup = () => { document.body.classList.remove('printing-sof'); document.title = previousTitle }
  window.addEventListener('afterprint', cleanup, { once: true })
  requestAnimationFrame(() => window.print())
}

function SofActions() {
  return <div className="sof-print-actions" aria-label="SOF report export actions">
    <div className="sof-action-items">
      <button type="button" className="sof-print-button" onClick={openSofPrintDialog}>Print</button>
      <button type="button" className="sof-pdf-button" onClick={openSofPrintDialog}>Save as PDF</button>
      <button type="button" className="sof-xlsx-button" onClick={() => window.dispatchEvent(new Event('sof-export-xlsx'))}>Export as XLSX</button>
    </div>
    <button type="button" className="sof-actions-trigger" aria-label="Show report actions">
      <span>Report Actions</span><span className="sof-actions-chevron">⌃</span>
    </button>
  </div>
}

function RootRouter() {
  const [hash, setHash] = useState(location.hash || '#/dashboard')
  useEffect(() => {
    const onHash = () => setHash(location.hash || '#/dashboard')
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [])

  const page = hash.replace(/^#\/?/, '')
  let content
  if (page === 'sof') content = <><SofActions /><SofReport /></>
  else if (page === 'costcompare') content = <CostComparisonPage />
  else if (page === 'upload') content = <DataUpload />
  else content = <App />

  return <><HoverNavigation />{content}</>
}

createRoot(document.getElementById('root')).render(<React.StrictMode><RootRouter /></React.StrictMode>)
