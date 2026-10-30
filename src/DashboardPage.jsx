import React, { useEffect, useMemo, useState } from 'react'
import { supabase, money, number, pct, shortDate } from './lib.js'

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

const go = page => { location.hash = `#/${page}` }
const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim()
const compactMoney = value => new Intl.NumberFormat('en-PH', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value || 0))

function monthLabel(value) {
  if (!value || value === 'all') return 'All dates'
  const [year, month] = value.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
}

function monthBounds(value) {
  if (!value || value === 'all') return null
  const [year, month] = value.split('-').map(Number)
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const end = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10)
  return { start, end }
}

function referenceBases(row) {
  const raw = String(row?.sof_number || '').replace(/^SOF\s*/i, '').trim()
  if (/^\d+(?:\s*(?:,|&)\s*\d+)+$/.test(raw)) return [...new Set(raw.match(/\d+/g).map(Number))]
  const range = raw.match(/^(\d+)\s*-\s*(\d+)$/)
  if (range && Number(range[2]) === Number(range[1]) + 1) return [Number(range[1]), Number(range[2])]
  const match = raw.match(/\d+/)
  return match ? [Number(match[0])] : []
}

function projectNameForBase(base, references) {
  const hit = references.find(row => referenceBases(row).includes(Number(base)) && clean(row.project_name))
  return clean(hit?.project_name) || ''
}

function displaySof(row) {
  const raw = row?.sof_base ?? row?.sof_key ?? row?.sof_label ?? ''
  const match = String(raw).match(/\d+/)
  return match ? `SOF ${Number(match[0])}` : (row?.sof_label || 'Unassigned')
}

function Shell({ children }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const close = () => setOpen(false)
    const key = e => { if (e.key === 'Escape') setOpen(false) }
    addEventListener('hashchange', close)
    addEventListener('keydown', key)
    return () => { removeEventListener('hashchange', close); removeEventListener('keydown', key) }
  }, [])

  return <div className="min-h-screen w-full overflow-x-hidden bg-[#f7f8fa]">
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-16 max-w-[1500px] items-center gap-3 px-4 lg:px-6">
        <button aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} className="shrink-0" onClick={() => setOpen(v => !v)}>☰</button>
        <button onClick={() => go('dashboard')} className="min-w-0 text-left">
          <b className="block truncate text-sm">E-WORKS Income Report</b>
          <div className="truncate text-xs text-slate-500">Finance reporting workspace</div>
        </button>
      </div>
    </header>
    {open && <button aria-label="Close navigation" onClick={() => setOpen(false)} className="fixed inset-0 top-16 z-40 bg-slate-950/30 backdrop-blur-[1px]" />}
    <aside className={`${open ? 'block' : 'hidden'} fixed left-0 top-16 z-50 h-[calc(100vh-4rem)] w-64 border-r border-slate-200 bg-[#171d2c] p-3 text-white shadow-xl`}>
      <nav className="space-y-1">{NAV.map(([id, label]) => <button key={id} onClick={() => go(id)} className={`w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium ${id === 'dashboard' ? 'bg-white text-slate-900' : 'text-slate-300 hover:bg-white/10 hover:text-white'}`}>{label}</button>)}</nav>
    </aside>
    <main className="mx-auto w-full min-w-0 max-w-[1500px] overflow-x-hidden p-4 lg:p-6 xl:p-8">{children}</main>
  </div>
}

function Card({ children, className = '' }) {
  return <div className={`min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>
}

const TONES = {
  emerald: ['#10b981', '#ecfdf5', '#047857', '#d1fae5'],
  rose: ['#ef4444', '#fff1f2', '#be123c', '#ffe4e6'],
  amber: ['#f59e0b', '#fffbeb', '#b45309', '#fef3c7'],
  indigo: ['#6366f1', '#eef2ff', '#4f46e5', '#e0e7ff'],
}

function Stat({ label, value, note, tone = 'indigo' }) {
  const [accent, soft, text, border] = TONES[tone] || TONES.indigo
  return <Card className="relative p-4" >
    <div className="absolute inset-x-0 top-0 h-1" style={{ background: accent }} />
    <div className="flex items-center gap-2">
      <span className="inline-grid h-6 w-6 place-items-center rounded-md" style={{ background: soft }}><span className="h-2.5 w-2.5 rounded-full" style={{ background: accent }} /></span>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
    </div>
    <div className="mt-2 break-words text-xl font-semibold sm:text-2xl" style={{ color: text }}>{value}</div>
    {note && <div className="mt-1 text-xs text-slate-500">{note}</div>}
    <div className="pointer-events-none absolute inset-0 rounded-xl border" style={{ borderColor: border }} />
  </Card>
}

function FilterSelect({ label, value, onChange, children, minWidth = '190px' }) {
  return <label className="block min-w-0 flex-1 sm:flex-none">
    <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{label}</span>
    <select value={value} onChange={e => onChange(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 shadow-sm" style={{ minWidth }}>{children}</select>
  </label>
}

function CostMixChart({ report, scope }) {
  const parts = [
    ['Materials', Number(report?.materials || 0), '#5b6cf9'],
    ['Labor', Number(report?.labor || 0), '#23b7a4'],
    ['Overhead', Number(report?.overhead || 0), '#f3a24f'],
    ['Other / unmapped', Number(report?.other_cost || 0), '#ef6b73'],
  ]
  const total = parts.reduce((sum, [, value]) => sum + value, 0)
  let cursor = 0
  const stops = parts.map(([, value, color]) => {
    const start = cursor
    cursor += total ? value / total * 100 : 0
    return `${color} ${start}% ${cursor}%`
  }).join(', ')

  return <Card className="p-5">
    <div className="flex items-start justify-between gap-3">
      <div><h2 className="font-semibold">Cost composition</h2><p className="mt-1 text-xs text-slate-500">{scope}</p></div>
      <span className="rounded-full bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-500">{money(total)}</span>
    </div>
    <div className="mt-5 grid items-center gap-5 sm:grid-cols-[180px_1fr]">
      <div className="relative mx-auto h-40 w-40 rounded-full" style={{ background: total ? `conic-gradient(${stops})` : '#eef1f5' }}>
        <div className="absolute inset-[22px] grid place-items-center rounded-full bg-white text-center"><div><div className="text-[11px] uppercase tracking-wide text-slate-400">Total cost</div><div className="mt-1 text-lg font-semibold text-slate-800">₱{compactMoney(total)}</div></div></div>
      </div>
      <div className="space-y-3">{parts.map(([label, value, color]) => <div key={label} className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 text-xs font-medium text-slate-600"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />{label}</span>
        <span className="whitespace-nowrap text-sm font-semibold text-slate-800">{money(value)}</span>
      </div>)}</div>
    </div>
  </Card>
}

function ExposureChart({ rows, scope }) {
  const data = [...(rows || [])].filter(x => Number(x.total_cost || 0) || Number(x.revenue || 0)).sort((a, b) => Number(b.total_cost || 0) - Number(a.total_cost || 0)).slice(0, 6)
  const max = Math.max(1, ...data.flatMap(x => [Number(x.total_cost || 0), Number(x.revenue || 0)]))
  return <Card className="p-5">
    <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">SOF cost vs revenue</h2><p className="mt-1 text-xs text-slate-500">{scope}</p></div><button onClick={() => go('sof')} className="text-xs font-semibold text-indigo-600">SOF Analysis →</button></div>
    <div className="mt-5 space-y-4">{data.map(row => <div key={row.sof_base || row.sof_label}>
      <div className="mb-1.5 flex items-center justify-between gap-3 text-xs"><span className="font-semibold text-slate-700">{displaySof(row)}</span><span className="whitespace-nowrap text-slate-400">Cost {money(row.total_cost)}</span></div>
      <div className="space-y-1"><div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-indigo-500" style={{ width: `${Math.max(1.5, Number(row.total_cost || 0) / max * 100)}%` }} /></div><div className="h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-emerald-400" style={{ width: `${Number(row.revenue || 0) ? Math.max(1.5, Number(row.revenue || 0) / max * 100) : 0}%` }} /></div></div>
    </div>)}{!data.length && <div className="py-10 text-center text-sm text-slate-500">No data for the selected filters.</div>}</div>
    <div className="mt-4 flex items-center gap-4 border-t border-slate-100 pt-3 text-[11px] text-slate-500"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-indigo-500" />Cost</span><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-400" />Revenue</span></div>
  </Card>
}

function Remarks({ report, sofRows, scope }) {
  const revenue = Number(report?.revenue || 0)
  const cost = Number(report?.total_cost || 0)
  const gross = Number(report?.gross_profit || 0)
  const other = Number(report?.other_cost || 0)
  const active = (sofRows || []).filter(row => Number(row.transaction_count || 0) > 0)
  const loss = active.filter(row => Number(row.gross_profit || 0) < 0)
  const noRevenue = active.filter(row => Number(row.total_cost || 0) > 0 && Number(row.revenue || 0) <= 0)
  const top = [...active].sort((a, b) => Number(b.total_cost || 0) - Number(a.total_cost || 0))[0]
  const insights = []
  insights.push(`${scope}: revenue is ${money(revenue)} against ${money(cost)} total cost, resulting in ${gross < 0 ? 'a gross loss' : 'gross profit'} of ${money(Math.abs(gross))}.`)
  if (cost > 0 && other / cost >= .2) insights.push(`Other / unmapped cost is ${money(other)}, a material share of recorded cost. Review account classification and SOF allocation.`)
  if (top) insights.push(`${displaySof(top)} has the highest cost exposure at ${money(top.total_cost)}${Number(top.revenue || 0) ? ` against ${money(top.revenue)} revenue` : ' with no matching revenue in this scope'}.`)
  if (active.length) insights.push(`${number(loss.length)} of ${number(active.length)} active SOFs show negative gross profit, while ${number(noRevenue.length)} carry cost without matching revenue.`)
  const accounts = Array.isArray(report?.top_cost_accounts) ? report.top_cost_accounts.slice(0, 3) : []
  if (accounts.length) insights.push(`Largest cost accounts: ${accounts.map(a => `${a.account || 'Unspecified'} (${money(a.net_cost)})`).join(', ')}.`)

  return <Card className="p-5">
    <div className="mb-4 flex items-start justify-between gap-3"><div><h2 className="font-semibold">Management remarks</h2><p className="mt-1 text-xs text-slate-500">Insights for the selected Month + SOF scope</p></div><span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-600">{insights.length} insights</span></div>
    <div className="space-y-2.5">{insights.map((item, index) => <div key={index} className="rounded-lg border border-slate-100 bg-slate-50/70 p-3.5 text-sm leading-6 text-slate-600"><span className="mr-2 inline-grid h-5 w-5 place-items-center rounded-full bg-white text-[11px] font-bold text-indigo-600 shadow-sm">{index + 1}</span>{item}</div>)}</div>
  </Card>
}

function Transactions({ rows, scope }) {
  return <Card>
    <div className="border-b border-slate-100 px-4 py-3"><h2 className="text-sm font-semibold">Recent transactions</h2><p className="mt-1 text-xs text-slate-500">Latest QuickBooks activity · {scope}</p></div>
    <div className="w-full max-w-full overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm">
      <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-3">Date</th><th className="px-3 py-3">SOF</th><th className="px-3 py-3">Type</th><th className="px-3 py-3">Account</th><th className="px-3 py-3">Debit / Credit</th></tr></thead>
      <tbody className="divide-y divide-slate-100">{rows.map(row => <tr key={row.id}><td className="whitespace-nowrap px-3 py-3">{shortDate(row.transaction_date)}</td><td className="px-3 py-3 font-medium">{displaySof(row)}</td><td className="px-3 py-3">{row.type || '—'}</td><td className="px-3 py-3">{row.account || '—'}</td><td className="whitespace-nowrap px-3 py-3"><div>Dr {money(row.debit)}</div><div className="text-xs text-slate-500">Cr {money(row.credit)}</div></td></tr>)}</tbody>
    </table>{!rows.length && <div className="p-8 text-center text-sm text-slate-500">No transactions match the selected filters.</div>}</div>
  </Card>
}

export default function DashboardPage() {
  const [month, setMonth] = useState('all')
  const [sof, setSof] = useState('all')
  const [report, setReport] = useState(null)
  const [sofRows, setSofRows] = useState([])
  const [months, setMonths] = useState([])
  const [sofs, setSofs] = useState([])
  const [references, setReferences] = useState([])
  const [transactions, setTransactions] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('income_reference_projects').select('sof_number,project_name').limit(2000).then(({ data }) => setReferences(data || []))
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      const monthParam = month === 'all' ? null : `${month}-01`
      const sofParam = sof === 'all' ? null : sof
      const rpcPromise = supabase.rpc('income_dashboard_filtered', { p_month: monthParam, p_sof_base: sofParam })

      let query = supabase.from('income_transactions_ready').select('*').order('transaction_date', { ascending: false }).order('id', { ascending: false }).limit(10)
      const bounds = monthBounds(month)
      if (bounds) query = query.gte('transaction_date', bounds.start).lt('transaction_date', bounds.end)
      if (sof !== 'all') query = query.eq('sof_base', sof)

      const [rpcResult, txResult] = await Promise.all([rpcPromise, query])
      if (cancelled) return
      if (rpcResult.error || txResult.error) {
        setError(rpcResult.error?.message || txResult.error?.message || 'Unable to load dashboard data.')
      } else {
        const data = rpcResult.data || {}
        setReport(data.report || null)
        setSofRows(data.sof_rows || [])
        setMonths(data.months || [])
        setSofs(data.sofs || [])
        setTransactions(txResult.data || [])
      }
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [month, sof])

  const sofOptions = useMemo(() => (sofs || []).map(item => ({
    ...item,
    project: projectNameForBase(item.sof_base, references) || clean(item.sof_label),
  })), [sofs, references])

  const selectedProject = sof === 'all' ? '' : (sofOptions.find(item => String(item.sof_base) === String(sof))?.project || '')
  const period = monthLabel(month)
  const sofScope = sof === 'all' ? 'All SOFs' : `SOF ${sof}${selectedProject ? ` — ${selectedProject}` : ''}`
  const scope = `${period} · ${sofScope}`
  const grossTone = Number(report?.gross_profit || 0) < 0 ? 'rose' : 'emerald'

  return <Shell>
    <div className="mb-5 flex min-w-0 flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
      <div className="min-w-0"><h1 className="text-2xl font-semibold text-slate-950">Dashboard</h1><p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">Filter the full financial dashboard by Month and SOF. Both controls support ALL and work together.</p></div>
      <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row xl:w-auto">
        <FilterSelect label="Month" value={month} onChange={setMonth}><option value="all">ALL Months</option>{months.map(value => <option key={value} value={value}>{monthLabel(value)}</option>)}</FilterSelect>
        <FilterSelect label="SOF" value={sof} onChange={setSof} minWidth="310px"><option value="all">ALL SOFs</option>{sofOptions.map(item => <option key={item.sof_base} value={item.sof_base}>SOF {item.sof_base}{item.project ? ` — ${item.project}` : ''}</option>)}</FilterSelect>
        <button onClick={() => go('upload')} className="self-end rounded-lg bg-slate-900 px-3.5 py-2.5 text-sm font-medium text-white">Upload file</button>
      </div>
    </div>

    <div className="mb-4 flex flex-wrap items-center gap-2 text-xs"><span className="rounded-full bg-indigo-50 px-3 py-1.5 font-semibold text-indigo-700">Month: {period}</span><span className="max-w-full truncate rounded-full bg-emerald-50 px-3 py-1.5 font-semibold text-emerald-700">SOF: {sofScope}</span>{(month !== 'all' || sof !== 'all') && <button onClick={() => { setMonth('all'); setSof('all') }} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-500 hover:text-slate-800">Reset to ALL</button>}</div>

    {error && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
    {loading && !report && <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">Loading filtered dashboard…</div>}

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Stat label="Revenue" value={money(report?.revenue)} tone="emerald" />
      <Stat label="Total Cost" value={money(report?.total_cost)} tone="amber" />
      <Stat label="Gross Profit" value={money(report?.gross_profit)} note={`Margin ${pct(report?.margin_pct)}`} tone={grossTone} />
      <Stat label="Active SOFs" value={number(report?.unique_sof)} note={`${number(report?.transaction_count)} transactions`} tone="indigo" />
    </div>

    <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-2"><CostMixChart report={report} scope={scope} /><ExposureChart rows={sofRows} scope={scope} /></div>
    <div className="mt-5 grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,1fr)_440px]"><Transactions rows={transactions} scope={scope} /><Remarks report={report} sofRows={sofRows} scope={scope} /></div>
  </Shell>
}
