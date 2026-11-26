import React, { useEffect, useMemo, useState } from 'react'
import { money, number, shortDate, supabase } from './lib.js'

const monthName = value => value ? new Date(`${value}-01T00:00:00`).toLocaleDateString('en-PH', { month: 'short', year: 'numeric' }) : '—'
const categoryName = value => {
  const key = String(value || '').toUpperCase().replace(/[\s_-]+/g, '')
  if (key.includes('SUPPLY')) return 'Supply'
  if (key.includes('SERVIC')) return 'Servicing'
  if (key.includes('CIVIL')) return 'Civil Works'
  if (key.includes('EWORK')) return 'Eworks'
  if (!key || key === 'ALLTRANSACTIONS' || key === 'PROJECT') return 'Uncategorized'
  return value || 'Uncategorized'
}
const txCost = row => ['Materials', 'Labor', 'Overhead', 'Other'].includes(row.category) ? Number(row.debit || 0) - Number(row.credit || 0) : 0

function Shell({ children }) {
  return <div className="app-page"><main className="app-page-main workspace-content">{children}</main></div>
}

function Card({ title, note, children, className = '' }) {
  return <section className={`min-w-0 rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm ${className}`}><div className="mb-4"><h2 className="font-semibold text-slate-900">{title}</h2>{note && <p className="mt-1 text-xs text-slate-500">{note}</p>}</div>{children}</section>
}

const DONUT_COLORS = ['#16876f', '#397da3', '#d7973e', '#bd6670', '#7a70b5']

function DonutChart({ rows, total, emptyLabel }) {
  const positiveRows = rows.filter(row => Number(row.value) > 0)
  const positiveTotal = positiveRows.reduce((sum, row) => sum + Number(row.value), 0)
  let cursor = 0
  const gradient = positiveRows.map((row, index) => {
    const start = cursor
    cursor += Number(row.value) / positiveTotal * 100
    return `${DONUT_COLORS[index % DONUT_COLORS.length]} ${start}% ${cursor}%`
  }).join(', ')
  return <div className="monitor-donut-layout">
    {positiveTotal > 0 ? <>
      <div className="monitor-donut" style={{ background: `conic-gradient(${gradient})` }} aria-label={`${money(total)} total`} role="img">
        <div className="monitor-donut-hole"><strong>{money(total)}</strong><span>Total</span></div>
      </div>
      <div className="monitor-donut-legend">{positiveRows.map((row, index) => <div key={row.label}>
        <span><i style={{ background: DONUT_COLORS[index % DONUT_COLORS.length] }} />{row.label}</span>
        <b>{money(row.value)}</b>
        <small>{(Number(row.value) / positiveTotal * 100).toFixed(0)}%</small>
      </div>)}</div>
    </> : <p className="monitor-empty">{emptyLabel}</p>}
  </div>
}

function useMonths() {
  const [months, setMonths] = useState([])
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    // Reporting periods come from upload metadata, not a full scan of the
    // transaction view. This avoids loading thousands of transaction rows
    // just to populate the Year/Month selectors.
    const loadMonths = async () => {
      try {
        const { data, error: queryError } = await supabase.from('income_qb_uploads')
          .select('detected_min_date,detected_max_date,status')
          .eq('status', 'ready')
          .limit(200)
        if (!active) return
        if (queryError) { setError(queryError.message); return }
        const available = new Set()
        for (const upload of data || []) {
          const start = upload.detected_min_date?.slice(0, 7)
          const end = upload.detected_max_date?.slice(0, 7)
          if (!start || !end) continue
          let cursor = new Date(`${start}-01T00:00:00`)
          const last = new Date(`${end}-01T00:00:00`)
          while (cursor <= last) {
            available.add(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`)
            cursor.setMonth(cursor.getMonth() + 1)
          }
        }
        setMonths([...available].sort().reverse())
        setError('')
      } catch (queryError) {
        if (active) setError(queryError?.message || 'Unable to load reporting periods.')
      }
    }
    loadMonths()
    return () => { active = false }
  }, [])
  return { months, error }
}

function MainDashboard() {
  const { months, error: monthsError } = useMonths()
  const years = useMemo(() => [...new Set(months.map(month => month.slice(0, 4)))], [months])
  const [year, setYear] = useState('')
  const [month, setMonth] = useState('')
  useEffect(() => {
    if (years.length && !years.includes(year)) setYear(years[0])
    if (!years.length) setYear('')
  }, [years, year])
  const yearMonths = useMemo(() => months.filter(value => value.startsWith(year)), [months, year])
  useEffect(() => { if (!yearMonths.includes(month)) setMonth(yearMonths[0] || '') }, [yearMonths, month])
  const selectedMonths = useMemo(() => [...yearMonths].reverse(), [yearMonths])
  const [reports, setReports] = useState([])
  const [sofRows, setSofRows] = useState([])
  const [costAccounts, setCostAccounts] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    if (!selectedMonths.length) { setReports([]); setLoading(false); return }
    setLoading(true)
    const loadReports = async () => {
      try {
        const nextReports = []
        // Run one month at a time to avoid concurrent aggregate queries
        // competing for the same database statement-timeout budget.
        for (const reportMonth of selectedMonths) {
          const { data, error: reportError } = await supabase.rpc('income_monthly_report', { p_month: `${reportMonth}-01` })
          if (!active) return
          if (reportError) throw reportError
          nextReports.push({ month: reportMonth, ...(data || {}) })
        }
        if (!active) return
        setReports(nextReports)
        setError('')
      } catch (reportError) {
        if (active) setError(reportError?.message || 'Unable to load monthly financial totals.')
      } finally {
        if (active) setLoading(false)
      }
    }
    loadReports()
    return () => { active = false }
  }, [selectedMonths])
  useEffect(() => {
    let active = true
    if (!month) { setSofRows([]); setCostAccounts([]); return }
    Promise.all([
      supabase.rpc('income_monthly_sof_summary', { p_month: `${month}-01` }),
      supabase.rpc('income_monthly_cost_accounts', { p_month: `${month}-01` }),
    ]).then(([sofResult, accountResult]) => {
      if (!active) return
      if (sofResult.error) setError(sofResult.error.message)
      else setSofRows(sofResult.data || [])
      if (accountResult.error) setError(accountResult.error.message)
      else setCostAccounts(accountResult.data || [])
    }).catch(e => { if (active) setError(e?.message || 'Unable to load transaction breakdown.') })
    return () => { active = false }
  }, [month])
  const visibleReports = reports.filter(row => row.month.startsWith(year))
  const selected = reports.find(row => row.month === month)
  const max = Math.max(1, ...visibleReports.flatMap(row => [Number(row.revenue || 0), Number(row.total_cost || 0)]))
  const problem = error || monthsError
  const costMix = [['Materials', selected?.materials], ['Labor', selected?.labor], ['Overhead', selected?.overhead], ['Other', selected?.other_cost]]
  const totalCost = Number(selected?.total_cost || 0)
  const revenueTotal = Number(selected?.revenue || 0)
  const revenueBySof = useMemo(() => {
    const sorted = sofRows.map(row => ({ label: row.sof_label || row.sof_key || 'Unassigned', value: Number(row.revenue || 0) }))
      .filter(row => row.value > 0).sort((a, b) => b.value - a.value)
    const top = sorted.slice(0, 4)
    const remainder = sorted.slice(4).reduce((sum, row) => sum + row.value, 0)
    if (remainder > 0) top.push({ label: 'Other SOFs', value: remainder })
    return top
  }, [sofRows])
  const riskProjects = [...sofRows].filter(row => Number(row.gross_profit || 0) < 0).sort((a, b) => Number(a.gross_profit || 0) - Number(b.gross_profit || 0)).slice(0, 5)
  return <Shell><div className="monitor-heading"><div><p className="monitor-eyebrow">FINANCIAL OPERATIONS</p><h1>Financial monitor</h1><p>Track revenue, delivery costs, and project margin by reporting period.</p></div><div className="monitor-period"><label>Year<select value={year} onChange={event => setYear(event.target.value)}>{years.map(value => <option key={value}>{value}</option>)}</select></label><label>Month<select value={month} onChange={event => setMonth(event.target.value)}>{yearMonths.map(value => <option key={value} value={value}>{monthName(value)}</option>)}</select></label></div></div>
    {problem && <div role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{problem}</div>}
    <div className="monitor-metrics">
      <Metric label="Recognized revenue" value={selected ? money(selected.revenue) : '—'} note={month ? monthName(month) : 'No reports available'} tone="green" />
      <Metric label="Total delivery cost" value={selected ? money(selected.total_cost) : '—'} note={`${money(selected?.materials)} materials · ${money(selected?.labor)} labor`} tone="blue" />
      <Metric label="Gross profit / (loss)" value={selected ? money(selected.gross_profit) : '—'} note={selected ? `${Number(selected.margin_pct || 0).toFixed(1)}% gross margin` : 'No report data'} tone={Number(selected?.gross_profit || 0) < 0 ? 'red' : 'green'} />
      <Metric label="Transactions" value={selected ? number(selected.transaction_count) : '—'} note={`${number(selected?.unassigned_count)} without SOF mapping`} tone={Number(selected?.unassigned_count || 0) ? 'red' : 'blue'} />
    </div>
    <div className="monitor-grid"><Card title="Revenue and cost trend" note={`Monthly performance in ${year || 'selected year'}`} className="monitor-trend-card">
      {loading ? <div className="py-20 text-center text-sm text-slate-500">Loading monthly totals…</div> : visibleReports.length ? <div className="monitor-chart">{visibleReports.map(row => <div key={row.month} className="monitor-chart-month"><div className="monitor-chart-bars"><div title={`Revenue ${money(row.revenue)}`} className="monitor-bar revenue" style={{ height: `${Math.max(2, Number(row.revenue || 0) / max * 100)}%` }} /><div title={`Cost ${money(row.total_cost)}`} className="monitor-bar cost" style={{ height: `${Math.max(2, Number(row.total_cost || 0) / max * 100)}%` }} /></div><span>{monthName(row.month).slice(0, 3)}</span></div>)}</div> : <div className="py-20 text-center text-sm text-slate-500">No reports found for this year.</div>}
      <div className="monitor-legend"><span><i className="revenue" />Revenue</span><span><i className="cost" />Cost</span></div>
    </Card><Card title="Revenue by SOF" note={month ? monthName(month) : 'No report selected'} className="monitor-donut-card"><DonutChart rows={revenueBySof} total={revenueTotal} emptyLabel="No revenue by SOF for this month." /></Card><Card title="COGS & operating cost breakdown" note={month ? `${monthName(month)} · QuickBooks account detail` : 'No report selected'} className="monitor-donut-card"><DonutChart rows={costMix.map(([label, value]) => ({ label, value: Number(value || 0) }))} total={totalCost} emptyLabel="No cost breakdown for this month." /><div className="mt-5 space-y-4 border-t border-slate-100 pt-4">{['Materials','Labor','Overhead','Other'].map(category => { const items = costAccounts.filter(row => row.category === category); const total = items.reduce((sum,row) => sum + Number(row.net_cost || 0),0); return <details key={category} className="group" open={category === 'Materials' || category === 'Labor'}><summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm [&::-webkit-details-marker]:hidden"><span className="font-semibold text-slate-700">{category} <span className="font-normal text-slate-400">({number(items.reduce((sum,row)=>sum+Number(row.transaction_count||0),0))} tx)</span></span><b className="tabular-nums text-slate-900">{money(total)}</b></summary><div className="mt-2 space-y-2 pl-3">{items.slice(0,6).map(row => <div key={row.account} className="flex items-start justify-between gap-3 text-xs"><span className="min-w-0 text-slate-500">{row.account} <span className="text-slate-400">· {number(row.transaction_count)} tx</span></span><b className="shrink-0 tabular-nums text-slate-700">{money(row.net_cost)}</b></div>)}{items.length > 6 && <p className="text-[11px] text-slate-400">Showing 6 of {number(items.length)} accounts</p>}</div></details>})}</div></Card></div>
    <div className="monitor-grid monitor-lower"><Card title="Projects to review" note="Projects with negative gross profit in the selected month">{riskProjects.length ? <div className="monitor-risk-list">{riskProjects.map((row, index) => <div key={row.sof_base || row.sof_key || index}><span><b>{row.project_group || row.sof_label || `SOF ${row.sof_base || 'Unassigned'}`}</b><small>SOF {row.sof_base || row.sof_key || '—'}</small></span><strong>{money(row.gross_profit)}</strong></div>)}</div> : <p className="monitor-empty">No negative margin projects for this report period.</p>}</Card></div>
  </Shell>
}

function Metric({ label, value, note, tone }) {
  return <div className={`monitor-metric ${tone}`}><div className="monitor-metric-label">{label}</div><div className="monitor-metric-value">{value}</div><div className="monitor-metric-note">{note}</div></div>
}

function dateInputValue(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function dateMinusDays(value, days) {
  const [year, month, day] = String(value || '').split('-').map(Number)
  if (!year || !month || !day) return ''
  const date = new Date(year, month - 1, day)
  date.setDate(date.getDate() - days)
  return dateInputValue(date)
}

function dateLabel(value) {
  if (!value) return '—'
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
}

const projectCost = row => Number(row.materials || 0) + Number(row.labor || 0) + Number(row.overhead || 0) + Number(row.other || 0)

function ProjectBars({ budget, actual }) {
  const max = Math.max(1, Number(budget || 0), Number(actual || 0))
  return <div className="space-y-3">
    {[{ label: 'Budget', value: Number(budget || 0), color: '#94a3b8' }, { label: 'Actual cost', value: Number(actual || 0), color: '#16876f' }].map(item => <div key={item.label}>
      <div className="mb-1 flex items-center justify-between gap-3 text-xs"><span className="font-medium text-slate-600">{item.label}</span><b className="tabular-nums text-slate-800">{money(item.value)}</b></div>
      <div className="h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${Math.max(item.value > 0 ? 1 : 0, item.value / max * 100)}%`, background: item.color }} /></div>
    </div>)}
  </div>
}

function ProjectAnalysis() {
  const [selectedDate, setSelectedDate] = useState(() => dateInputValue())
  const [projects, setProjects] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const startDate = useMemo(() => dateMinusDays(selectedDate, 14), [selectedDate])
  const rangeLabel = `${dateLabel(startDate)} – ${dateLabel(selectedDate)}`

  useEffect(() => {
    if (!selectedDate || !startDate) return
    let active = true
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const [refResult] = await Promise.all([
          supabase.from('income_reference_projects')
            .select('sof_base,sof_key,sof_number,project_name,construction_classification,contract_value,final_contract_value,materials_budget,labor_budget,overhead_budget,total_cost_budget')
            .limit(2000),
        ])
        if (refResult.error) throw refResult.error

        const transactions = []
        const pageSize = 1000
        for (let offset = 0; ; offset += pageSize) {
          const { data, error: txError } = await supabase.from('income_transactions_ready')
            .select('id,transaction_date,division,project_group,sof_label,sof_key,sof_base,category,debit,credit,account,type,num,name,memo')
            .gte('transaction_date', startDate)
            .lte('transaction_date', selectedDate)
            .order('transaction_date', { ascending: true })
            .range(offset, offset + pageSize - 1)
          if (txError) throw txError
          transactions.push(...(data || []))
          if (!data || data.length < pageSize) break
        }
        if (!active) return

        const refs = refResult.data || []
        const grouped = new Map()
        for (const tx of transactions) {
          const key = String(tx.sof_base || tx.sof_key || tx.project_group || 'Unassigned')
          const ref = refs.find(item =>
            (tx.sof_base && String(item.sof_base || '') === String(tx.sof_base)) ||
            (tx.sof_key && item.sof_key === tx.sof_key) ||
            (!tx.sof_base && !tx.sof_key && tx.project_group && item.project_name === tx.project_group)
          )
          const project = grouped.get(key) || {
            key,
            label: ref?.project_name || tx.project_group || tx.sof_label || 'Unassigned project',
            categoryLabel: categoryName(ref?.division || ref?.construction_classification || tx.division),
            budget: Number(ref?.total_cost_budget || 0),
            contractValue: Number(ref?.final_contract_value || ref?.contract_value || 0),
            revenue: 0, materials: 0, labor: 0, overhead: 0, other: 0, transactionCount: 0,
            accounts: new Map(), transactions: [],
          }
          const debit = Number(tx.debit || 0)
          const credit = Number(tx.credit || 0)
          if (tx.category === 'Revenue') project.revenue += credit - debit
          else {
            const cost = debit - credit
            if (tx.category === 'Materials') project.materials += cost
            else if (tx.category === 'Labor') project.labor += cost
            else if (tx.category === 'Overhead') project.overhead += cost
            else project.other += cost
            const account = tx.account || 'Unspecified'
            project.accounts.set(account, (project.accounts.get(account) || 0) + cost)
          }
          project.transactionCount += 1
          project.transactions.push({
            id: tx.id,
            date: tx.transaction_date,
            reference: tx.num || tx.sof_label || tx.sof_base || '—',
            description: tx.name || tx.memo || tx.type || tx.account || 'QuickBooks transaction',
            type: tx.type || '—',
            account: tx.account || '—',
            category: tx.category || '—',
            revenue: tx.category === 'Revenue' ? credit - debit : 0,
            cost: tx.category === 'Revenue' ? 0 : debit - credit,
          })
          grouped.set(key, project)
        }
        const rows = [...grouped.values()].map(project => {
          const actual = projectCost(project)
          return {
            ...project,
            actual,
            cogs: project.materials + project.labor,
            variance: project.budget > 0 ? project.budget - actual : null,
            grossProfit: project.revenue - actual,
            margin: project.revenue > 0 ? (project.revenue - actual) / project.revenue * 100 : null,
            accounts: [...project.accounts.entries()].map(([account, value]) => ({ account, value })).sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
            transactions: [...project.transactions].sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))),
          }
        })
        setProjects(rows)
      } catch (loadError) {
        if (active) setError(loadError?.message || 'Unable to load project activity for the selected date range.')
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [selectedDate, startDate])

  const categories = useMemo(() => {
    const map = new Map()
    for (const project of projects) {
      if (!map.has(project.categoryLabel)) map.set(project.categoryLabel, { name: project.categoryLabel, projects: [], revenue: 0, actual: 0, budget: 0, cogs: 0 })
      const group = map.get(project.categoryLabel)
      group.projects.push(project)
      group.revenue += project.revenue
      group.actual += project.actual
      group.budget += project.budget
      group.cogs += project.cogs
    }
    const order = ['Supply', 'Eworks', 'Servicing', 'Civil Works', 'Uncategorized']
    return order.map(name => map.get(name) || { name, projects: [], revenue: 0, actual: 0, budget: 0, cogs: 0 })
  }, [projects])

  const totals = useMemo(() => projects.reduce((acc, project) => ({
    revenue: acc.revenue + project.revenue,
    actual: acc.actual + project.actual,
    budget: acc.budget + project.budget,
    cogs: acc.cogs + project.cogs,
  }), { revenue: 0, actual: 0, budget: 0, cogs: 0 }), [projects])
  const variance = totals.budget > 0 ? totals.budget - totals.actual : null

  return <Shell page="projects">
    <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">Project monitoring</p><h1 className="mt-1 text-2xl font-semibold text-slate-950">Project Analysis</h1><p className="mt-1 text-sm text-slate-500">Review actual project activity over the 14 days leading up to your selected date.</p></div>
      <label className="block text-xs font-semibold text-slate-500">Analysis date
        <input type="date" value={selectedDate} onChange={event => setSelectedDate(event.target.value)} className="mt-1 block min-w-[190px] rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-800" />
        <span className="mt-1 block font-normal text-slate-400">Coverage: {rangeLabel}</span>
      </label>
    </div>
    {error && <div role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
    <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Project revenue" value={money(totals.revenue)} note={rangeLabel} tone="green" />
      <Metric label="Actual project cost" value={money(totals.actual)} note="Materials, labor, overhead and other" tone="blue" />
      <Metric label="COGS" value={money(totals.cogs)} note="Materials + labor" tone="blue" />
      <Metric label="Budget variance" value={variance == null ? '—' : money(variance)} note={variance == null ? 'No project cost budgets mapped' : variance >= 0 ? 'Remaining budget' : 'Over budget'} tone={variance != null && variance < 0 ? 'red' : 'green'} />
    </div>
    {loading ? <div className="rounded-xl border border-emerald-100 bg-white p-8 text-center text-sm text-slate-500">Loading project activity…</div> : <div className="space-y-4">
      {projects.length > 0 && <Card title="Portfolio cost vs budget" note={`Actual project costs compared with mapped total cost budgets · ${rangeLabel}`}>
        <ProjectBars budget={totals.budget} actual={totals.actual} />
        <div className="mt-4 grid gap-3 text-xs text-slate-500 sm:grid-cols-3"><span>Revenue <b className="text-slate-800">{money(totals.revenue)}</b></span><span>COGS <b className="text-slate-800">{money(totals.cogs)}</b></span><span>Projects <b className="text-slate-800">{number(projects.length)}</b></span></div>
      </Card>}
      {categories.map(category => <section key={category.name} className="overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-emerald-50 px-4 py-4">
          <div><h2 className="font-semibold text-emerald-950">{category.name}</h2><p className="mt-1 text-xs text-slate-500">{number(category.projects.length)} projects · {rangeLabel}</p></div>
          <div className="flex flex-wrap gap-4 text-right text-xs"><span><b className="block text-emerald-800">{money(category.revenue)}</b>Revenue</span><span><b className="block text-blue-800">{money(category.actual)}</b>Actual cost</span><span><b className="block text-slate-700">{money(category.cogs)}</b>COGS</span></div>
        </div>
        {category.projects.length ? <div className="divide-y divide-slate-100">{[...category.projects].sort((a, b) => a.label.localeCompare(b.label)).map(project => <details key={project.key} className="group">
          <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-4 py-4 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
            <div className="flex min-w-0 items-center gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700 transition-transform group-open:rotate-90">›</span><div className="min-w-0"><b className="block truncate text-sm text-slate-800">{project.label}</b><span className="text-xs text-slate-500">SOF {project.key} · {number(project.transactionCount)} transactions</span></div></div>
            <div className="grid grid-cols-2 gap-x-5 gap-y-1 text-right text-xs sm:grid-cols-4"><span><b className="block text-slate-800">{money(project.revenue)}</b>Revenue</span><span><b className="block text-slate-800">{money(project.actual)}</b>Actual cost</span><span><b className="block text-slate-800">{money(project.cogs)}</b>COGS</span><span><b className={`block ${project.variance != null && project.variance < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{project.variance == null ? '—' : money(project.variance)}</b>Variance</span></div>
          </summary>
          <div className="grid gap-4 border-t border-slate-100 bg-slate-50/60 p-4 lg:grid-cols-2">
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-xs text-slate-500">Actual project cost</p><b className="mt-1 block text-lg text-slate-900">{money(project.actual)}</b></div><div className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-xs text-slate-500">Budget variance</p><b className={`mt-1 block text-lg ${project.variance != null && project.variance < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{project.variance == null ? 'No budget' : money(project.variance)}</b><p className="mt-1 text-[11px] text-slate-400">{project.variance == null ? 'No mapped budget available' : project.variance >= 0 ? 'Under budget' : 'Over budget'}</p></div></div>
              <div className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="mb-3 text-sm font-semibold text-slate-800">Budget vs actual</h3><ProjectBars budget={project.budget} actual={project.actual} /></div>
              <div className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="mb-3 text-sm font-semibold text-slate-800">Cost breakdown</h3>
                {[['Materials', project.materials], ['Labor', project.labor], ['Overhead', project.overhead], ['Other / unmapped', project.other]].map(([label, value], index) => <div key={label} className="mb-3 last:mb-0"><div className="mb-1 flex justify-between gap-3 text-xs"><span className="text-slate-600">{label}</span><b className="text-slate-800">{money(value)}</b></div><div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full" style={{ width: `${project.actual > 0 ? Math.max(0, Number(value) / project.actual * 100) : 0}%`, background: ['#16876f', '#397da3', '#d7973e', '#bd6670'][index] }} /></div></div>)}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="mb-3 text-sm font-semibold text-slate-800">Cost by QuickBooks account</h3>{project.accounts.length ? <div className="space-y-3">{project.accounts.slice(0, 8).map(account => <div key={account.account}><div className="mb-1 flex justify-between gap-3 text-xs"><span className="min-w-0 truncate text-slate-600">{account.account}</span><b className="shrink-0 text-slate-800">{money(account.value)}</b></div><div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-indigo-500" style={{ width: `${project.actual > 0 ? Math.max(0, account.value / project.actual * 100) : 0}%` }} /></div></div>)}</div> : <p className="text-sm text-slate-500">No cost transactions in this date range.</p>}
              <div className="mt-5 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2"><div><p className="text-xs text-slate-500">Gross profit / (loss)</p><b className={`mt-1 block text-base ${project.grossProfit < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{money(project.grossProfit)}</b></div><div><p className="text-xs text-slate-500">Gross margin</p><b className="mt-1 block text-base text-slate-900">{project.margin == null ? '—' : `${project.margin.toFixed(1)}%`}</b></div></div>
              <details className="mt-5 rounded-xl border border-slate-200 bg-white" open><summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-slate-800 [&::-webkit-details-marker]:hidden"><span>Actual transactions</span><span className="text-xs font-medium text-slate-500">{number(project.transactions.length)} records · dated</span></summary><div className="max-h-[420px] overflow-auto border-t border-slate-100"><table className="w-full min-w-[760px] text-left text-xs"><thead className="sticky top-0 bg-slate-50 text-slate-500"><tr>{['Actual date','Description / payee','QB account','Type','Revenue','Cost'].map(label => <th key={label} className="whitespace-nowrap px-3 py-2 font-semibold">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{project.transactions.map((tx,index) => <tr key={tx.id || `${tx.date}-${tx.reference}-${index}`}><td className="whitespace-nowrap px-3 py-2 font-medium text-slate-700">{dateLabel(tx.date)}</td><td className="max-w-[260px] px-3 py-2"><div className="truncate text-slate-700" title={tx.description}>{tx.description}</div><div className="text-[10px] text-slate-400">{tx.reference} · {tx.category}</div></td><td className="max-w-[190px] truncate px-3 py-2 text-slate-600" title={tx.account}>{tx.account}</td><td className="whitespace-nowrap px-3 py-2 text-slate-500">{tx.type}</td><td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{tx.revenue ? money(tx.revenue) : '—'}</td><td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{tx.cost ? money(tx.cost) : '—'}</td></tr>)}</tbody></table>{!project.transactions.length && <p className="p-4 text-sm text-slate-500">No transaction details available for this project.</p>}</div></details>
            </div>
          </div>
        </details>)}</div> : <div className="px-4 py-4 text-xs text-slate-500">No project transactions recorded in this 14-day window.</div>}
      </section>)}
      {!projects.length && <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">No project transactions found from {rangeLabel}.</div>}
    </div>}
  </Shell>
}

function TransactionDetails() {
  const [rows, setRows] = useState([])
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const pageSize = 50
  useEffect(() => {
    let active = true
    let query = supabase.from('income_transactions_ready').select('transaction_date,division,project_group,sof_label,sof_base,type,name,memo,account,debit,credit,category', { count: 'exact' }).order('transaction_date', { ascending: false }).range(page * pageSize, page * pageSize + pageSize - 1)
    if (search.trim()) query = query.or(`sof_label.ilike.%${search.trim()}%,project_group.ilike.%${search.trim()}%,account.ilike.%${search.trim()}%,memo.ilike.%${search.trim()}%`)
    query.then(({ data, count: total, error: e }) => { if (!active) return; if (e) setError(e.message); else { setRows(data || []); setCount(total || 0); setError('') } })
    return () => { active = false }
  }, [page, search])
  useEffect(() => setPage(0), [search])
  return <Shell page="transactions"><div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="text-2xl font-semibold text-slate-950">Transaction Details</h1><p className="mt-1 text-sm text-slate-500">QuickBooks sales and cost transactions.</p></div><label className="text-xs font-semibold text-slate-500">Search transactions<input value={search} onChange={e => setSearch(e.target.value)} placeholder="SOF, project, account…" className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 sm:w-72" /></label></div>
    {error && <div role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
    <div className="overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm"><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-[#173b68] text-xs uppercase text-white"><tr>{['Date','Category','Project / SOF','Type','Account','Sales','Cost'].map(x => <th key={x} className="px-3 py-3">{x}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{rows.map((row,index) => <tr key={`${row.transaction_date}-${row.sof_key}-${index}`}><td className="whitespace-nowrap px-3 py-3">{shortDate(row.transaction_date)}</td><td className="px-3 py-3">{categoryName(row.division)}</td><td className="px-3 py-3"><div className="font-medium">{row.project_group || '—'}</div><div className="text-xs text-slate-500">{row.sof_label || 'Unassigned'}</div></td><td className="px-3 py-3">{row.type || '—'}</td><td className="px-3 py-3">{row.account || '—'}</td><td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{row.category === 'Revenue' ? money(Number(row.credit || 0) - Number(row.debit || 0)) : '—'}</td><td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{txCost(row) ? money(txCost(row)) : '—'}</td></tr>)}</tbody></table>{!rows.length && !error && <div className="p-8 text-center text-sm text-slate-500">No transactions found.</div>}</div><div className="flex items-center justify-between gap-3 border-t border-slate-100 p-3 text-sm text-slate-500"><span>{count ? `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, count)} of ${number(count)}` : '0 records'}</span><div className="flex items-center gap-2"><button disabled={!page} onClick={() => setPage(x => x - 1)} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">Previous</button><button disabled={(page + 1) * pageSize >= count} onClick={() => setPage(x => x + 1)} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">Next</button></div></div></div>
  </Shell>
}

export default function FinanceWorkspace() {
  const page = (location.hash || '#/dashboard').replace(/^#\/?/, '')
  if (page === 'projects') return <ProjectAnalysis />
  if (page === 'transactions') return <TransactionDetails />
  return <MainDashboard />
}
