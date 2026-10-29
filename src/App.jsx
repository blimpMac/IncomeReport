import React, { useEffect, useMemo, useState } from 'react'
import { supabase, money, number, pct, shortDate, parseQuickBooksFile, uploadQuickBooks, buildRemarks, monthInput } from './lib.js'

const PAGE_SIZE = 10
const NAV = [['dashboard','Dashboard'],['upload','QB Upload'],['monthly','Monthly Report'],['sof','SOF Analysis'],['transactions','Transactions'],['reference','Reference Data'],['worksheets','QB Worksheets']]
const pageNow = () => { const p = (location.hash || '#/dashboard').replace(/^#\/?/, ''); return NAV.some(([x]) => x === p) ? p : 'dashboard' }
const go = (p) => { location.hash = `#/${p}` }
const cleanRemark = (value) => String(value || '').replace(/\s+/g, ' ').trim()
const compactMoney = (value) => new Intl.NumberFormat('en-PH', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value || 0))
const monthLabel = (value) => {
  if (!value) return 'Selected month'
  const [y, m] = String(value).split('-').map(Number)
  if (!y || !m) return value
  return new Date(y, m - 1, 1).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
}
const monthBounds = (value) => {
  const [y, m] = String(value || '').split('-').map(Number)
  if (!y || !m) return { start: null, end: null }
  const start = `${y}-${String(m).padStart(2, '0')}-01`
  const end = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)
  return { start, end }
}
const sofBaseNumber = (row) => {
  const raw = row?.sof_base ?? row?.sof_key ?? row?.sof_number ?? row?.sof_label ?? ''
  const match = String(raw).match(/\d+/)
  return match ? Number(match[0]) : null
}
const sofSortText = (row) => String(row?.sof_number ?? row?.sof_key ?? row?.sof_label ?? '')
const compareSof = (a, b) => {
  const an = sofBaseNumber(a)
  const bn = sofBaseNumber(b)
  if (an == null && bn != null) return 1
  if (an != null && bn == null) return -1
  if (an != null && bn != null && an !== bn) return an - bn
  return sofSortText(a).localeCompare(sofSortText(b), undefined, { numeric: true, sensitivity: 'base' })
}
const displaySof = (row) => {
  const n = sofBaseNumber(row)
  return n == null ? (row?.sof_number || row?.sof_label || 'Unassigned') : `SOF ${n}`
}
const referenceBases = (row) => {
  const raw = String(row?.sof_number || '').replace(/^SOF\s*/i, '').trim()
  if (/^\d+(?:\s*(?:,|&)\s*\d+)+$/.test(raw)) return [...new Set(raw.match(/\d+/g).map(Number))]
  const range = raw.match(/^(\d+)\s*-\s*(\d+)$/)
  if (range && Number(range[2]) === Number(range[1]) + 1) return [Number(range[1]), Number(range[2])]
  const n = sofBaseNumber(row)
  return n == null ? [] : [n]
}
const sum = (a, b) => Number(a || 0) + Number(b || 0)

function Card({ children, className = '', style }) {
  return <div style={style} className={`min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>
}
function Button({ children, secondary = false, className = '', ...p }) {
  return <button {...p} className={`${secondary ? 'border border-slate-300 bg-white text-slate-700' : 'bg-slate-900 text-white'} rounded-lg px-3.5 py-2 text-sm font-medium disabled:opacity-50 ${className}`}>{children}</button>
}
function Header({ title, sub, actions }) {
  return <div className="mb-5 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
    <div className="min-w-0"><h1 className="text-2xl font-semibold text-slate-950">{title}</h1><p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">{sub}</p></div>
    {actions && <div className="no-print flex max-w-full flex-wrap items-end gap-2">{actions}</div>}
  </div>
}
const STAT_TONES = {
  emerald: { accent: '#10b981', soft: '#ecfdf5', text: '#047857', border: '#d1fae5' },
  rose: { accent: '#ef4444', soft: '#fff1f2', text: '#be123c', border: '#ffe4e6' },
  amber: { accent: '#f59e0b', soft: '#fffbeb', text: '#b45309', border: '#fef3c7' },
  indigo: { accent: '#6366f1', soft: '#eef2ff', text: '#4f46e5', border: '#e0e7ff' },
  cyan: { accent: '#06b6d4', soft: '#ecfeff', text: '#0e7490', border: '#cffafe' },
  slate: { accent: '#64748b', soft: '#f8fafc', text: '#475569', border: '#e2e8f0' },
}
function Stat({ label, value, note, tone = 'slate' }) {
  const t = STAT_TONES[tone] || STAT_TONES.slate
  return <Card className="relative p-4" style={{ borderColor: t.border }}>
    <div className="absolute inset-x-0 top-0 h-1" style={{ background: t.accent }} />
    <div className="flex items-center gap-2">
      <span className="inline-grid h-6 w-6 place-items-center rounded-md" style={{ background: t.soft }}><span className="h-2.5 w-2.5 rounded-full" style={{ background: t.accent }} /></span>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
    </div>
    <div className="mt-2 break-words text-xl font-semibold sm:text-2xl" style={{ color: t.text }}>{value}</div>
    {note && <div className="mt-1 text-xs text-slate-500">{note}</div>}
  </Card>
}
function ErrorBox({ v }) { return v ? <div className="mb-4 break-words rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{v}</div> : null }
function Pager({ page, total, setPage }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  return <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 p-3 text-sm text-slate-500">
    <span>{total ? `${page * PAGE_SIZE + 1}-${Math.min((page + 1) * PAGE_SIZE, total)} of ${number(total)}` : '0 records'}</span>
    <div className="flex items-center gap-2"><Button secondary disabled={!page} onClick={() => setPage(page - 1)}>Previous</Button><span className="whitespace-nowrap">{page + 1}/{pages}</span><Button secondary disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</Button></div>
  </div>
}
function Table({ heads, rows, row, minWidth = 680 }) {
  return <div className="scrollbar-thin w-full max-w-full overflow-x-auto overscroll-x-contain">
    <table className="finance-table w-full text-left text-sm" style={{ minWidth }}>
      <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{heads.map(x => <th key={x} className="px-3 py-3 font-medium">{x}</th>)}</tr></thead>
      <tbody className="divide-y divide-slate-100">{rows.map(row)}</tbody>
    </table>
    {!rows.length && <div className="p-8 text-center text-sm text-slate-500">No data found.</div>}
  </div>
}
function CostCell({ row }) {
  return <><div className="whitespace-nowrap font-medium">{money(row.total_cost)}</div><div className="mt-1 text-[11px] leading-4 text-slate-500">M {money(row.materials)} · L {money(row.labor)} · O {money(row.overhead)}</div></>
}
function SearchInput({ value, onChange, placeholder = 'Search SOF…' }) {
  return <label className="relative block min-w-[220px] max-w-full">
    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">⌕</span>
    <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-9 text-sm" />
    {value && <button type="button" aria-label="Clear search" onClick={() => onChange('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">×</button>}
  </label>
}
function MonthPicker({ value, onChange, label = 'Review month' }) {
  return <label className="block">
    <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{label}</span>
    <input type="month" value={value} onChange={e => onChange(e.target.value)} className="min-w-[154px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
  </label>
}

function Shell({ children }) {
  const [page, setPage] = useState(pageNow())
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const f = () => { setPage(pageNow()); setOpen(false) }
    addEventListener('hashchange', f)
    return () => removeEventListener('hashchange', f)
  }, [])
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])
  return <div className="min-h-screen w-full overflow-x-hidden bg-[#f7f8fa]">
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between px-4 lg:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <button aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} className="shrink-0" onClick={() => setOpen(!open)}>☰</button>
          <button onClick={() => go('dashboard')} className="min-w-0 text-left"><b className="block truncate text-sm">E-WORKS Income Report</b><div className="truncate text-xs text-slate-500">Finance reporting workspace</div></button>
        </div>
      </div>
    </header>
    {open && <button aria-label="Close navigation" onClick={() => setOpen(false)} className="fixed inset-0 top-[4.375rem] z-40 bg-slate-950/30 backdrop-blur-[1px]" />}
    <aside className={`${open ? 'block' : 'hidden'} fixed left-0 top-[4.375rem] z-50 h-[calc(100vh-4.375rem)] w-60 shrink-0 border-r border-slate-200 p-3`}>
      <nav className="space-y-1">{NAV.map(([id, label]) => <button key={id} onClick={() => go(id)} className={`w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium ${page === id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{label}</button>)}</nav>
    </aside>
    <main className="w-full min-w-0 overflow-x-hidden p-4 lg:p-6 xl:p-8">{children}</main>
  </div>
}

function useLatest() {
  const [d, setD] = useState(null)
  useEffect(() => { supabase.from('income_qb_uploads').select('*').eq('status', 'ready').order('report_date', { ascending: false }).limit(1).maybeSingle().then(({ data }) => setD(data)) }, [])
  return d
}

function expandedRemarks(report, sofRows = []) {
  if (!report) return []
  const revenue = Number(report.revenue || 0)
  const cost = Number(report.total_cost || 0)
  const gross = Number(report.gross_profit || 0)
  const materials = Number(report.materials || 0)
  const labor = Number(report.labor || 0)
  const overhead = Number(report.overhead || 0)
  const other = Number(report.other_cost || 0)
  const active = sofRows.filter(x => Number(x.transaction_count || 0) > 0)
  const lossSofs = active.filter(x => Number(x.gross_profit || 0) < 0)
  const noRevenueCost = active.filter(x => Number(x.total_cost || 0) > 0 && Number(x.revenue || 0) <= 0)
  const topCost = [...active].sort((a, b) => Number(b.total_cost || 0) - Number(a.total_cost || 0))[0]
  const topLoss = [...lossSofs].sort((a, b) => Number(a.gross_profit || 0) - Number(b.gross_profit || 0))[0]
  const topRevenue = [...active].sort((a, b) => Number(b.revenue || 0) - Number(a.revenue || 0))[0]
  const topAccounts = Array.isArray(report.top_cost_accounts) ? report.top_cost_accounts : []

  const remarks = []
  remarks.push(`Financial position — Revenue is ${money(revenue)} against ${money(cost)} of cost, producing ${gross < 0 ? 'a gross loss' : 'gross profit'} of ${money(Math.abs(gross))}${report.margin_pct == null ? '' : ` and a ${Number(report.margin_pct).toFixed(1)}% margin`}. ${cost > revenue ? 'Cost is running above recognized revenue and requires project-level review before month-end close.' : 'Recognized revenue currently covers the recorded monthly cost.'}`)

  if (cost > 0) {
    remarks.push(`Cost mix — Materials represent ${(materials / cost * 100).toFixed(1)}%, labor ${(labor / cost * 100).toFixed(1)}%, overhead ${(overhead / cost * 100).toFixed(1)}%, and Other/unmapped ${(other / cost * 100).toFixed(1)}% of total cost. ${other / cost >= 0.2 ? 'The unmapped share is material and should be reclassified to the correct project cost buckets where support exists.' : 'The cost mix is reasonably classified, subject to normal reconciliation.'}`)
  }

  if (topCost) {
    const share = cost > 0 ? Number(topCost.total_cost || 0) / cost * 100 : 0
    remarks.push(`SOF exposure — ${displaySof(topCost)} carries the highest monthly cost at ${money(topCost.total_cost)}, or ${share.toFixed(1)}% of total cost${Number(topCost.revenue || 0) > 0 ? `, against ${money(topCost.revenue)} of recognized revenue` : ', with no recognized revenue in the same period'}. Review billing cut-off, subcontractor postings, and cost allocation for this SOF first.`)
  }

  if (active.length) {
    remarks.push(`SOF exceptions — ${number(lossSofs.length)} of ${number(active.length)} active SOFs currently show negative gross profit, and ${number(noRevenueCost.length)} carry cost without matching revenue. Prioritize these SOFs for billing completeness, accrual timing, and project-cost validation.`)
  }

  if (topLoss) {
    remarks.push(`Largest project loss — ${displaySof(topLoss)} shows a gross loss of ${money(Math.abs(Number(topLoss.gross_profit || 0)))}. Its cost is ${money(topLoss.total_cost)} versus ${money(topLoss.revenue)} revenue, making it the highest-impact SOF exception in the current month.`)
  }

  if (topRevenue && Number(topRevenue.revenue || 0) > 0) {
    const share = revenue > 0 ? Number(topRevenue.revenue || 0) / revenue * 100 : 0
    remarks.push(`Revenue concentration — ${displaySof(topRevenue)} contributes ${money(topRevenue.revenue)} or ${share.toFixed(1)}% of monthly revenue. Confirm that revenue recognition and corresponding project costs are aligned for this SOF.`)
  }

  if (topAccounts.length) {
    const top3 = topAccounts.slice(0, 3).map(x => `${String(x.account || 'Unspecified')} (${money(x.net_cost)})`).join(', ')
    remarks.push(`Account review — The largest cost accounts are ${top3}. Compare these balances with supporting invoices, payroll, and subcontractor schedules and confirm they are assigned to the correct SOFs.`)
  }

  for (const base of buildRemarks(report)) {
    if (!remarks.some(x => x.toLowerCase().includes(base.slice(0, 24).toLowerCase()))) remarks.push(base)
  }
  return remarks.slice(0, 8)
}

function CostMixChart({ report, periodLabel = 'Selected month' }) {
  const parts = [
    { label: 'Materials', value: Number(report?.materials || 0), color: '#5b6cf9' },
    { label: 'Labor', value: Number(report?.labor || 0), color: '#23b7a4' },
    { label: 'Overhead', value: Number(report?.overhead || 0), color: '#f3a24f' },
    { label: 'Other / unmapped', value: Number(report?.other_cost || 0), color: '#ef6b73' },
  ]
  const total = parts.reduce((t, x) => t + x.value, 0)
  let cursor = 0
  const stops = parts.map(x => {
    const start = cursor
    cursor += total ? x.value / total * 100 : 0
    return `${x.color} ${start}% ${cursor}%`
  }).join(', ')
  return <Card className="p-5">
    <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">Cost composition</h2><p className="mt-1 text-xs text-slate-500">{periodLabel} · classified project costs</p></div><span className="rounded-full bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-500">{money(total)}</span></div>
    <div className="mt-5 grid items-center gap-5 sm:grid-cols-[180px_1fr]">
      <div className="relative mx-auto h-40 w-40 rounded-full" style={{ background: total ? `conic-gradient(${stops})` : '#eef1f5' }}>
        <div className="absolute inset-[22px] grid place-items-center rounded-full bg-white text-center"><div><div className="text-[11px] uppercase tracking-wide text-slate-400">Total cost</div><div className="mt-1 text-lg font-semibold text-slate-800">₱{compactMoney(total)}</div></div></div>
      </div>
      <div className="space-y-3">{parts.map(x => <div key={x.label}>
        <div className="flex items-center justify-between gap-3 text-xs"><span className="flex items-center gap-2 font-medium text-slate-600"><span className="h-2.5 w-2.5 rounded-full" style={{ background: x.color }} />{x.label}</span><span className="tabular-nums text-slate-500">{total ? (x.value / total * 100).toFixed(1) : '0.0'}%</span></div>
        <div className="mt-1 text-sm font-semibold text-slate-800">{money(x.value)}</div>
      </div>)}</div>
    </div>
  </Card>
}

function TopSofChart({ rows, periodLabel = 'Selected month' }) {
  const data = [...(rows || [])].filter(x => Number(x.total_cost || 0) > 0 || Number(x.revenue || 0) > 0).sort((a, b) => Number(b.total_cost || 0) - Number(a.total_cost || 0)).slice(0, 6)
  const max = Math.max(1, ...data.flatMap(x => [Number(x.total_cost || 0), Number(x.revenue || 0)]))
  return <Card className="p-5">
    <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">Highest exposure SOFs</h2><p className="mt-1 text-xs text-slate-500">Cost vs revenue · {periodLabel}</p></div><button onClick={() => go('sof')} className="text-xs font-semibold text-indigo-600 hover:text-indigo-800">Open SOF analysis →</button></div>
    <div className="mt-5 space-y-4">
      {data.map(x => <div key={x.sof_key || x.sof_label}>
        <div className="mb-1.5 flex items-center justify-between gap-3 text-xs"><span className="font-semibold text-slate-700">{displaySof(x)}</span><span className="text-slate-400">Cost {money(x.total_cost)}</span></div>
        <div className="space-y-1">
          <div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-indigo-500" style={{ width: `${Math.max(1.5, Number(x.total_cost || 0) / max * 100)}%` }} /></div>
          <div className="h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-emerald-400" style={{ width: `${Number(x.revenue || 0) ? Math.max(1.5, Number(x.revenue || 0) / max * 100) : 0}%` }} /></div>
        </div>
      </div>)}
      {!data.length && <div className="py-10 text-center text-sm text-slate-500">No SOF data available for charting.</div>}
    </div>
    <div className="mt-4 flex items-center gap-4 border-t border-slate-100 pt-3 text-[11px] text-slate-500"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-indigo-500" />Cost</span><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-400" />Revenue</span></div>
  </Card>
}

function RemarksPanel({ report, sofRows, title = 'Management remarks' }) {
  const items = expandedRemarks(report, sofRows)
  return <Card className="p-5">
    <div className="mb-4 flex items-start justify-between gap-3"><div><h2 className="font-semibold">{title}</h2><p className="mt-1 text-xs text-slate-500">Exceptions, concentration risks, and month-end actions</p></div><span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-600">{items.length} insights</span></div>
    <div className="space-y-2.5">{items.map((x, i) => <div key={i} className="rounded-lg border border-slate-100 bg-slate-50/70 p-3.5 text-sm leading-6 text-slate-600"><span className="mr-2 inline-grid h-5 w-5 place-items-center rounded-full bg-white text-[11px] font-bold text-indigo-600 shadow-sm">{i + 1}</span>{x}</div>)}</div>
  </Card>
}

function Dashboard() {
  const latest = useLatest()
  const [month, setMonth] = useState(monthInput())
  const [r, setR] = useState(null)
  const [tx, setTx] = useState([])
  const [sofRows, setSofRows] = useState([])
  const [err, setErr] = useState('')
  useEffect(() => { if (latest?.report_date) setMonth(latest.report_date.slice(0, 7)) }, [latest])
  useEffect(() => {
    if (!month) return
    const { start, end } = monthBounds(month)
    if (!start || !end) return
    setR(null); setTx([]); setSofRows([])
    Promise.all([
      supabase.rpc('income_monthly_report', { p_month: start }),
      supabase.from('income_transactions_ready').select('*').gte('transaction_date', start).lt('transaction_date', end).order('transaction_date', { ascending: false }).limit(10),
      supabase.rpc('income_monthly_sof_summary', { p_month: start }),
    ]).then(([a, b, c]) => {
      if (a.error || b.error || c.error) setErr(a.error?.message || b.error?.message || c.error?.message)
      else { setR(a.data); setTx(b.data || []); setSofRows([...(c.data || [])].sort(compareSof)); setErr('') }
    })
  }, [month])
  const period = monthLabel(month)
  const grossTone = Number(r?.gross_profit || 0) < 0 ? 'rose' : 'emerald'
  return <>
    <Header title="Dashboard" sub={`${period} financial position with visual cost exposure, SOF concentration, and management review remarks.`} actions={<><MonthPicker value={month} onChange={setMonth} /><Button onClick={() => go('upload')}>Upload QB file</Button></>} />
    <ErrorBox v={err} />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Stat label="Revenue" value={money(r?.revenue)} tone="emerald" /><Stat label="Total Cost" value={money(r?.total_cost)} tone="amber" /><Stat label="Gross Profit" value={money(r?.gross_profit)} note={`Margin ${pct(r?.margin_pct)}`} tone={grossTone} /><Stat label="Active SOFs" value={number(r?.unique_sof)} note={`${number(r?.unassigned_count)} unassigned`} tone="indigo" /></div>
    <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-2"><CostMixChart report={r} periodLabel={period} /><TopSofChart rows={sofRows} periodLabel={period} /></div>
    <div className="mt-5 grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,1fr)_440px]">
      <Card><div className="border-b border-slate-100 px-4 py-3"><h2 className="text-sm font-semibold">{period} transactions</h2><p className="mt-1 text-xs text-slate-500">Most recent QuickBooks activity within the selected month</p></div><Table minWidth={620} heads={['Date','SOF','Type','Account','Debit / Credit']} rows={tx} row={x => <tr key={x.id}><td className="px-3 py-3 whitespace-nowrap">{shortDate(x.transaction_date)}</td><td className="px-3 py-3 font-medium">{displaySof(x)}</td><td className="px-3 py-3 break-words">{x.type}</td><td className="px-3 py-3 break-words">{x.account || '—'}</td><td className="px-3 py-3 whitespace-nowrap"><div>Dr {money(x.debit)}</div><div className="text-xs text-slate-500">Cr {money(x.credit)}</div></td></tr>} /></Card>
      <RemarksPanel report={r} sofRows={sofRows} title={`${period} management remarks`} />
    </div>
  </>
}

function Upload() {
  const [p, setP] = useState(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  async function choose(e) {
    setErr(''); setMsg('')
    try { setBusy(true); setP(await parseQuickBooksFile(e.target.files[0])) } catch (x) { setErr(x.message) } finally { setBusy(false) }
  }
  async function send() {
    try { setBusy(true); await uploadQuickBooks(p, setProgress); setMsg(`${p.sheetName} imported: ${number(p.transactions.length)} transactions`) } catch (x) { setErr(x.message) } finally { setBusy(false) }
  }
  return <>
    <Header title="QB Upload" sub="Upload CSV/XLS/XLSX. The site detects the QB layout and reads it immediately." />
    <ErrorBox v={err} />
    {msg && <div className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{msg}</div>}
    <Card className="p-5"><label className="block rounded-xl border-2 border-dashed p-8 text-center"><input hidden type="file" accept=".csv,.xlsx,.xls" onChange={choose} /><b>{busy && !p ? 'Reading file…' : 'Choose QuickBooks export'}</b><div className="mt-1 text-sm text-slate-500">CSV, XLSX or XLS</div></label></Card>
    {p && <Card className="mt-5"><div className="grid gap-4 border-b p-4 sm:grid-cols-2 xl:grid-cols-4"><div><small>Worksheet</small><b className="block break-words">{p.sheetName}</b></div><div><small>Report date</small><b className="block">{shortDate(p.reportDate)}</b></div><div><small>Transactions</small><b className="block">{number(p.transactions.length)}</b></div><Button disabled={busy} onClick={send}>{busy ? `Uploading ${progress}%` : 'Import now'}</Button></div><Table minWidth={660} heads={['Date','SOF','Type','Account / Category','Debit / Credit']} rows={p.transactions.slice(0, 10)} row={x => <tr key={x.source_row}><td className="px-3 py-3 whitespace-nowrap">{shortDate(x.transaction_date)}</td><td className="px-3 py-3 font-medium">{displaySof(x)}</td><td className="px-3 py-3 break-words">{x.type}</td><td className="px-3 py-3 break-words"><div>{x.account || '—'}</div><div className="text-xs text-slate-500">{x.category}</div></td><td className="px-3 py-3 whitespace-nowrap"><div>Dr {money(x.debit)}</div><div className="text-xs text-slate-500">Cr {money(x.credit)}</div></td></tr>} /></Card>}
  </>
}

function Monthly() {
  const latest = useLatest()
  const [month, setMonth] = useState(monthInput())
  const [r, setR] = useState(null)
  const [rows, setRows] = useState([])
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [err, setErr] = useState('')
  useEffect(() => { if (latest) setMonth(latest.report_date.slice(0, 7)) }, [latest])
  useEffect(() => {
    Promise.all([supabase.rpc('income_monthly_report', { p_month: month + '-01' }), supabase.rpc('income_monthly_sof_summary', { p_month: month + '-01' })]).then(([a, b]) => {
      if (a.error || b.error) setErr(a.error?.message || b.error?.message)
      else { setR(a.data); setRows([...(b.data || [])].sort(compareSof)); setPage(0); setErr('') }
    })
  }, [month])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(x => `${displaySof(x)} ${x.sof_label || ''} ${x.sof_key || ''}`.toLowerCase().includes(q))
  }, [rows, search])
  useEffect(() => setPage(0), [search])
  const data = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
  const grossTone = Number(r?.gross_profit || 0) < 0 ? 'rose' : 'emerald'
  return <>
    <Header title="Monthly Report" sub="End-of-month financial report. Search an SOF or review the month in numeric SOF order." actions={<><SearchInput value={search} onChange={setSearch} placeholder="Search SOF…" /><MonthPicker value={month} onChange={setMonth} label="Report month" /><Button secondary onClick={() => window.print()}>Print / PDF</Button></>} />
    <ErrorBox v={err} />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Stat label="Revenue" value={money(r?.revenue)} tone="emerald" /><Stat label="Materials" value={money(r?.materials)} tone="indigo" /><Stat label="Labor" value={money(r?.labor)} tone="cyan" /><Stat label="Overhead" value={money(r?.overhead)} tone="amber" /><Stat label="Gross Profit" value={money(r?.gross_profit)} note={`Margin ${pct(r?.margin_pct)}`} tone={grossTone} /></div>
    <div className="mt-5 grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,1fr)_440px]">
      <Card><Table minWidth={680} heads={['SOF','Tx','Revenue','Total Cost','Gross Profit','Margin']} rows={data} row={x => <tr key={x.sof_key}><td className="px-3 py-3 font-medium">{displaySof(x)}</td><td className="px-3 py-3">{number(x.transaction_count)}</td><td className="px-3 py-3 whitespace-nowrap">{money(x.revenue)}</td><td className="px-3 py-3"><CostCell row={x} /></td><td className="px-3 py-3 whitespace-nowrap">{money(x.gross_profit)}</td><td className="px-3 py-3 whitespace-nowrap">{pct(x.margin_pct)}</td></tr>} /><Pager page={page} total={filtered.length} setPage={setPage} /></Card>
      <RemarksPanel report={r} sofRows={rows} title={`${monthLabel(month)} review remarks`} />
    </div>
  </>
}

function buildSofRegister(summaries, references) {
  const summaryByBase = new Map()
  for (const s of summaries || []) {
    const base = sofBaseNumber(s)
    if (base == null) continue
    const prev = summaryByBase.get(base) || { base, transaction_count: 0, revenue: 0, materials: 0, labor: 0, overhead: 0, other_cost: 0, total_cost: 0, gross_profit: 0, first_transaction_date: null, last_transaction_date: null }
    prev.transaction_count += Number(s.transaction_count || 0)
    prev.revenue = sum(prev.revenue, s.revenue)
    prev.materials = sum(prev.materials, s.materials)
    prev.labor = sum(prev.labor, s.labor)
    prev.overhead = sum(prev.overhead, s.overhead)
    prev.other_cost = sum(prev.other_cost, s.other_cost)
    prev.total_cost = sum(prev.total_cost, s.total_cost)
    prev.gross_profit = sum(prev.gross_profit, s.gross_profit)
    prev.first_transaction_date = !prev.first_transaction_date || (s.first_transaction_date && s.first_transaction_date < prev.first_transaction_date) ? s.first_transaction_date : prev.first_transaction_date
    prev.last_transaction_date = !prev.last_transaction_date || (s.last_transaction_date && s.last_transaction_date > prev.last_transaction_date) ? s.last_transaction_date : prev.last_transaction_date
    summaryByBase.set(base, prev)
  }

  const refByBase = new Map()
  for (const r of references || []) {
    for (const base of referenceBases(r)) {
      if (!refByBase.has(base)) refByBase.set(base, [])
      refByBase.get(base).push(r)
    }
  }

  const allBases = [...new Set([...summaryByBase.keys(), ...refByBase.keys()])].sort((a, b) => a - b)
  return allBases.map(base => {
    const s = summaryByBase.get(base) || { base, transaction_count: 0, revenue: 0, materials: 0, labor: 0, overhead: 0, other_cost: 0, total_cost: 0, gross_profit: 0 }
    const refs = refByBase.get(base) || []
    const primary = [...refs].sort((a, b) => {
      const aExact = String(a.sof_key || '').trim() === String(base) ? 1 : 0
      const bExact = String(b.sof_key || '').trim() === String(base) ? 1 : 0
      if (aExact !== bExact) return bExact - aExact
      const aProject = a.project_name ? 1 : 0
      const bProject = b.project_name ? 1 : 0
      if (aProject !== bProject) return bProject - aProject
      return Number(a.source_row || 0) - Number(b.source_row || 0)
    })[0]
    const project = refs.find(x => x.project_name)?.project_name || primary?.project_name || null
    const status = primary?.project_status || refs.find(x => x.project_status)?.project_status || null
    const sourceRemarks = [...new Set(refs.map(x => cleanRemark(x.remarks)).filter(Boolean))]
    const sharedReference = primary ? referenceBases(primary).length > 1 : false
    const budget = Number(primary?.total_cost_budget || 0)
    const budgetVariance = s.transaction_count && budget > 0 && !sharedReference ? budget - Number(s.total_cost || 0) : null
    const margin = Number(s.revenue || 0) !== 0 ? Number(s.gross_profit || 0) / Number(s.revenue || 0) * 100 : null
    let remark = sourceRemarks.join(' • ')
    if (!remark && !refs.length) remark = 'No Reference Data match.'
    else if (!remark && !s.transaction_count) remark = 'No QB transactions found.'
    else if (!remark) remark = 'Matched; no reference remark.'
    if (sharedReference) remark = `${remark} Shared reference covers multiple SOFs.`.trim()
    return { ...s, sof_base: String(base), sof_key: String(base), sof_label: `SOF ${base}`, project_name: project, project_status: status, margin_pct: margin, budget_variance: budgetVariance, remark, has_reference: !!refs.length }
  })
}

function SofAnalysis() {
  const [summaries, setSummaries] = useState([])
  const [references, setReferences] = useState([])
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [err, setErr] = useState('')
  useEffect(() => {
    Promise.all([
      supabase.from('income_sof_summary').select('*').limit(1000),
      supabase.from('income_reference_projects').select('*').limit(1000),
    ]).then(([a, b]) => {
      if (a.error || b.error) setErr(a.error?.message || b.error?.message)
      else { setSummaries(a.data || []); setReferences(b.data || []); setErr('') }
    })
  }, [])
  const rows = useMemo(() => buildSofRegister(summaries, references), [summaries, references])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(x => `${displaySof(x)} ${x.project_name || ''} ${x.project_status || ''} ${x.remark || ''}`.toLowerCase().includes(q))
  }, [rows, search])
  useEffect(() => setPage(0), [search])
  const data = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
  return <>
    <Header title="SOF Analysis" sub="All known SOFs from Reference Data and QB are combined and sorted numerically. Use the search box to find a specific SOF, project, status, or remark." actions={<SearchInput value={search} onChange={setSearch} placeholder="Search SOF or project…" />} />
    <ErrorBox v={err} />
    <div className="mb-3 text-xs text-slate-500">{search ? `${number(filtered.length)} matching SOF${filtered.length === 1 ? '' : 's'} out of ${number(rows.length)}` : `${number(rows.length)} SOFs in register`}</div>
    <Card>
      <Table minWidth={760} heads={['SOF / Project','Status','Revenue','Total Cost','Gross Profit','Margin / Budget','Remarks']} rows={data} row={x => <tr key={x.sof_key}>
        <td className="px-3 py-3"><b>{displaySof(x)}</b><div className="mt-1 break-words text-xs leading-5 text-slate-500">{x.project_name || 'No reference project'}</div></td>
        <td className="px-3 py-3"><span className="inline-block rounded-full bg-slate-100 px-2 py-1 text-xs">{x.project_status || '—'}</span></td>
        <td className="px-3 py-3 whitespace-nowrap">{money(x.revenue)}</td>
        <td className="px-3 py-3"><CostCell row={x} /></td>
        <td className="px-3 py-3 whitespace-nowrap">{money(x.gross_profit)}</td>
        <td className="px-3 py-3"><div className="whitespace-nowrap">{pct(x.margin_pct)}</div><div className="mt-1 text-xs text-slate-500">{x.budget_variance == null ? 'Budget —' : `Var ${money(x.budget_variance)}`}</div></td>
        <td className="px-3 py-3 break-words text-xs leading-5 text-slate-600">{x.remark}</td>
      </tr>} />
      <Pager page={page} total={filtered.length} setPage={setPage} />
    </Card>
  </>
}

function ReferenceData() {
  const [allRows, setAllRows] = useState([])
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [err, setErr] = useState('')
  useEffect(() => {
    supabase.from('income_reference_projects').select('*').limit(1000).then(({ data, error }) => {
      if (error) setErr(error.message)
      else { setAllRows([...(data || [])].sort(compareSof)); setErr('') }
    })
  }, [])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return allRows
    return allRows.filter(x => `${x.sof_number || ''} ${x.project_name || ''} ${x.project_status || ''} ${cleanRemark(x.remarks)}`.toLowerCase().includes(q))
  }, [allRows, search])
  useEffect(() => setPage(0), [search])
  const rows = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
  return <>
    <Header title="Reference Data" sub="Project/SOF master data sorted numerically by SOF. Search by SOF, project, status, or remark." actions={<SearchInput value={search} onChange={setSearch} placeholder="Search SOF or project…" />} />
    <ErrorBox v={err} />
    <Card>
      <Table minWidth={720} heads={['SOF','Project','Status','Contract','Budget','Remarks']} rows={rows} row={x => <tr key={x.id}>
        <td className="px-3 py-3 font-medium">{x.sof_number || '—'}</td>
        <td className="px-3 py-3 break-words">{x.project_name || 'Continuation row'}</td>
        <td className="px-3 py-3">{x.project_status || '—'}</td>
        <td className="px-3 py-3 whitespace-nowrap">{money(x.final_contract_value || x.contract_value)}</td>
        <td className="px-3 py-3"><div className="whitespace-nowrap font-medium">{money(x.total_cost_budget)}</div><div className="mt-1 text-[11px] leading-4 text-slate-500">M {money(x.materials_budget)} · L {money(x.labor_budget)} · O {money(x.overhead_budget)}</div></td>
        <td className="px-3 py-3 break-words text-xs leading-5 text-slate-600">{cleanRemark(x.remarks) || '—'}</td>
      </tr>} />
      <Pager page={page} total={filtered.length} setPage={setPage} />
    </Card>
  </>
}

function PagedTable({ kind }) {
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [err, setErr] = useState('')
  useEffect(() => {
    let q
    if (kind === 'transactions') q = supabase.from('income_transactions_ready').select('*', { count: 'exact' }).order('transaction_date', { ascending: false })
    if (kind === 'worksheets') q = supabase.from('income_qb_uploads').select('*', { count: 'exact' }).order('report_date', { ascending: false })
    q.range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1).then(({ data, count, error }) => {
      if (error) setErr(error.message)
      else { setRows(data || []); setTotal(count || 0); setErr('') }
    })
  }, [kind, page])
  let title, sub, heads, row, minWidth = 650
  if (kind === 'transactions') {
    title = 'Transactions'
    sub = 'All QuickBooks transactions, 10 rows per page.'
    heads = ['Date','SOF','Type / Name','Account','Category','Debit / Credit']
    row = x => <tr key={x.id}><td className="px-3 py-3 whitespace-nowrap">{shortDate(x.transaction_date)}</td><td className="px-3 py-3 font-medium">{displaySof(x)}</td><td className="px-3 py-3 break-words"><div>{x.type || '—'}</div><div className="text-xs text-slate-500">{x.name || '—'}</div></td><td className="px-3 py-3 break-words">{x.account || '—'}</td><td className="px-3 py-3">{x.category}</td><td className="px-3 py-3 whitespace-nowrap"><div>Dr {money(x.debit)}</div><div className="text-xs text-slate-500">Cr {money(x.credit)}</div></td></tr>
  } else {
    title = 'QB Worksheets'
    sub = 'Date-based imported QB batches. Re-uploading the same date replaces the batch.'
    heads = ['Worksheet','Report Date','File','Coverage','Transactions','Status']
    minWidth = 620
    row = x => <tr key={x.id}><td className="px-3 py-3 font-medium">{x.sheet_name}</td><td className="px-3 py-3 whitespace-nowrap">{shortDate(x.report_date)}</td><td className="px-3 py-3 break-words">{x.file_name}</td><td className="px-3 py-3 whitespace-nowrap">{shortDate(x.detected_min_date)} – {shortDate(x.detected_max_date)}</td><td className="px-3 py-3">{number(x.transaction_count)}</td><td className="px-3 py-3">{x.status}</td></tr>
  }
  return <>
    <Header title={title} sub={sub} actions={kind === 'worksheets' ? <Button onClick={() => go('upload')}>New upload</Button> : null} />
    <ErrorBox v={err} />
    <Card><Table minWidth={minWidth} heads={heads} rows={rows} row={row} /><Pager page={page} total={total} setPage={setPage} /></Card>
  </>
}

function Missing() { return <div className="p-8">Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.</div> }
export default function App() {
  const [page, setPage] = useState(pageNow())
  useEffect(() => { const f = () => setPage(pageNow()); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f) }, [])
  if (!supabase) return <Missing />
  const pages = { dashboard: <Dashboard />, upload: <Upload />, monthly: <Monthly />, sof: <SofAnalysis />, transactions: <PagedTable kind="transactions" />, reference: <ReferenceData />, worksheets: <PagedTable kind="worksheets" /> }
  return <Shell>{pages[page]}</Shell>
}
