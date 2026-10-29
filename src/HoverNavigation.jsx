import React, { useEffect, useState } from 'react'

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

const currentPage = () => (location.hash || '#/dashboard').replace(/^#\/?/, '') || 'dashboard'

export default function HoverNavigation() {
  const [page, setPage] = useState(currentPage())
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onHash = () => { setPage(currentPage()); setOpen(false) }
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [])

  const go = id => { location.hash = `#/${id}` }

  return <aside
    className="global-hover-nav"
    data-open={open ? 'true' : 'false'}
    onMouseEnter={() => setOpen(true)}
    onMouseLeave={() => setOpen(false)}
  >
    <button
      type="button"
      className="global-hover-nav-handle"
      aria-label={open ? 'Close menu panel' : 'Open menu panel'}
      aria-expanded={open}
      onClick={() => setOpen(v => !v)}
    >
      <span className="global-hover-nav-icon">☰</span>
      <span>Menu</span>
      <span className="global-hover-nav-arrow">⌃</span>
    </button>
    <div className="global-hover-nav-panel">
      <div className="global-hover-nav-heading">
        <b>E-WORKS</b>
        <span>Finance workspace</span>
      </div>
      <nav>
        {NAV.map(([id, label]) => <button
          type="button"
          key={id}
          onClick={() => go(id)}
          className={page === id ? 'is-active' : ''}
        >{label}</button>)}
      </nav>
    </div>
  </aside>
}
