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
import './responsive-fixes.css'
import './hover-action-fix.css'

const NAV = [
  ['dashboard', 'Dashboard'],
  ['upload', 'Data Upload'],
  ['monthly', 'Monthly Report'],
  ['sof', 'SOF Analysis'],
  ['costcompare', 'Cost Comparison'],
  ['transactions', 'Transactions'],
  ['reference', 'Reference Data'],
  ['worksheets', 'QB Worksheets'],
]

const go = (page) => { location.hash = `#/${page}` }

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
        button.addEventListener('click', () => go('costcompare'))
        const sof = buttons.find(item => item.textContent?.trim() === 'SOF Analysis')
        if (sof?.nextSibling) nav.insertBefore(button, sof.nextSibling)
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

function RouteShell({ children, active = 'upload' }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const close = () => setOpen(false)
    const key = (e) => { if (e.key === 'Escape') setOpen(false) }
    addEventListener('hashchange', close)
    addEventListener('keydown', key)
    return () => { removeEventListener('hashchange', close); removeEventListener('keydown', key) }
  }, [])

  return <div className="min-h-screen w-full overflow-x-hidden bg-[#f7f8fa]">
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-16 max-w-[1500px] items-center gap-3 px-4 lg:px-6">
        <button aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} className="shrink-0" onClick={() => setOpen(!open)}>☰</button>
        <button onClick={() => go('dashboard')} className="min-w-0 text-left"><b className="block truncate text-sm">E-WORKS Income Report</b><div className="truncate text-xs text-slate-500">Finance reporting workspace</div></button>
      </div>
    </header>
    {open && <button aria-label="Close navigation" onClick={() => setOpen(false)} className="fixed inset-0 top-16 z-40 bg-slate-950/30 backdrop-blur-[1px]" />}
    <aside className={`${open ? 'block' : 'hidden'} fixed left-0 top-16 z-50 h-[calc(100vh-4rem)] w-64 border-r border-slate-200 bg-[#171d2c] p-3 text-white shadow-xl`}>
      <nav className="space-y-1">{NAV.map(([id, label]) => <button key={id} onClick={() => go(id)} className={`w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium ${active === id ? 'bg-white text-slate-900' : 'text-slate-300 hover:bg-white/10 hover:text-white'}`}>{label}</button>)}</nav>
    </aside>
    <main className="mx-auto w-full max-w-[1500px] p-4 lg:p-6 xl:p-8">{children}</main>
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
  else if (page === 'upload') content = <RouteShell active="upload"><DataUpload /></RouteShell>
  else content = <App />

  return <><SidebarCostLink />{content}</>
}

createRoot(document.getElementById('root')).render(<React.StrictMode><RootRouter /></React.StrictMode>)
