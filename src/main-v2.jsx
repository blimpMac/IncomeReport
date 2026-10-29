import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import SofReport from './SofReport.jsx'
import CostComparisonPage from './CostComparisonPage.jsx'
import DataUpload from './DataUpload.jsx'
import './index.css'
import './hide-source-status.css'
import './sof-print.css'
import './sof-badge.css'
import './cost-comparison.css'

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
    <button type="button" className="sof-print-button" onClick={openSofPrintDialog}>Print</button>
    <button type="button" className="sof-pdf-button" onClick={openSofPrintDialog}>Save as PDF</button>
    <button type="button" className="sof-xlsx-button" onClick={() => window.dispatchEvent(new Event('sof-export-xlsx'))}>Export as XLSX</button>
  </div>
}

function SidebarCostLink() {
  useEffect(() => {
    const addLink = () => {
      document.querySelectorAll('aside nav').forEach(nav => {
        const buttons = [...nav.querySelectorAll('button')]
        if (buttons.some(button => button.textContent?.trim() === 'Cost Comparison')) return
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = 'Cost Comparison'
        button.className = 'w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium text-slate-600 hover:bg-slate-100'
        button.addEventListener('click', () => { location.hash = '#/costcompare' })
        const sof = buttons.find(item => item.textContent?.trim() === 'SOF Analysis')
        if (sof?.nextSibling) nav.insertBefore(button, sof.nextSibling)
        else if (sof) nav.appendChild(button)
        else nav.appendChild(button)
      })
    }
    addLink()
    const observer = new MutationObserver(addLink)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])
  return null
}

function RootRouter() {
  const [hash, setHash] = useState(location.hash || '#/dashboard')
  useEffect(() => { const onHash = () => setHash(location.hash || '#/dashboard'); addEventListener('hashchange', onHash); return () => removeEventListener('hashchange', onHash) }, [])
  const page = hash.replace(/^#\/?/, '')
  let content
  if (page === 'sof') content = <><SofActions /><SofReport /></>
  else if (page === 'costcompare') content = <CostComparisonPage />
  else if (page === 'upload') content = <DataUpload />
  else content = <App />
  return <><SidebarCostLink />{content}</>
}

createRoot(document.getElementById('root')).render(<React.StrictMode><RootRouter /></React.StrictMode>)
