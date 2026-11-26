import React, { useEffect, useRef, useState } from 'react'

const NAV = [
  { id: 'dashboard', label: 'Financial monitor', group: 'Overview' },
  { id: 'projects', label: 'Project analysis', group: 'Overview' },
  { id: 'budget', label: 'Budget dashboard', group: 'Overview' },
  { id: 'transactions', label: 'All transactions', group: 'Overview' },
  { id: 'monthly', label: 'Monthly report', group: 'Reports' },
  { id: 'sof', label: 'SOF analysis', group: 'Reports' },
  { id: 'costcompare', label: 'Project profitability', group: 'Reports' },
  { id: 'upload', label: 'QuickBooks upload', group: 'Data' },
  { id: 'reference', label: 'Reference data', group: 'Data' },
  { id: 'worksheets', label: 'QB worksheets', group: 'Data' },
]

export default function AppNavigation({ active }) {
  const [open, setOpen] = useState(false)
  const [logoFailed, setLogoFailed] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    const closeOnEscape = event => {
      if (event.key === 'Escape') setOpen(false)
    }
    const closeOnOutsideClick = event => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false)
    }
    const closeOnRouteChange = () => setOpen(false)
    addEventListener('keydown', closeOnEscape)
    addEventListener('pointerdown', closeOnOutsideClick)
    addEventListener('hashchange', closeOnRouteChange)
    return () => {
      removeEventListener('keydown', closeOnEscape)
      removeEventListener('pointerdown', closeOnOutsideClick)
      removeEventListener('hashchange', closeOnRouteChange)
    }
  }, [])

  return <header className="app-topbar no-print">
    <div className="app-topbar-inner" ref={rootRef} onMouseLeave={() => { if (window.matchMedia('(min-width: 768px)').matches) setOpen(false) }}>
      <div className="app-brand-lockup">
        <button
          type="button"
          className={`app-menu-trigger app-menu-trigger-left${open ? ' is-open' : ''}`}
          aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={open}
          aria-controls="app-navigation-menu"
          onMouseEnter={() => { if (window.matchMedia('(min-width: 768px)').matches) setOpen(true) }}
          onClick={() => setOpen(value => !value)}
        >
          <span className="app-menu-glyph" aria-hidden="true"><i /><i /><i /></span>
          <span className="app-menu-trigger-label">Menu</span>
          <span className="app-menu-chevron" aria-hidden="true">⌄</span>
        </button>
        {logoFailed
          ? <span className="app-brand-fallback">GREENLIGHT POWER</span>
          : <img
            className="app-brand-logo"
            src="https://greenlight-rfp.vercel.app/brands/greenlight-power.png"
            alt="Greenlight Power"
            onError={() => setLogoFailed(true)}
          />}
        <span className="app-brand-copy"><small>Finance workspace</small></span>
      </div>
      <div className="app-topbar-actions">
        <span className="app-current-section">{NAV.find(item => item.id === active)?.label || 'Finance workspace'}</span>
      </div>
      <nav id="app-navigation-menu" className={`app-navigation-menu${open ? ' is-open' : ''}`} aria-label="Main navigation">
        {['Overview', 'Reports', 'Data'].map(group => <div className="app-navigation-group" key={group}>
          <span className="app-navigation-heading">{group}</span>
          {NAV.filter(item => item.group === group).map(item => <a
            href={`#/${item.id}`}
            aria-current={active === item.id ? 'page' : undefined}
            className={`app-navigation-link${active === item.id ? ' is-active' : ''}`}
            key={item.id}
            onClick={() => setOpen(false)}
          >{item.label}</a>)}
        </div>)}
      </nav>
    </div>
  </header>
}
