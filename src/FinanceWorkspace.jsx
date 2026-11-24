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
    // This screen only needs the available month keys. The all-period dashboard
    // RPC also builds every SOF/account aggregate, which can exceed the DB
    // statement timeout on a large transaction history.
    const loadMonths = async () => {
      const dates = []
      const pageSize = 1000
      try {
        for (let offset = 0; ; offset += pageSize) {
          const { data, error: queryError } = await supabase.from('income_transactions_ready')
            .select('transaction_date')
            .not('transaction_date', 'is', null)
            .order('transaction_date', { ascending: false })
            .range(offset, offset + pageSize - 1)
          if (!active) return
          if (queryError) { setError(queryError.message); return }
          dates.push(...(data || []).map(row => row.transaction_date))
          if (!data || data.length < pageSize) break
        }
        setMonths([...new Set(dates.map(date => date?.slice(0, 7)).filter(Boolean))])
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
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    if (!selectedMonths.length) { setReports([]); setLoading(false); return }
    setLoading(true)
    Promise.all(selectedMonths.map(month => supabase.rpc('income_monthly_report', { p_month: `${month}-01` })))
      .then(results => {
        if (!active) return
        const failed = results.find(result => result.error)
        if (failed) setError(failed.error.message)
        else { setError(''); setReports(results.map((result, i) => ({ month: selectedMonths[i], ...(result.data || {}) }))) }
        setLoading(false)
      })
    return () => { active = false }
  }, [selectedMonths])
  useEffect(() => {
    let active = true
    if (!month) { setSofRows([]); return }
    supabase.rpc('income_monthly_sof_summary', { p_month: `${month}-01` }).then(({ data, error: e }) => {
      if (!active) return
      if (e) setError(e.message)
      else setSofRows(data || [])
    })
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
      <Metric label="Active SOFs" value={selected ? number(selected.unique_sof) : '—'} note={`${number(selected?.unassigned_count)} transactions without SOF`} tone={Number(selected?.unassigned_count || 0) ? 'red' : 'blue'} />
    </div>
    <div className="monitor-grid"><Card title="Revenue and cost trend" note={`Monthly performance in ${year || 'selected year'}`} className="monitor-trend-card">
      {loading ? <div className="py-20 text-center text-sm text-slate-500">Loading monthly totals…</div> : visibleReports.length ? <div className="monitor-chart">{visibleReports.map(row => <div key={row.month} className="monitor-chart-month"><div className="monitor-chart-bars"><div title={`Revenue ${money(row.revenue)}`} className="monitor-bar revenue" style={{ height: `${Math.max(2, Number(row.revenue || 0) / max * 100)}%` }} /><div title={`Cost ${money(row.total_cost)}`} className="monitor-bar cost" style={{ height: `${Math.max(2, Number(row.total_cost || 0) / max * 100)}%` }} /></div><span>{monthName(row.month).slice(0, 3)}</span></div>)}</div> : <div className="py-20 text-center text-sm text-slate-500">No reports found for this year.</div>}
      <div className="monitor-legend"><span><i className="revenue" />Revenue</span><span><i className="cost" />Cost</span></div>
    </Card><Card title="Revenue by SOF" note={month ? monthName(month) : 'No report selected'} className="monitor-donut-card"><DonutChart rows={revenueBySof} total={revenueTotal} emptyLabel="No revenue by SOF for this month." /></Card><Card title="Cost breakdown" note={month ? monthName(month) : 'No report selected'} className="monitor-donut-card"><DonutChart rows={costMix.map(([label, value]) => ({ label, value: Number(value || 0) }))} total={totalCost} emptyLabel="No cost breakdown for this month." /></Card></div>
    <div className="monitor-grid monitor-lower"><Card title="Projects to review" note="Projects with negative gross profit in the selected month">{riskProjects.length ? <div className="monitor-risk-list">{riskProjects.map((row, index) => <div key={row.sof_base || row.sof_key || index}><span><b>{row.project_group || row.sof_label || `SOF ${row.sof_base || 'Unassigned'}`}</b><small>SOF {row.sof_base || row.sof_key || '—'}</small></span><strong>{money(row.gross_profit)}</strong></div>)}</div> : <p className="monitor-empty">No negative margin projects for this report period.</p>}</Card><Card title="Monitoring notes" note="Items that may need attention"><div className="monitor-notes">{Number(selected?.unassigned_count) > 0 && <p className="attention"><b>{number(selected.unassigned_count)} unassigned transactions</b><span>Review SOF mappings before month end.</span></p>}{Number(selected?.gross_profit) < 0 && <p className="attention"><b>Period gross loss</b><span>Costs exceed recognized revenue in this month.</span></p>}{selected && Number(selected.unassigned_count || 0) === 0 && Number(selected.gross_profit || 0) >= 0 && <p className="positive"><b>Reporting looks on track</b><span>No unassigned transactions or gross loss in this period.</span></p>}{!selected && <p className="monitor-empty">Choose a year and month with a report.</p>}</div></Card></div>
  </Shell>
}

function Metric({ label, value, note, tone }) {
  return <div className={`monitor-metric ${tone}`}><div className="monitor-metric-label">{label}</div><div className="monitor-metric-value">{value}</div><div className="monitor-metric-note">{note}</div></div>
}

function ProjectAnalysis() {
  const { months, error: monthsError } = useMonths()
  const [month, setMonth] = useState('')
  const [projects, setProjects] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => { if (months.length && !month) setMonth(months[0]) }, [months, month])
  useEffect(() => {
    if (!month) return
    let active = true
    setLoading(true)
    Promise.all([
      supabase.rpc('income_monthly_project_summary', { p_month: `${month}-01` }),
      supabase.from('income_reference_projects').select('sof_base,sof_key,sof_number,project_name').limit(2000),
    ]).then(([result, refResult]) => {
      if (!active) return
      if (result.error || refResult.error) setError(result.error?.message || refResult.error?.message)
      else {
        const refs = refResult.data || []
        const projectRows = (result.data || []).map(row => {
          const ref = refs.find(item => String(item.sof_base || '') === String(row.sof_base || '') || (item.sof_key && item.sof_key === row.sof_key))
          return { ...row, categoryLabel: categoryName(row.division), projectName: ref?.project_name || row.project_group || 'Project name unavailable' }
        })
        setProjects(projectRows); setError('')
      }
      setLoading(false)
    })
    return () => { active = false }
  }, [month])
  const categories = useMemo(() => {
    const map = new Map()
    for (const item of projects) {
      if (!map.has(item.categoryLabel)) map.set(item.categoryLabel, { name: item.categoryLabel, projects: new Map(), revenue: 0, cost: 0 })
      const group = map.get(item.categoryLabel)
      const key = item.sof_base || item.sof_key || item.project_group || 'Unassigned'
      const project = group.projects.get(key) || { key, label: item.projectName, revenue: 0, cost: 0 }
      project.revenue += Number(item.revenue || 0); project.cost += Number(item.total_cost || 0)
      group.projects.set(key, project); group.revenue += Number(item.revenue || 0); group.cost += Number(item.total_cost || 0)
    }
    const order = ['Supply', 'Eworks', 'Servicing', 'Civil Works', 'Uncategorized']
    return order.map(name => map.get(name) || { name, projects: new Map(), revenue: 0, cost: 0 })
  }, [projects])
  return <Shell page="projects"><div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="text-2xl font-semibold text-slate-950">Project Analysis</h1><p className="mt-1 text-sm text-slate-500">Monthly sales and costs by category, project, and SOF.</p></div><label className="text-xs font-semibold text-slate-500">Report month<select value={month} onChange={e => setMonth(e.target.value)} className="mt-1 block rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800">{months.map(value => <option value={value} key={value}>{monthName(value)}</option>)}</select></label></div>
    {(error || monthsError) && <div role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error || monthsError}</div>}
    {loading ? <div className="rounded-xl border border-emerald-100 bg-white p-8 text-center text-sm text-slate-500">Loading project analysis…</div> : <div className="space-y-4">{categories.map(category => <details key={category.name} open={category.projects.size > 0} className="overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm"><summary className="cursor-pointer list-none bg-emerald-50 px-4 py-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-emerald-950">{category.name}</h2><p className="mt-1 text-xs text-slate-500">{number(category.projects.size)} projects · {monthName(month)}</p></div><div className="flex gap-5 text-right text-xs"><span><b className="block text-emerald-800">{money(category.revenue)}</b>Sales</span><span><b className="block text-blue-800">{money(category.cost)}</b>Costs</span></div></div></summary>{category.projects.size ? <div className="divide-y divide-slate-100">{[...category.projects.values()].sort((a,b) => a.label.localeCompare(b.label)).map(project => <div key={project.key} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_150px_150px]"><div className="min-w-0"><b className="block truncate text-sm text-slate-800">{project.label}</b><span className="text-xs text-slate-500">SOF {project.key}</span></div><div className="text-sm sm:text-right"><span className="mr-2 text-xs text-slate-500 sm:hidden">Sales</span>{money(project.revenue)}</div><div className="text-sm sm:text-right"><span className="mr-2 text-xs text-slate-500 sm:hidden">Cost</span>{money(project.cost)}</div></div>)}</div> : <div className="px-4 py-3 text-xs text-slate-500">No project transactions recorded for this month.</div>}</details>)}</div>}
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
