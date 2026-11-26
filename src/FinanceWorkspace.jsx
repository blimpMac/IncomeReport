import React, { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { money, number, shortDate, supabase } from './lib.js'

const monthName = value => value ? new Date(`${value}-01T00:00:00`).toLocaleDateString('en-PH', { month: 'short', year: 'numeric' }) : '—'
const categoryName = value => {
  const key = String(value || '').toUpperCase().replace(/[\s_-]+/g, '')
  if (key.includes('SUPPLY')) return 'Supply'
  if (key.includes('SERVIC')) return 'Service'
  if (key.includes('CIVIL')) return 'Civil'
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

function useMonths(company = 'Greenlight Power Inc.') {
  const [months, setMonths] = useState([])
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    // Reporting periods come from upload metadata, not a full scan of the
    // transaction view. This avoids loading thousands of transaction rows
    // just to populate the Year/Month selectors.
    const loadMonths = async () => {
      try {
        const uploads = []
        const pageSize = 1000
        for (let offset = 0; ; offset += pageSize) {
          const { data, error: queryError } = await supabase.from('income_qb_uploads')
            .select('detected_min_date,detected_max_date,status')
            .eq('status', 'ready')
            .eq('company', company)
            .order('created_at', { ascending: true })
            .range(offset, offset + pageSize - 1)
          if (queryError) throw queryError
          uploads.push(...(data || []))
          if (!data || data.length < pageSize) break
        }
        if (!active) return
        const available = new Set()
        for (const upload of uploads) {
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
  }, [company])
  return { months, error }
}

function MainDashboard() {
  const { months, error: monthsError } = useMonths()
  const years = useMemo(() => [...new Set(months.map(month => month.slice(0, 4)))], [months])
  const [year, setYear] = useState('')
  const [month, setMonth] = useState('')
  const [monitorCategory, setMonitorCategory] = useState('all')
  useEffect(() => {
    if (years.length && year !== 'all' && !years.includes(year)) setYear(years[0])
    if (!years.length) setYear('')
  }, [years, year])
  // "All years" includes every available reporting month while keeping the
  // month selector and the month-specific KPI cards usable.
  const yearMonths = useMemo(() => year === 'all' ? months : months.filter(value => value.startsWith(year)), [months, year])
  useEffect(() => { if (month !== '__year_total__' && !yearMonths.includes(month)) setMonth(yearMonths[0] || '') }, [yearMonths, month])
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
          const { data, error: reportError } = await supabase.rpc('income_financial_monitor_month', { p_month: `${reportMonth}-01`, p_company: 'Greenlight Power Inc.', p_category: monitorCategory })
          if (!active) return
          if (reportError) throw reportError
          nextReports.push({ month: reportMonth, ...(data?.report || {}) })
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
  }, [selectedMonths, monitorCategory])
  useEffect(() => {
    let active = true
    if (!month || month === '__year_total__') { setSofRows([]); setCostAccounts([]); return }
    supabase.rpc('income_financial_monitor_month', { p_month: `${month}-01`, p_company: 'Greenlight Power Inc.', p_category: monitorCategory })
      .then(({ data, error: queryError }) => {
        if (!active) return
        if (queryError) setError(queryError.message)
        else { setSofRows(data?.sof_rows || []); setCostAccounts(data?.cost_accounts || []) }
      }).catch(e => { if (active) setError(e?.message || 'Unable to load transaction breakdown.') })
    return () => { active = false }
  }, [month, monitorCategory])
  const visibleReports = year === 'all' ? reports : reports.filter(row => row.month.startsWith(year))
  const annualRows = visibleReports
  const annualTotal = month === '__year_total__' ? annualRows.reduce((total, row) => {
    for (const key of ['revenue', 'total_cost', 'gross_profit', 'transaction_count', 'unassigned_count', 'materials', 'labor', 'overhead', 'other_cost']) total[key] = Number(total[key] || 0) + Number(row[key] || 0)
    return total
  }, { revenue: 0, total_cost: 0, gross_profit: 0, transaction_count: 0, unassigned_count: 0, materials: 0, labor: 0, overhead: 0, other_cost: 0 }) : null
  if (annualTotal) annualTotal.margin_pct = annualTotal.revenue ? annualTotal.gross_profit / annualTotal.revenue * 100 : 0
  const selected = annualTotal || reports.find(row => row.month === month)
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
  return <Shell><div className="monitor-heading"><div><p className="monitor-eyebrow">FINANCIAL OPERATIONS</p><h1>Financial monitor</h1><p>Track revenue, delivery costs, and project margin by reporting period.</p></div><div className="monitor-period"><label>Year<select value={year} onChange={event => setYear(event.target.value)}><option value="all">All years</option>{years.map(value => <option key={value} value={value}>{value}</option>)}</select></label><label>Period<select value={month} onChange={event => setMonth(event.target.value)}><option value="__year_total__">{year === 'all' ? 'All years total' : `${year} total`}</option>{yearMonths.map(value => <option key={value} value={value}>{monthName(value)}</option>)}</select></label><label>Category<select value={monitorCategory} onChange={event => setMonitorCategory(event.target.value)}><option value="all">All categories</option><option value="Eworks">Eworks</option><option value="Supply">Supply</option><option value="Service">Service</option><option value="Civil">Civil</option></select></label></div></div>
    {problem && <div role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{problem}</div>}
    <div className="monitor-metrics">
      <Metric label="Recognized revenue" value={selected ? money(selected.revenue) : '—'} note={month === '__year_total__' ? (year === 'all' ? 'All available years' : `${year} full-year total`) : month ? monthName(month) : 'No reports available'} tone="green" />
      <Metric label="Total delivery cost" value={selected ? money(selected.total_cost) : '—'} note={`${money(selected?.materials)} materials · ${money(selected?.labor)} labor`} tone="blue" />
      <Metric label="Gross profit / (loss)" value={selected ? money(selected.gross_profit) : '—'} note={selected ? `${Number(selected.margin_pct || 0).toFixed(1)}% gross margin` : 'No report data'} tone={Number(selected?.gross_profit || 0) < 0 ? 'red' : 'green'} />
      <Metric label="Transactions" value={selected ? number(selected.transaction_count) : '—'} note={`${number(selected?.unassigned_count)} without SOF mapping`} tone={Number(selected?.unassigned_count || 0) ? 'red' : 'blue'} />
    </div>
    <div className="monitor-grid"><Card title="Revenue and cost trend" note={year === 'all' ? 'Monthly performance across all available years' : `Monthly performance in ${year || 'selected year'}`} className="monitor-trend-card">
      {loading ? <div className="py-20 text-center text-sm text-slate-500">Loading monthly totals…</div> : visibleReports.length ? <div className="monitor-chart">{visibleReports.map(row => <div key={row.month} className="monitor-chart-month"><div className="monitor-chart-bars"><div title={`Revenue ${money(row.revenue)}`} className="monitor-bar revenue" style={{ height: `${Math.max(2, Number(row.revenue || 0) / max * 100)}%` }} /><div title={`Cost ${money(row.total_cost)}`} className="monitor-bar cost" style={{ height: `${Math.max(2, Number(row.total_cost || 0) / max * 100)}%` }} /></div><span>{year === 'all' ? monthName(row.month) : monthName(row.month).slice(0, 3)}</span></div>)}</div> : <div className="py-20 text-center text-sm text-slate-500">No reports found for this year.</div>}
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


function ProjectTransactions({ projectKey, startDate, endDate, transactionCount }) {
  const [rows, setRows] = useState([])
  const [offset, setOffset] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const pageSize = 50

  const loadPage = async (reset = false) => {
    if (loading) return
    setLoading(true)
    setError('')
    const pageOffset = reset ? 0 : offset
    try {
      const { data, error: queryError } = await supabase.rpc('income_project_transaction_page_v2', {
        p_start_date: startDate,
        p_end_date: endDate,
        p_project_key: projectKey,
        p_company: 'Greenlight Power Inc.',
        p_category: 'all',
        p_limit: pageSize,
        p_offset: pageOffset,
      })
      if (queryError) throw queryError
      const nextRows = data || []
      setRows(current => reset ? nextRows : [...current, ...nextRows])
      setOffset(pageOffset + nextRows.length)
      setLoaded(true)
    } catch (queryError) {
      setError(queryError?.message || 'Unable to load transaction details.')
    } finally {
      setLoading(false)
    }
  }

  return <details className="mt-5 rounded-xl border border-slate-200 bg-white" onToggle={event => {
    if (event.currentTarget.open && !loaded && !loading) loadPage(true)
  }}>
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
      <span className="flex items-center gap-2"><span className="transition-transform group-open:rotate-90">›</span> Actual transactions</span>
      <span className="text-xs font-medium text-slate-500">{number(transactionCount)} records · load on expand</span>
    </summary>
    <div className="border-t border-slate-100">
      {error && <p role="alert" className="p-3 text-xs text-rose-700">{error}</p>}
      {loading && !rows.length && <p className="p-4 text-xs text-slate-500">Loading first 50 transactions…</p>}
      {rows.length > 0 && <div className="max-h-[420px] overflow-auto">
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead className="sticky top-0 bg-slate-50 text-slate-500"><tr>{['Actual date','Description / payee','QB account','Type','Revenue','Cost'].map(label => <th key={label} className="whitespace-nowrap px-3 py-2 font-semibold">{label}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">{rows.map((tx,index) => {
            const revenue = tx.category === 'Revenue' ? Number(tx.credit || 0) - Number(tx.debit || 0) : 0
            const cost = tx.category === 'Revenue' ? 0 : Number(tx.debit || 0) - Number(tx.credit || 0)
            return <tr key={tx.id || index}>
              <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-700">{dateLabel(tx.transaction_date)}</td>
              <td className="max-w-[260px] px-3 py-2"><div className="truncate text-slate-700" title={tx.name || tx.memo}>{tx.name || tx.memo || tx.type || 'QuickBooks transaction'}</div><div className="text-[10px] text-slate-400">{tx.num || tx.sof_label || tx.sof_base || '—'} · {tx.category || '—'}</div></td>
              <td className="max-w-[190px] truncate px-3 py-2 text-slate-600" title={tx.account}>{tx.account || '—'}</td>
              <td className="whitespace-nowrap px-3 py-2 text-slate-500">{tx.type || '—'}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{revenue ? money(revenue) : '—'}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{cost ? money(cost) : '—'}</td>
            </tr>
          })}</tbody>
        </table>
      </div>}
      {!loading && loaded && !rows.length && <p className="p-4 text-xs text-slate-500">No transaction details in this date range.</p>}
      <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
        <span className="text-xs text-slate-500">Showing {number(rows.length)} of {number(transactionCount)}</span>
        {rows.length < transactionCount && <button type="button" disabled={loading} onClick={() => loadPage(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50">{loading ? 'Loading…' : 'Load 50 more'}</button>}
      </div>
    </div>
  </details>
}

function ProjectAnalysis() {
  const [coverage, setCoverage] = useState('all')
  const [selectedMonth, setSelectedMonth] = useState(() => dateInputValue().slice(0, 7))
  const [projects, setProjects] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const startDate = useMemo(() => coverage === 'month' ? `${selectedMonth}-01` : null, [coverage, selectedMonth])
  const endDate = useMemo(() => {
    if (coverage !== 'month' || !selectedMonth) return null
    const [y,m] = selectedMonth.split('-').map(Number)
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0,10)
  }, [coverage, selectedMonth])
  const rangeLabel = coverage === 'all' ? 'All available dates' : `${monthName(selectedMonth)} (${dateLabel(startDate)} – ${dateLabel(endDate)})`

  useEffect(() => {
    if (coverage === 'month' && (!startDate || !endDate)) return
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

        const [summaryResult] = await Promise.all([
          supabase.rpc('income_project_analysis_summary_v2', {
            p_start_date: startDate,
            p_end_date: endDate,
            p_company: 'Greenlight Power Inc.',
            p_category: 'all',
          }),
        ])
        if (summaryResult.error) throw summaryResult.error
        if (!active) return

        const refs = refResult.data || []
        const rows = (summaryResult.data || []).map(row => {
          const ref = refs.find(item =>
            (row.sof_base && String(item.sof_base || '') === String(row.sof_base)) ||
            (row.sof_key && item.sof_key === row.sof_key) ||
            (!row.sof_base && !row.sof_key && row.project_group && item.project_name === row.project_group)
          )
          const project = {
            key: String(row.project_key || 'Unassigned'),
            label: ref?.project_name || row.project_group || row.sof_label || 'Unassigned project',
            categoryLabel: categoryName(row.division || ref?.division || ref?.construction_classification),
            budget: Number(ref?.total_cost_budget || 0),
            contractValue: Number(ref?.final_contract_value || ref?.contract_value || 0),
            revenue: Number(row.revenue || 0),
            materials: Number(row.materials || 0),
            labor: Number(row.labor || 0),
            overhead: Number(row.overhead || 0),
            other: Number(row.other || 0),
            transactionCount: Number(row.transaction_count || 0),
            accounts: Array.isArray(row.accounts) ? row.accounts : [],
          }
          const actual = projectCost(project)
          return {
            ...project,
            actual,
            cogs: project.materials + project.labor,
            variance: project.budget > 0 ? project.budget - actual : null,
            grossProfit: project.revenue - actual,
            margin: project.revenue > 0 ? (project.revenue - actual) / project.revenue * 100 : null,
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
  }, [coverage, startDate, endDate])

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
    const order = ['Eworks', 'Supply', 'Service', 'Civil', 'Uncategorized']
    return [...order, ...[...map.keys()].filter(name => !order.includes(name))].map(name => map.get(name) || { name, projects: [], revenue: 0, actual: 0, budget: 0, cogs: 0 })
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
      <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">Project monitoring</p><h1 className="mt-1 text-2xl font-semibold text-slate-950">Project Analysis</h1><p className="mt-1 text-sm text-slate-500">Review project budgets, actual costs, and income across all available dates or a selected month.</p></div>
      <div className="flex flex-wrap items-end gap-3"><label className="block text-xs font-semibold text-slate-500">Date coverage<select value={coverage} onChange={event => setCoverage(event.target.value)} className="mt-1 block min-w-[160px] rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-800"><option value="all">All Dates</option><option value="month">Per Month</option></select></label>{coverage === 'month' && <label className="block text-xs font-semibold text-slate-500">Month and year<input type="month" value={selectedMonth} onChange={event => setSelectedMonth(event.target.value)} className="mt-1 block min-w-[170px] rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-800" /></label>}<span className="pb-2 text-xs text-slate-400">Coverage: {rangeLabel}</span></div>
    </div>
    {error && <div role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
    <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Project budget" value={money(totals.budget)} note="Mapped project cost budgets" tone="green" />
      <Metric label="Actual project cost" value={money(totals.actual)} note="Materials, labor, overhead and other" tone="blue" />
      <Metric label="Income" value={money(totals.revenue)} note={rangeLabel} tone="green" />
      <Metric label="Net income" value={money(totals.revenue - totals.actual)} note="Income less actual project cost" tone={totals.revenue - totals.actual < 0 ? 'red' : 'green'} />
    </div>
    {loading ? <div className="rounded-xl border border-emerald-100 bg-white p-8 text-center text-sm text-slate-500">Loading project activity…</div> : <div className="space-y-4">
      {projects.length > 0 && <Card title="Budget utilization" note={`Actual costs against mapped project budgets · ${rangeLabel}`}>
        <ProjectBars budget={totals.budget} actual={totals.actual} />
        <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${variance != null && variance < 0 ? 'bg-rose-500' : totals.budget > 0 && totals.actual / totals.budget >= .8 ? 'bg-amber-500' : 'bg-emerald-600'}`} style={{width:`${totals.budget > 0 ? Math.min(100, Math.max(0, totals.actual / totals.budget * 100)) : 0}%`}} /></div>
        <div className="mt-3 grid gap-3 text-xs text-slate-500 sm:grid-cols-4"><span>Remaining budget <b className="text-slate-800">{variance == null ? '—' : money(variance)}</b></span><span>Utilization <b className="text-slate-800">{totals.budget > 0 ? `${(totals.actual / totals.budget * 100).toFixed(1)}%` : '—'}</b></span><span>COGS <b className="text-slate-800">{money(totals.cogs)}</b></span><span>Projects <b className="text-slate-800">{number(projects.length)}</b></span></div>
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
              <ProjectTransactions key={`${project.key}-${startDate || 'all'}-${endDate || 'all'}`} projectKey={project.key} startDate={startDate} endDate={endDate} transactionCount={project.transactionCount} />
            </div>
          </div>
        </details>)}</div> : <div className="px-4 py-4 text-xs text-slate-500">No project transactions recorded for this coverage.</div>}
      </section>)}
      {!projects.length && <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">No project transactions found from {rangeLabel}.</div>}
    </div>}
  </Shell>
}


function BudgetDashboard() {
  const { months } = useMonths()
  const years = useMemo(() => [...new Set(months.map(value => value.slice(0,4)))].sort(), [months])
  const company = 'Greenlight Power Inc.'
  const [projects, setProjects] = useState([])
  const [rows, setRows] = useState([])
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportSuccess, setExportSuccess] = useState('')
  const [exportType, setExportType] = useState('year')
  const [exportYear, setExportYear] = useState(years.includes(String(new Date().getFullYear())) ? String(new Date().getFullYear()) : years.at(-1) || '')
  const [exportMonth, setExportMonth] = useState(months[0] || '')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const pageSize = 100

  useEffect(() => {
    if (years.length && !years.includes(exportYear)) setExportYear(years.at(-1))
    if (months.length && !months.includes(exportMonth)) setExportMonth(months[0])
  }, [years, months, exportYear, exportMonth])

  const projectMap = useMemo(() => new Map(projects.flatMap(project => [[String(project.project_key), project], ...(project.matched_sof_base ? [[String(project.matched_sof_base), project]] : [])])), [projects])
  const allocated = projects.reduce((sum, project) => sum + Number(project.allocated_budget || 0), 0)
  const actual = projects.reduce((sum, project) => sum + Number(project.actual_cost || 0), 0)
  const remaining = allocated - actual
  const utilization = allocated > 0 ? actual / allocated * 100 : 0
  const overBudget = projects.filter(project => Number(project.actual_cost || 0) > Number(project.allocated_budget || 0)).length

  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    supabase.rpc('income_budget_projects', { p_company: company }).then(({data,error:queryError}) => {
      if (!active) return
      if (queryError) throw queryError
      setProjects(data || [])
    }).catch(e => { if (active) setError(e?.message || 'Unable to load project budget records.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [company])

  const loadRows = async (reset = false) => {
    if (!projects.length) { setRows([]); setHasMore(false); return }
    const pageOffset = reset ? 0 : offset
    if (reset) setLoadingMore(true); else setLoadingMore(true)
    setError('')
    try {
      const exactKeys = projects.map(project => String(project.project_key)).filter(Boolean)
      const baseKeys = projects.map(project => String(project.matched_sof_base || '')).filter(Boolean)
      let query = supabase.from('income_all_transactions')
        .select('id,transaction_date,type,num,name,memo,account,debit,credit,sof_base,sof_key,company')
        .eq('company', company)
        .neq('category', 'Revenue')
        .or([exactKeys.length ? `sof_key.in.(${exactKeys.join(',')})` : '', baseKeys.length ? `sof_base.in.(${baseKeys.join(',')})` : ''].filter(Boolean).join(','))
        .order('transaction_date', {ascending:false})
        .order('id', {ascending:false})
        .range(pageOffset,pageOffset+pageSize)
      const {data,error:queryError}=await query
      if(queryError) throw queryError
      const result=data||[]
      setHasMore(result.length>pageSize)
      setRows(current=>reset?result.slice(0,pageSize):[...current,...result.slice(0,pageSize)])
      setOffset(pageOffset+Math.min(result.length,pageSize))
    } catch(e) { setError(e?.message||'Unable to load budget transactions.') }
    finally { setLoadingMore(false) }
  }

  useEffect(() => { setRows([]);setOffset(0);setHasMore(false);loadRows(true) }, [projects, company])

  const coverage = () => {
    if (exportType === 'year') return {from:exportYear ? `${exportYear}-01-01` : '',to:exportYear ? `${exportYear}-12-31` : ''}
    if (exportType === 'month') {
      if (!exportMonth) return {from:'',to:''}
      const [y,m]=exportMonth.split('-').map(Number)
      return {from:`${exportMonth}-01`,to:new Date(Date.UTC(y,m,0)).toISOString().slice(0,10)}
    }
    return {from:startDate,to:endDate}
  }

  const exportWorkbook = async () => {
    if(exporting) return
    const range=coverage()
    if(!range.from||!range.to) {setError('Select a valid export period before exporting.');return}
    if(range.from>range.to) {setError('Start date must be on or before end date.');return}
    setExporting(true);setError('');setExportSuccess('')
    try {
      const exactKeys=projects.map(project=>String(project.project_key)).filter(Boolean)
      const baseKeys=projects.map(project=>String(project.matched_sof_base||'')).filter(Boolean)
      const all=[]
      const batchSize=1000
      for(let offset=0;;offset+=batchSize){
        let query=supabase.from('income_all_transactions')
          .select('id,company,division,transaction_date,type,num,name,memo,account,debit,credit,sof_base,sof_key')
          .eq('company',company).neq('category','Revenue')
          .or([exactKeys.length ? `sof_key.in.(${exactKeys.join(',')})` : '', baseKeys.length ? `sof_base.in.(${baseKeys.join(',')})` : ''].filter(Boolean).join(','))
          .gte('transaction_date',range.from).lte('transaction_date',range.to)
          .order('transaction_date',{ascending:true}).order('id',{ascending:true})
          .range(offset,offset+batchSize-1)
        const {data,error:queryError}=await query
        if(queryError)throw queryError
        all.push(...(data||[]))
        if(!data||data.length<batchSize)break
      }
      const workbook=XLSX.utils.book_new()
      const summary=[
        ['Budget Monitoring Summary'],['Company',company],['Export coverage',`${range.from} to ${range.to}`],
        ['All-time Allocated Budget',allocated],['All-time Actual Expenses',actual],['All-time Remaining Budget',remaining],
        ['All-time Budget Utilization (%)',utilization],['Projects Exceeding Budget (all-time)',overBudget],
        ['Budgeted Projects',projects.length],['Transactions exported in selected period',all.length],
        ['Net Expenses in selected export period',all.reduce((sum,row)=>sum+Number(row.debit||0)-Number(row.credit||0),0)],
        [],['Project','SOF','Allocated Budget','Actual Cost','Remaining Budget','Utilization (%)','Status'],
        ...projects.map(p=>[p.project_name,p.project_key,Number(p.allocated_budget||0),Number(p.actual_cost||0),Number(p.allocated_budget||0)-Number(p.actual_cost||0),Number(p.allocated_budget||0)?Number(p.actual_cost||0)/Number(p.allocated_budget||0)*100:0,Number(p.actual_cost||0)>Number(p.allocated_budget||0)?'Over budget':'Within budget'])
      ]
      XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet(summary),'Budget Summary')
      const grouped=new Map()
      for(const row of all){const key=String(row.transaction_date||'').slice(0,7)||'Undated';if(!grouped.has(key))grouped.set(key,[]);const p=projectMap.get(String(row.sof_key||''))||projectMap.get(String(row.sof_base||''));const amount=Number(row.debit||0)-Number(row.credit||0);grouped.get(key).push([row.transaction_date,row.type,row.num,row.name,row.memo||row.account,amount,'','',amount,p?Number(p.actual_cost||0):''])}
      const headers=['Date','Type','Ref. No.','Entity','Particulars','Amount','VAT','Net','Total Amount','Project Cost']
      for(const [month,items] of grouped){XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([headers,...items]),month.slice(0,31))}
      const filename=`budget-monitor-${company==='Greenlight Power Inc.'?'greenlight':'gemcor'}-${range.from}-to-${range.to}.xlsx`
      XLSX.writeFile(workbook,filename)
      setExportSuccess(`${number(all.length)} budget-linked transactions exported across ${grouped.size} monthly worksheets.`)
    } catch(e){setError(e?.message||'Unable to export budget workbook.')}
    finally{setExporting(false)}
  }

  return <Shell>
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="monitor-eyebrow">FINANCIAL OPERATIONS</p><h1 className="text-2xl font-semibold text-slate-950">Budget Dashboard</h1><p className="mt-1 text-sm text-slate-500">Monitor allocated project budgets against actual QuickBooks costs.</p><p className="mt-1 text-xs text-slate-400">Budget source: Greenlight Power Inc. project reference data.</p></div>
    </div>
    {error&&<div role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
    {exportSuccess&&<div role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{exportSuccess}</div>}
    <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Metric label="Total allocated budget" value={money(allocated)} note={`${number(projects.length)} projects with budget data`} tone="green"/>
      <Metric label="Total actual expenses" value={money(actual)} note="Matched to budgeted SOFs" tone="blue"/>
      <Metric label="Remaining budget" value={money(remaining)} note={remaining<0?'Over allocated budget':'Available budget'} tone={remaining<0?'red':'green'}/>
      <Metric label="Budget utilization" value={allocated? `${utilization.toFixed(1)}%`:'—'} note="Actual expenses ÷ allocated budget" tone={utilization>=100?'red':utilization>=80?'amber':'green'}/>
      <Metric label="Projects over budget" value={number(overBudget)} note="Actual cost exceeds allocation" tone={overBudget?'red':'green'}/>
    </div>
    <Card title="Budget utilization" note="Green: within budget · Amber: 80% or more utilized · Red: over budget">
      <div className="h-4 overflow-hidden rounded-full bg-slate-100"><div className={remaining<0?'h-full bg-rose-500':utilization>=80?'h-full bg-amber-500':'h-full bg-emerald-600'} style={{width:`${Math.min(100,Math.max(0,utilization))}%`}}/></div>
      <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-slate-500"><span>{utilization.toFixed(1)}% utilized</span><span>Variance: <b className={remaining<0?'text-rose-700':'text-emerald-700'}>{money(remaining)}</b></span></div>
    </Card>
    <Card title="Budget monitoring transactions" note="Spreadsheet-style ledger. VAT and net split are not present in the current QuickBooks transaction schema and are intentionally left blank rather than estimated.">
      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <label className="text-xs font-semibold text-slate-600">Export coverage<select value={exportType} onChange={e=>setExportType(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="year">Per Year</option><option value="month">Per Month</option><option value="range">Customized Date Range</option></select></label>
          {exportType==='year'&&<label className="text-xs font-semibold text-slate-600">Year<select value={exportYear} onChange={e=>setExportYear(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">{years.map(y=><option key={y} value={y}>{y}</option>)}</select></label>}
          {exportType==='month'&&<label className="text-xs font-semibold text-slate-600">Month<input type="month" value={exportMonth} onChange={e=>setExportMonth(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/></label>}
          {exportType==='range'&&<><label className="text-xs font-semibold text-slate-600">Start date<input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/></label><label className="text-xs font-semibold text-slate-600">End date<input type="date" min={startDate||undefined} value={endDate} onChange={e=>setEndDate(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/></label></>}
        </div>
        <button type="button" onClick={exportWorkbook} disabled={exporting||loading||!projects.length} className="rounded-lg bg-[#173b68] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{exporting?'Preparing XLSX…':'Export Budget XLSX'}</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1150px] border-collapse text-xs">
          <thead className="bg-[#242a32] text-white"><tr>{['Date','Type','Ref. No.','Entity','Particulars','Amount','VAT','Net','Total Amount','Project Cost'].map(h=><th key={h} className="border border-slate-500 px-2.5 py-2.5 text-left font-bold">{h}</th>)}</tr></thead>
          <tbody>{rows.map(row=>{const p=projectMap.get(String(row.sof_key||''))||projectMap.get(String(row.sof_base||''));const amount=Number(row.debit||0)-Number(row.credit||0);return <tr key={row.id} className="odd:bg-white even:bg-slate-50"><td className="border border-slate-200 px-2 py-2 whitespace-nowrap">{shortDate(row.transaction_date)}</td><td className="border border-slate-200 px-2 py-2">{row.type||'—'}</td><td className="border border-slate-200 px-2 py-2">{row.num||row.sof_base||'—'}</td><td className="border border-slate-200 px-2 py-2">{row.name||'—'}</td><td className="border border-slate-200 px-2 py-2 max-w-[320px] whitespace-normal">{row.memo||row.account||'—'}</td><td className="border border-slate-200 px-2 py-2 text-right tabular-nums">{money(amount)}</td><td className="border border-slate-200 px-2 py-2 text-right">—</td><td className="border border-slate-200 px-2 py-2 text-right">—</td><td className="border border-slate-200 bg-amber-50 px-2 py-2 text-right font-semibold tabular-nums">{money(amount)}</td><td className="border border-slate-200 bg-emerald-50 px-2 py-2 text-right font-semibold tabular-nums">{p?money(p.actual_cost):'—'}</td></tr>})}</tbody>
        </table>
        {!rows.length&&!loading&&!loadingMore&&<p className="p-6 text-center text-sm text-slate-500">No budget-linked transactions found.</p>}
        {loadingMore&&<p className="p-4 text-center text-xs text-slate-500">Loading budget transactions…</p>}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3 text-xs text-slate-500"><span>{number(rows.length)} loaded rows · {number(projects.length)} budgeted projects</span>{hasMore&&<button type="button" onClick={()=>loadRows(false)} disabled={loadingMore} className="rounded-lg border border-slate-300 px-3 py-2 font-semibold text-slate-700 disabled:opacity-50">Load more</button>}</div>
    </Card>
    <Card title="Project budget register" note="Actual cost is matched by SOF to the latest available reference budget. Projects without a non-zero allocated budget are excluded from budget totals.">
      <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Project','SOF','Allocated budget','Actual cost','Remaining','Utilization','Status'].map(h=><th key={h} className="px-3 py-3 text-left">{h}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{projects.map(p=>{const left=Number(p.allocated_budget||0)-Number(p.actual_cost||0);const pctValue=Number(p.allocated_budget||0)?Number(p.actual_cost||0)/Number(p.allocated_budget||0)*100:0;return <tr key={p.project_key}><td className="px-3 py-3 font-medium">{p.project_name||'Unnamed project'}</td><td className="px-3 py-3">{p.project_key}</td><td className="px-3 py-3 text-right tabular-nums">{money(p.allocated_budget)}</td><td className="px-3 py-3 text-right tabular-nums">{money(p.actual_cost)}</td><td className={`px-3 py-3 text-right tabular-nums ${left<0?'text-rose-700':'text-emerald-700'}`}>{money(left)}</td><td className="px-3 py-3 text-right tabular-nums">{pctValue.toFixed(1)}%</td><td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${left<0?'bg-rose-50 text-rose-700':pctValue>=80?'bg-amber-50 text-amber-700':'bg-emerald-50 text-emerald-700'}`}>{left<0?'Over budget':pctValue>=80?'Near limit':'Within budget'}</span></td></tr>})}</tbody></table></div>
    </Card>
  </Shell>
}

function TransactionDetails() {
  const [company, setCompany] = useState('Greenlight Power Inc.')
  const { months: availableMonths } = useMonths(company)
  const exportYears = useMemo(() => [...new Set(availableMonths.map(value => value.slice(0,4)))].sort(), [availableMonths])
  const [exportType, setExportType] = useState('year')
  const [exportYear, setExportYear] = useState('')
  const [exportMonth, setExportMonth] = useState('')
  const [exportStartDate, setExportStartDate] = useState('')
  const [exportEndDate, setExportEndDate] = useState('')
  const [rows, setRows] = useState([])
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [division, setDivision] = useState('all')
  const [category, setCategory] = useState('all')
  const [cursorStack, setCursorStack] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportSuccess, setExportSuccess] = useState('')
  const pageSize = 50
  const cursor = cursorStack[cursorStack.length - 1] || null
  useEffect(() => { if (exportYears.length && !exportYears.includes(exportYear)) setExportYear(exportYears.at(-1)); if (availableMonths.length && !availableMonths.includes(exportMonth)) setExportMonth(availableMonths[0]); }, [exportYears, availableMonths, exportYear, exportMonth])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    const load = async () => {
      try {
        let query = supabase.from('income_all_transactions')
          .select('id,company,division,type,transaction_date,name,sof_base,sof_label,memo,account,debit,credit,balance,category')
          .eq('company', company)
          .order('transaction_date', { ascending: false })
          .order('id', { ascending: false })
          .limit(pageSize + 1)
        if (division !== 'all') query = query.eq('division', division)
        if (startDate) query = query.gte('transaction_date', startDate)
        if (endDate) query = query.lte('transaction_date', endDate)
        if (category !== 'all') query = query.eq('category', category)
        if (cursor) query = query.or(`transaction_date.lt.${cursor.date},and(transaction_date.eq.${cursor.date},id.lt.${cursor.id})`)
        const { data, error: queryError } = await query
        if (queryError) throw queryError
        if (!active) return
        const result = data || []
        setHasMore(result.length > pageSize)
        setRows(result.slice(0, pageSize))
      } catch (loadError) {
        if (active) { setError(loadError?.message || 'Unable to load transactions.'); setRows([]); setHasMore(false) }
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [startDate, endDate, company, division, category, cursor?.date, cursor?.id])

  const resetFilters = () => setCursorStack([])
  const nextPage = () => {
    if (!rows.length || !hasMore) return
    const last = rows[rows.length - 1]
    setCursorStack(current => [...current, { date: last.transaction_date, id: last.id }])
  }
  const previousPage = () => setCursorStack(current => current.slice(0, -1))

  const exportCsv = async () => {
    if (exporting) return
    let exportFrom = ''; let exportTo = ''
    if (exportType === 'year' && exportYear) { exportFrom = `${exportYear}-01-01`; exportTo = `${exportYear}-12-31` }
    else if (exportType === 'month' && exportMonth) { const [y,m] = exportMonth.split('-').map(Number); exportFrom = `${exportMonth}-01`; exportTo = new Date(Date.UTC(y,m,0)).toISOString().slice(0,10) }
    else if (exportType === 'range') { exportFrom = exportStartDate; exportTo = exportEndDate }
    if (!exportFrom || !exportTo) { setError('Choose a complete export coverage period.'); return }
    if (exportFrom > exportTo) { setError('Export start date must be on or before the end date.'); return }
    setExporting(true)
    setError(''); setExportSuccess('')
    try {
      const exported = []
      const batchSize = 1000
      for (let offset = 0; ; offset += batchSize) {
        let query = supabase.from('income_all_transactions')
          .select('id,company,division,type,transaction_date,name,sof_base,sof_label,memo,account,debit,credit,balance,category')
          .eq('company', company)
          .order('transaction_date', { ascending: false })
          .order('id', { ascending: false })
          .range(offset, offset + batchSize - 1)
        if (division !== 'all') query = query.eq('division', division)
        query = query.gte('transaction_date', exportFrom).lte('transaction_date', exportTo)
        if (category !== 'all') query = query.eq('category', category)
        const { data, error: queryError } = await query
        if (queryError) throw queryError
        const batch = data || []
        exported.push(...batch)
        if (batch.length < batchSize) break
      }
      const headers = ['COMPANY','DIVISION','TYPE','DATE','CLIENT','SOF #','MEMO OR DESCRIPTION','ACCOUNT','DEBIT','CREDIT','RUNNING BALANCE','CATEGORY']
      const csvCell = value => {
        const text = value == null ? '' : String(value)
        return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text
      }
      const lines = [headers, ...exported.map(row => [
        row.company, row.division, row.type, row.transaction_date, row.name,
        row.sof_base || row.sof_label, row.memo, row.account, row.debit, row.credit,
        row.balance, row.category,
      ])].map(line => line.map(csvCell).join(','))
      const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      const companySlug = company === 'Greenlight Power Inc.' ? 'greenlight' : 'gemcor'
      const divisionSlug = division === 'all' ? 'all-divisions' : division.toLowerCase()
      anchor.href = url
      anchor.download = `e-works-${companySlug}-${divisionSlug}-transactions-${exportFrom}-to-${exportTo}.csv`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      setExportSuccess(`${number(exported.length)} transactions exported for ${exportFrom} to ${exportTo}.`)
    } catch (exportError) {
      setError(exportError?.message || 'Unable to export the filtered transactions.')
    } finally {
      setExporting(false)
    }
  }

  return <Shell page="transactions">
    <div className="mb-6 flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="monitor-eyebrow">FINANCIAL OPERATIONS</p><h1 className="text-2xl font-semibold text-slate-950">All Transactions</h1><p className="mt-1 text-sm text-slate-500">Company-separated QuickBooks ledger. Filters are applied in the database before rows are returned.</p></div>
        <a href="#/dashboard" className="text-sm font-semibold text-emerald-700 hover:text-emerald-900">← Back to Financial Monitor</a>
      </div>
      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <label className="text-xs font-semibold text-slate-600">Company<select value={company} onChange={e => {setCompany(e.target.value);resetFilters()}} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-800"><option value="Greenlight Power Inc.">Greenlight Power Inc.</option><option value="Gemcor (Greenmetal Electric)">Gemcor (Greenmetal Electric)</option></select></label>
        <label className="text-xs font-semibold text-slate-600">Division<select value={division} onChange={e => {setDivision(e.target.value);resetFilters()}} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-800"><option value="all">All divisions</option><option value="CIVILWORKS">Civilworks</option><option value="EWORKS">Eworks</option><option value="SUPPLY">Supply</option><option value="All Transactions">All Transactions</option></select></label>
        <label className="text-xs font-semibold text-slate-600">From date<input type="date" value={startDate} onChange={e => {setStartDate(e.target.value);resetFilters()}} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800" /></label>
        <label className="text-xs font-semibold text-slate-600">To date<input type="date" value={endDate} min={startDate || undefined} onChange={e => {setEndDate(e.target.value);resetFilters()}} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800" /></label>
        <label className="text-xs font-semibold text-slate-600">Category filter<select value={category} onChange={e => {setCategory(e.target.value);resetFilters()}} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-800"><option value="all">All categories</option><option value="Revenue">Revenue</option><option value="Materials">Materials</option><option value="Overhead">Overhead</option><option value="Labor">Labor</option><option value="Other">Other</option></select></label>
        <div className="flex items-end"><button type="button" onClick={() => {setStartDate('');setEndDate('');setCompany('Greenlight Power Inc.');setDivision('all');setCategory('all');setCursorStack([])}} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Clear filters</button></div>
      </div>
    </div>
    <div className="mb-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5"><label className="text-xs font-semibold text-slate-600">Export coverage<select value={exportType} onChange={e=>setExportType(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="year">Per Year</option><option value="month">Per Month</option><option value="range">Customized Date Range</option></select></label>{exportType==='year'&&<label className="text-xs font-semibold text-slate-600">Year<select value={exportYear} onChange={e=>setExportYear(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">{exportYears.map(y=><option key={y} value={y}>{y}</option>)}</select></label>}{exportType==='month'&&<label className="text-xs font-semibold text-slate-600">Month<input type="month" value={exportMonth} onChange={e=>setExportMonth(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/></label>}{exportType==='range'&&<><label className="text-xs font-semibold text-slate-600">Start date<input type="date" value={exportStartDate} onChange={e=>setExportStartDate(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/></label><label className="text-xs font-semibold text-slate-600">End date<input type="date" min={exportStartDate||undefined} value={exportEndDate} onChange={e=>setExportEndDate(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/></label>}</div>
    {error && <div role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
    {exportSuccess && <div role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{exportSuccess}</div>}
    <div className="overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-sm font-semibold text-slate-900">QuickBooks transaction ledger · {company}</h2><p className="mt-1 text-xs text-slate-500">Actual transaction dates · newest first · 50-row keyset pagination · category retained</p></div><div className="flex items-center gap-2"><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">{rows.length} records on this page</span><button type="button" onClick={exportCsv} disabled={exporting || loading} className="rounded-lg bg-[#173b68] px-3 py-2 text-xs font-semibold text-white hover:bg-[#102d50] disabled:cursor-not-allowed disabled:opacity-50">{exporting ? 'Preparing CSV…' : 'Export CSV'}</button></div></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[1250px] text-left text-sm"><thead className="bg-[#173b68] text-xs uppercase text-white"><tr>{['TYPE','DATE','CLIENT','SOF #','MEMO OR DESCRIPTION','ACCOUNT','DEBIT','CREDIT','RUNNING BALANCE'].map(x => <th key={x} className="whitespace-nowrap px-3 py-3">{x}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{rows.map(row => <tr key={row.id}><td className="whitespace-nowrap px-3 py-3">{row.type || '—'}</td><td className="whitespace-nowrap px-3 py-3">{shortDate(row.transaction_date)}</td><td className="max-w-[220px] truncate px-3 py-3" title={row.name}>{row.name || '—'}</td><td className="whitespace-nowrap px-3 py-3">{row.sof_base || row.sof_label || '—'}</td><td className="min-w-[320px] max-w-[520px] whitespace-normal break-words px-3 py-3 align-top"><div className="text-slate-700" title={row.memo}>{row.memo || '—'}</div></td><td className="max-w-[220px] truncate px-3 py-3" title={row.account}>{row.account || '—'}</td><td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{money(row.debit)}</td><td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{money(row.credit)}</td><td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{money(row.balance)}</td></tr>)}</tbody></table>{!rows.length && !loading && !error && <div className="p-8 text-center text-sm text-slate-500">No transactions found for these filters. Check whether a QuickBooks upload exists for the selected company.</div>}{loading && <div className="p-5 text-center text-sm text-slate-500">Loading transactions…</div>}</div>
      <div className="flex items-center justify-between gap-3 border-t border-slate-100 p-3 text-sm text-slate-500"><span>Page {cursorStack.length + 1} · {rows.length} records shown</span><div className="flex items-center gap-2"><button disabled={!cursorStack.length || loading} onClick={previousPage} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">Previous</button><button disabled={!hasMore || loading} onClick={nextPage} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">Next 50</button></div></div>
    </div>
  </Shell>
}

export default function FinanceWorkspace() {
  const page = (location.hash || '#/dashboard').replace(/^#\/?/, '')
  if (page === 'projects') return <ProjectAnalysis />
  if (page === 'transactions') return <TransactionDetails />
  if (page === 'budget') return <BudgetDashboard />
  return <MainDashboard />
}