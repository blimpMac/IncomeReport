import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import FinanceWorkspace from './FinanceWorkspace.jsx'
import SofReport from './SofReport.jsx'
import CostComparisonPage from './CostComparisonPage.jsx'
import DataUpload from './DataUpload.jsx'
import ReferenceDataPage from './ReferenceDataPage.jsx'
import AppNavigation from './AppNavigation.jsx'
import './index.css'
import './hide-source-status.css'
import './sof-print.css'
import './sof-badge.css'
import './cost-comparison.css'
import './responsive-fixes.css'
import './costcompare-layout.css'
import './hover-action-fix.css'
import './reference-layout.css'
import './typography-responsive.css'
import './no-scroll-tables.css'
import './workspace-theme.css'

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

function RouteShell({ children, active = 'upload' }) {
  return <div className="app-page" data-active-page={active}><main className="app-page-main">{children}</main></div>
}

// Existing report pages use native tables. Add accessible field labels to their
// cells so narrow cards can display every value without horizontal scrolling.
function ResponsiveTableLabels() {
  useEffect(() => {
    const root = document.getElementById('root')
    if (!root) return undefined

    const labelTables = () => {
      root.querySelectorAll('main table').forEach(table => {
        const header = table.querySelector('thead tr')
        if (!header) return
        const labels = [...header.querySelectorAll('th')].map(th =>
          (th.textContent || '').replace(/\s+/g, ' ').trim()
        )
        if (!labels.length) return

        if (!table.classList.contains('responsive-record-table')) {
          table.classList.add('responsive-record-table')
        }
        if (table.dataset.columnCount !== String(labels.length)) {
          table.dataset.columnCount = String(labels.length)
        }
        table.parentElement?.classList.add('responsive-table-host')

        table.querySelectorAll('tbody > tr').forEach(tr => {
          [...tr.children].filter(cell => cell.tagName === 'TD').forEach((cell, index) => {
            if (cell.colSpan > 1) return
            const label = labels[index] || 'Details'
            if (cell.getAttribute('data-label') !== label) cell.setAttribute('data-label', label)
          })
        })
      })
    }

    const observer = new MutationObserver(labelTables)
    observer.observe(root, { childList: true, subtree: true })
    labelTables()
    return () => observer.disconnect()
  }, [])
  return null
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
  if (['dashboard', 'projects', 'transactions'].includes(page)) content = <FinanceWorkspace />
  else if (page === 'sof') content = <><SofActions /><SofReport /></>
  else if (page === 'costcompare') content = <CostComparisonPage />
  else if (page === 'upload') content = <RouteShell active="upload"><DataUpload /></RouteShell>
  else if (page === 'reference') content = <RouteShell active="reference"><div className="reference-route"><ReferenceDataPage /></div></RouteShell>
  else content = <App />

  return <><AppNavigation active={page} /><ResponsiveTableLabels />{content}</>
}

createRoot(document.getElementById('root')).render(<React.StrictMode><RootRouter /></React.StrictMode>)
