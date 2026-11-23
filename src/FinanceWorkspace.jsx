import React, { useEffect, useMemo, useState } from 'react'
import { money, number, shortDate, supabase } from './lib.js'

const NAV = [['dashboard', 'Main Dashboard'], ['projects', 'Project Analysis'], ['transactions', 'Transaction Details']]
const go = page => { location.hash = `#/${page}` }
const monthName = value => value ? new Date(`${value}-01T00:00:00`).toLocaleDateString('en-PH', { month: 'short', year: 'numeric' }) : 'â€”'
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

function Shell({ page, children }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const close = () => setOpen(false)
    addEventListener('hashchange', close)
    return () => removeEventListener('hashchange', close)
  }, [])
  return <div className="min-h-screen bg-[#f2f8f4] md:flex">
    {open && <button aria-label="Close navigation" onClick={() => setOpen(false)} className="fixed inset-0 z-40 bg-slate-950/35 md:hidden" />}
    <aside className={`${open ? 'translate-x-0' : '-translate-x-full'} fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-[#173b68] p-4 text-white shadow-xl transition-transform md:static md:h-screen md:w-60 md:shrink-0 md:translate-x-0 md:shadow-none`}>
      <button onClick={() => go('dashboard')} className="mb-8 flex items-center gap-3 px-2 pt-2 text-left"><span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-400 text-lg font-bold text-[#12345c]">G</span><span><b className="block text-sm">GREENLIGHT POWER</b><span className="text-xs text-blue-100/70">Income Report</span></span></button>
      <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[.16em] text-blue-100/55">Reports</div>
      <nav className="space-y-1">{NAV.map(([id, label]) => <button key={id} onClick={() => go(id)} className={`w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${page === id ? 'bg-emerald-400 text-[#12345c]' : 'text-blue-50/80 hover:bg-white/10 hover:text-white'}`}>{label}</button>)}</nav>
      <div className="mt-auto rounded-xl border border-white/10 bg-white/5 p-3 text-xs leading-5 text-blue-50/70">QuickBooks sales and cost reporting</div>
    </aside>
    <div className="min-w-0 flex-1">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-emerald-100 bg-white/95 px-4 backdrop-blur md:hidden"><button aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} onClick={() => setOpen(x => !x)} className="grid h-9 w-9 place-items-center rounded-lg border border-emerald-100 text-[#173b68]">{open ? 'Ã—' : 'â˜°'}</button><span className="text-sm font-semibold">GREENLIGHT POWER</span></header>
      <main className="mx-auto w-full max-w-[1500px] p-4 lg:p-6 xl:p-8">{children}</main>
    </div>
  </div>
}

function Card({ title, note, children, className = '' }) {
  return <section className={`min-w-0 rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm ${className}`}><div className="mb-4"><h2 className="font-semibold text-slate-900">{title}</h2>{note && <p className="mt-1 text-xs text-slate-500">{note}</p>}</div>{children}</section>
}

function useMonths() {
  const [months, setMonths] = useState([])
  const [error, setError] = useState('')
  useEffect(() => {
    supabase.rpc('income_dashboard_filtered', { p_month: null, p_sof_base: null }).then(({ data, error: e }) => {
      if (e) setError(e.message)
      else setMonths(data?.months || [])
    })
  }, [])
  return { months, error }
}

function MainDashboard() {
  const { months, error: monthsError } = useMonths()
  const selectedMonths = useMemo(() => months.slice(0, 12).reverse(), [months])
  const [reports, setReports] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    if (!selectedMonths.length) { setReports([]); setLoading(false); return }
    setLoading(true)
    Promise.all(selectedMonths.map(month => supabase.rpc('income_dashboard_filtered', { p_month: `${month}-01`, p_sof_base: null })))
      .then(results => {
        if (!active) return
        const failed = results.find(result => result.error)
        if (failed) setError(failed.error.message)
        else { setError(''); setReports(results.map((result, i) => ({ month: selectedMonths[i], ...(result.data?.report || {}) }))) }
        setLoading(false)
      })
    return () => { active = false }
  }, [selectedMonths])
  const latest = reports[reports.length - 1]
  const max = Math.max(1, ...reports.flatMap(row => [Number(row.revenue || 0), Number(row.total_cost || 0)]))
  const problem = error || monthsError
  return <Shell page="dashboard"><div className="mb-6"><h1 className="text-2xl font-semibold text-slate-950">Main Dashboard</h1><p className="mt-1 text-sm text-slate-500">Monthly sales and costs from QuickBooks.</p></div>
    {problem && <div role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{problem}</div>}
    <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <Metric label="Latest Month Sales" value={latest ? money(latest.revenue) : 'â€”'} note={latest ? monthName(latest.month) : 'No monthly data'} tone="green" />
      <Metric label="Latest Month Costs" value={latest ? money(latest.total_cost) : 'â€”'} note={latest ? monthName(latest.month) : 'No monthly data'} tone="blue" />
      <Metric label="Gross Profit / (Loss)" value={latest ? money(latest.gross_profit) : 'â€”'} note={latest ? `${Number(latest.margin_pct || 0).toFixed(1)}% gross margin` : 'No monthly data'} tone={Number(latest?.gross_profit || 0) < 0 ? 'red' : 'green'} />
    </div>
    <Card title="Money Flow" note="Sales and recorded cost by month" className="min-h-[360px]">
      {loading ? <div className="py-20 text-center text-sm text-slate-500">Loading monthly totalsâ€¦</div> : reports.length ? <div className="flex h-64 items-end gap-3 overflow-x-auto border-b border-slate-100 px-2 pt-4 sm:gap-5">{reports.map(row => <div key={row.month} className="flex h-full min-w-12 flex-1 flex-col items-center justify-end gap-2"><div className="flex h-full w-full items-end justify-center gap-1.5"><div title={`Sales ${money(row.revenue)}`} className="w-3 rounded-t-md bg-emerald-500 sm:w-5" style={{ height: `${Math.max(2, Number(row.revenue || 0) / max * 90)}%` }} /><div title={`Cost ${money(row.total_cost)}`} className="w-3 rounded-t-md bg-blue-600 sm:w-5" style={{ height: `${Math.max(2, Number(row.total_cost || 0) / max * 90)}%` }} /></div><span className="whitespace-nowrap text-[10px] text-slate-500">{monthName(row.month)}</span></div>)}</div> : <div className="py-20 text-center text-sm text-slate-500">No transactions found.</div>}
      <div className="mt-4 flex items-center gap-5 text-xs text-slate-600"><span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-emerald-500" />Sales</span><span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-blue-600" />Costs</span></div>
    </Card>
  </Shell>
}

function Metric({ label, value, note, tone }) {
  const classes = tone === 'blue' ? 'border-blue-200 bg-blue-50 text-blue-800' : tone === 'red' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'
  return <div className={`rounded-2xl border p-4 ${classes}`}><div className="text-xs font-semibold uppercase tracking-wide opacity-75">{label}</div><div className="mt-2 break-words text-xl font-bold tabular-nums">{value}</div><div className="mt-1 text-xs opacity-70">{note}</div></div>
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
    {loading ? <div className="rounded-xl border border-emerald-100 bg-white p-8 text-center text-sm text-slate-500">Loading project analysisâ€¦</div> : <div className="space-y-4">{categories.map(category => <details key={category.name} open={category.projects.size > 0} className="overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm"><summary className="cursor-pointer list-none bg-emerald-50 px-4 py-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-emerald-950">{category.name}</h2><p className="mt-1 text-xs text-slate-500">{number(category.projects.size)} projects Â· {monthName(month)}</p></div><div className="flex gap-5 text-right text-xs"><span><b className="block text-emerald-800">{money(category.revenue)}</b>Sales</span><span><b className="block text-blue-800">{money(category.cost)}</b>Costs</span></div></div></summary>{category.projects.size ? <div className="divide-y divide-slate-100">{[...category.projects.values()].sort((a,b) => a.label.localeCompare(b.label)).map(project => <div key={project.key} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_150px_150px]"><div className="min-w-0"><b className="block truncate text-sm text-slate-800">{project.label}</b><span className="text-xs text-slate-500">SOF {project.key}</span></div><div className="text-sm sm:text-right"><span className="mr-2 text-xs text-slate-500 sm:hidden">Sales</span>{money(project.revenue)}</div><div className="text-sm sm:text-right"><span className="mr-2 text-xs text-slate-500 sm:hidden">Cost</span>{money(project.cost)}</div></div>)}</div> : <div className="px-4 py-3 text-xs text-slate-500">No project transactions recorded for this month.</div>}</details>)}</div>}
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
  return <Shell page="transactions"><div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="text-2xl font-semibold text-slate-950">Transaction Details</h1><p className="mt-1 text-sm text-slate-500">QuickBooks sales and cost transactions.</p></div><label className="text-xs font-semibold text-slate-500">Search transactions<input value={search} onChange={e => setSearch(e.target.value)} placeholder="SOF, project, accountâ€¦" className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 sm:w-72" /></label></div>
    {error && <div role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
    <div className="overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm"><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-[#173b68] text-xs uppercase text-white"><tr>{['Date','Category','Project / SOF','Type','Account','Sales','Cost'].map(x => <th key={x} className="px-3 py-3">{x}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{rows.map((row,index) => <tr key={`${row.transaction_date}-${row.sof_key}-${index}`}><td className="whitespace-nowrap px-3 py-3">{shortDate(row.transaction_date)}</td><td className="px-3 py-3">{categoryName(row.division)}</td><td className="px-3 py-3"><div className="font-medium">{row.project_group || 'â€”'}</div><div className="text-xs text-slate-500">{row.sof_label || 'Unassigned'}</div></td><td className="px-3 py-3">{row.type || 'â€”'}</td><td className="px-3 py-3">{row.account || 'â€”'}</td><td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{row.category === 'Revenue' ? money(Number(row.credit || 0) - Number(row.debit || 0)) : 'â€”'}</td><td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{txCost(row) ? money(txCost(row)) : 'â€”'}</td></tr>)}</tbody></table>{!rows.length && !error && <div className="p-8 text-center text-sm text-slate-500">No transactions found.</div>}</div><div className="flex items-center justify-between gap-3 border-t border-slate-100 p-3 text-sm text-slate-500"><span>{count ? `${page * pageSize + 1}â€“${Math.min((page + 1) * pageSize, count)} of ${number(count)}` : '0 records'}</span><div className="flex items-center gap-2"><button disabled={!page} onClick={() => setPage(x => x - 1)} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">Previous</button><button disabled={(page + 1) * pageSize >= count} onClick={() => setPage(x => x + 1)} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">Next</button></div></div></div>
  </Shell>
}

export default function FinanceWorkspace() {
  const page = (location.hash || '#/dashboard').replace(/^#\/?/, '')
  if (page === 'projects') return <ProjectAnalysis />
  if (page === 'transactions') return <TransactionDetails />
  return <MainDashboard />
}
