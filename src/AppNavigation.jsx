import React, { useEffect, useMemo, useState } from 'react'

const NAV_GROUPS = [
  {
    label: 'OVERVIEW',
    items: [
      { id: 'dashboard', label: 'Financial monitor', description: 'Revenue, cost and gross profit', icon: 'dashboard' },
      { id: 'projects', label: 'Project analysis', description: 'Project budgets and actual costs', icon: 'projects' },
      { id: 'budget', label: 'Budget dashboard', description: 'Budget usage and remaining funds', icon: 'budget' },
      { id: 'transactions', label: 'All transactions', description: 'Search and review ledger entries', icon: 'transactions' },
    ],
  },
  {
    label: 'REPORTS',
    items: [
      { id: 'monthly', label: 'Monthly report', description: 'Monthly financial summaries', icon: 'calendar' },
      { id: 'sof', label: 'SOF analysis', description: 'SOF-level financial progress', icon: 'report' },
      { id: 'costcompare', label: 'Project cost analysis', description: 'Budget and cost breakdowns', icon: 'costs' },
    ],
  },
  {
    label: 'DATA MANAGEMENT',
    items: [
      { id: 'upload', label: 'QuickBooks upload', description: 'Import QuickBooks workbooks', icon: 'upload' },
      { id: 'reference', label: 'Reference data', description: 'Project and budget references', icon: 'reference' },
      { id: 'worksheets', label: 'QB worksheets', description: 'Imported worksheet batches', icon: 'worksheets' },
    ],
  },
]

const NAV_ITEMS = NAV_GROUPS.flatMap(group => group.items)
const THEME_KEY = 'eworks-theme'

function initialTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // Private browsing or sandbox previews may disable Web Storage.
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function Icon({ name, size = 19 }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }
  const shapes = {
    dashboard: <><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="5" rx="1.5" /><rect x="13" y="10" width="8" height="11" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /></>,
    projects: <><path d="M3 7.5 12 3l9 4.5-9 4.5-9-4.5Z" /><path d="m3 12 9 4.5 9-4.5M3 16.5 12 21l9-4.5" /></>,
    budget: <><rect x="3" y="5" width="18" height="15" rx="2" /><path d="M3 9h18M7 5V3h10v2M7 15h4" /><circle cx="17" cy="15" r="1" /></>,
    transactions: <><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18M8 14h3M8 17h6" /></>,
    report: <><path d="M5 3h10l4 4v14H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M14 3v5h5M7 12h10M7 16h10" /></>,
    costs: <><path d="M4 19V5M4 19h17" /><path d="M8 16v-4M13 16V8M18 16V4" /></>,
    upload: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></>,
    reference: <><ellipse cx="12" cy="5" rx="8.5" ry="3" /><path d="M3.5 5v7c0 1.7 3.8 3 8.5 3s8.5-1.3 8.5-3V5M3.5 12v7c0 1.7 3.8 3 8.5 3s8.5-1.3 8.5-3v-7" /></>,
    worksheets: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 9v12M15 9v12M3 15h18" /></>,
    menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></>,
    moon: <path d="M20.5 14.2A8.6 8.6 0 0 1 9.8 3.5 8.8 8.8 0 1 0 20.5 14.2Z" />,
    chevron: <path d="m9 18 6-6-6-6" />,
  }
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" {...common}>{shapes[name] || shapes.dashboard}</svg>
}

export default function AppNavigation({ active }) {
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia?.('(min-width: 1024px)').matches || false)
  const [pinned, setPinned] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [theme, setTheme] = useState(initialTheme)
  const expanded = isDesktop && (pinned || hovered)
  const activeItem = useMemo(() => NAV_ITEMS.find(item => item.id === active) || NAV_ITEMS[0], [active])

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)')
    const update = event => {
      setIsDesktop(event.matches)
      setHovered(false)
      setMobileOpen(false)
    }
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])

  useEffect(() => {
    const close = () => {
      setMobileOpen(false)
      setHovered(false)
    }
    const onKeyDown = event => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('hashchange', close)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('hashchange', close)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      // Theme still applies for the current session when storage is unavailable.
    }
  }, [theme])

  const handleSidebarToggle = () => {
    if (isDesktop) setPinned(value => !value)
    else setMobileOpen(value => !value)
  }
  const closeMobile = () => setMobileOpen(false)

  return <>
    <a className="eworks-skip-link" href="#eworks-main-content">Skip to main content</a>
    <aside
      className="eworks-sidebar"
      data-expanded={expanded ? 'true' : 'false'}
      data-mobile-open={mobileOpen ? 'true' : 'false'}
      onMouseEnter={() => { if (isDesktop) setHovered(true) }}
      onMouseLeave={() => { if (isDesktop) setHovered(false) }}
      aria-label="E-WORKS navigation"
    >
      <div className="eworks-sidebar-brand">
        <a href="#/dashboard" className="eworks-brand-link" aria-label="E-WORKS financial monitor">
          <span className="eworks-brand-mark">E</span>
          <span className="eworks-brand-copy">
            <strong>E-WORKS</strong>
            <small>Financial workspace</small>
          </span>
        </a>
        <button
          type="button"
          className="eworks-sidebar-toggle"
          onClick={handleSidebarToggle}
          aria-label={pinned ? 'Collapse sidebar' : 'Keep sidebar expanded'}
          aria-pressed={pinned}
          title={pinned ? 'Collapse sidebar' : 'Keep sidebar expanded'}
        >
          <Icon name="chevron" size={17} />
        </button>
      </div>

      <nav className="eworks-sidebar-navigation" aria-label="Main navigation">
        {NAV_GROUPS.map(group => <section className="eworks-nav-group" key={group.label}>
          <p className="eworks-nav-group-label">{group.label}</p>
          <div className="eworks-nav-items">
            {group.items.map(item => <a
              key={item.id}
              href={\`#/\${item.id}\`}
              className={\`eworks-nav-link\${active === item.id ? ' is-active' : ''}\`}
              aria-current={active === item.id ? 'page' : undefined}
              title={expanded || mobileOpen ? item.label : item.description}
              onClick={closeMobile}
            >
              <span className="eworks-nav-icon"><Icon name={item.icon} /></span>
              <span className="eworks-nav-copy">
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </span>
              {active === item.id && <span className="eworks-nav-active-mark" aria-hidden="true" />}
            </a>)}
          </div>
        </section>)}
      </nav>

      <div className="eworks-sidebar-footer">
        <span className="eworks-footer-indicator" />
        <span className="eworks-footer-copy">FINANCIAL REPORTING</span>
      </div>
    </aside>

    {mobileOpen && <button type="button" className="eworks-sidebar-backdrop" onClick={closeMobile} aria-label="Close navigation" />}

    <header className="eworks-topbar">
      <div className="eworks-topbar-heading">
        <button
          type="button"
          className="eworks-mobile-menu"
          onClick={() => setMobileOpen(value => !value)}
          aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={mobileOpen}
          aria-controls="eworks-main-navigation"
        >
          <Icon name="menu" size={21} />
        </button>
        <div className="eworks-topbar-titles">
          <p>E-WORKS FINANCIAL WORKSPACE</p>
          <h1>{activeItem.label}</h1>
        </div>
      </div>
      <div className="eworks-topbar-actions">
        <span className="eworks-workspace-note"><span className="eworks-workspace-dot" /> Financial monitoring</span>
        <button
          type="button"
          className="eworks-theme-toggle"
          onClick={() => setTheme(value => value === 'dark' ? 'light' : 'dark')}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-pressed={theme === 'dark'}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
          <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
        </button>
      </div>
    </header>
  </>
}
