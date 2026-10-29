import React, { useEffect, useMemo, useState } from 'react'
import { supabase, money, pct, shortDate } from './lib.js'

const NAV = [['dashboard','Dashboard'],['upload','QB Upload'],['monthly','Monthly Report'],['sof','SOF Analysis'],['transactions','Transactions'],['reference','Reference Data'],['worksheets','QB Worksheets']]
const go = (p) => { location.hash = `#/${p}` }
const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim()
const num = (v) => Number(v || 0)
const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, num(v)))
const percent = (value, base) => !base ? '—' : `${(value / base * 100).toFixed(2)}%`
const sofBase = (row) => {
  const raw = row?.sof_base ?? row?.sof_number ?? row?.sof_key ?? row?.sof_label ?? ''
  const match = String(raw).match(/\d+/)
  return match ? Number(match[0]) : null
}
const refBases = (row) => {
  const raw = clean(row?.sof_number).replace(/^SOF\s*/i, '')
  if (/^\d+(?:\s*(?:,|&)\s*\d+)+$/.test(raw)) return [...new Set(raw.match(/\d+/g).map(Number))]
  const range = raw.match(/^(\d+)\s*-\s*(\d+)$/)
  if (range && Number(range[2]) === Number(range[1]) + 1) return [Number(range[1]), Number(range[2])]
  const base = sofBase(row)
  return base == null ? [] : [base]
}
const sourceDate = (value) => {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })
}

function Shell({ children }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const close = () => setOpen(false)
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    addEventListener('hashchange', close)
    addEventListener('keydown', onKey)
    return () => { removeEventListener('hashchange', close); removeEventListener('keydown', onKey) }
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
      <nav className="space-y-1">{NAV.map(([id, label]) => <button key={id} onClick={() => go(id)} className={`w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium ${id === 'sof' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{label}</button>)}</nav>
    </aside>
    <main className="w-full min-w-0 overflow-x-hidden p-4 lg:p-6 xl:p-8">{children}</main>
  </div>
}

function InfoRow({ label, value, strong = false }) {
  return <div className="grid min-w-0 grid-cols-[132px_minmax(0,1fr)] items-center gap-2 text-xs sm:grid-cols-[150px_minmax(0,1fr)]">
    <span className="font-medium uppercase tracking-wide text-slate-500">{label}</span>
    <span className={`min-w-0 break-words rounded-sm bg-[#dbe9f6] px-2.5 py-1.5 text-slate-900 ${strong ? 'font-bold' : 'font-semibold'}`}>{value || '—'}</span>
  </div>
}

function MetricRow({ label, amount, ratio, amountClass = '' }) {
  return <div className="grid min-h-[88px] grid-cols-[1.2fr_1fr_.8fr] items-center border-t border-slate-200 text-sm first:border-t-0">
    <div className="px-3 py-4 font-semibold uppercase text-slate-800">{label}</div>
    <div className={`px-3 py-4 text-right tabular-nums ${amountClass}`}>{money(amount)}</div>
    <div className="px-3 py-4 text-right text-xs font-medium tabular-nums text-slate-600">{ratio}</div>
  </div>
}

function SummaryBlock({ title, subtitle, tone, rows }) {
  const tones = {
    blue: ['#2164a8', '#edf5fb'],
    green: ['#19a64b', '#effaf2'],
    cyan: ['#2197c5', '#eef8fc'],
    teal: ['#0fa5a5', '#eefafa'],
  }
  const [header, body] = tones[tone] || tones.blue
  return <section className="min-w-0 overflow-hidden border border-slate-200 bg-white shadow-sm">
    <div className="min-h-[62px] px-3 py-3 text-center text-white" style={{ background: header }}>
      <div className="text-sm font-extrabold uppercase tracking-wide">{title}</div>
      {subtitle && <div className="mt-0.5 text-[11px] font-medium uppercase leading-4 opacity-95">{subtitle}</div>}
    </div>
    <div className="grid grid-cols-[1.2fr_1fr_.8fr] border-b border-slate-200 text-center text-[10px] font-semibold uppercase leading-4 text-slate-700" style={{ background: body }}>
      <div className="px-2 py-2">Item</div><div className="border-l border-slate-200 px-2 py-2">Amount</div><div className="border-l border-slate-200 px-2 py-2">%</div>
    </div>
    <div>{rows.map((r) => <MetricRow key={r.label} {...r} />)}</div>
  </section>
}

function buildRegister(summaries, references) {
  const summaryByBase = new Map()
  for (const s of summaries || []) {
    const base = sofBase(s)
    if (base == null) continue
    const prev = summaryByBase.get(base) || { transaction_count: 0, revenue: 0, materials: 0, labor: 0, overhead: 0, other_cost: 0, total_cost: 0, gross_profit: 0, first_transaction_date: null, last_transaction_date: null }
    prev.transaction_count += num(s.transaction_count)
    prev.revenue += num(s.revenue)
    prev.materials += num(s.materials)
    prev.labor += num(s.labor)
    prev.overhead += num(s.overhead)
    prev.other_cost += num(s.other_cost)
    prev.total_cost += num(s.total_cost)
    prev.gross_profit += num(s.gross_profit)
    prev.first_transaction_date = !prev.first_transaction_date || (s.first_transaction_date && s.first_transaction_date < prev.first_transaction_date) ? s.first_transaction_date : prev.first_transaction_date
    prev.last_transaction_date = !prev.last_transaction_date || (s.last_transaction_date && s.last_transaction_date > prev.last_transaction_date) ? s.last_transaction_date : prev.last_transaction_date
    summaryByBase.set(base, prev)
  }

  const refByBase = new Map()
  for (const r of references || []) {
    for (const base of refBases(r)) {
      if (!refByBase.has(base)) refByBase.set(base, [])
      refByBase.get(base).push(r)
    }
  }

  return [...new Set([...summaryByBase.keys(), ...refByBase.keys()])].sort((a, b) => a - b).map(base => {
    const refs = refByBase.get(base) || []
    const primary = [...refs].sort((a, b) => {
      const ae = String(a.sof_base || '') === String(base) ? 1 : 0
      const be = String(b.sof_base || '') === String(base) ? 1 : 0
      if (ae !== be) return be - ae
      return num(a.source_row) - num(b.source_row)
    })[0] || null
    const summary = summaryByBase.get(base) || { transaction_count: 0, revenue: 0, materials: 0, labor: 0, overhead: 0, other_cost: 0, total_cost: 0, gross_profit: 0 }
    const contract = num(primary?.final_contract_value) > 0 ? num(primary?.final_contract_value) : num(primary?.contract_value)
    const budget = num(primary?.total_cost_budget)
    const progress = clamp(primary?.actual_pct)
    return {
      ...summary,
      base,
      sof_number: String(base),
      project_name: refs.find(x => x.project_name)?.project_name || primary?.project_name || '',
      client_name: primary?.client_name || refs.find(x => x.client_name)?.client_name || primary?.project_owner || refs.find(x => x.project_owner)?.project_owner || '',
      pic: primary?.pic || refs.find(x => x.pic)?.pic || '',
      date_of_award: primary?.date_of_award || null,
      start_date: primary?.start_date || null,
      target_completion_date: primary?.target_completion_date || null,
      project_status: primary?.project_status || refs.find(x => x.project_status)?.project_status || '',
      planned_pct: num(primary?.planned_pct),
      actual_pct: progress,
      contract_value: contract,
      total_cost_budget: budget,
      estimate_gross_profit: contract - budget,
      remarks: [...new Set(refs.map(x => clean(x.remarks)).filter(Boolean))].join(' • '),
      source_modified_at: primary?.source_modified_at || refs.find(x => x.source_modified_at)?.source_modified_at || null,
    }
  })
}

function SofReportBody() {
  const [summaries, setSummaries] = useState([])
  const [references, setReferences] = useState([])
  const [selected, setSelected] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      supabase.from('income_sof_summary').select('*').limit(1000),
      supabase.from('income_reference_projects').select('*').limit(1000),
    ]).then(([a, b]) => {
      if (a.error || b.error) setError(a.error?.message || b.error?.message)
      else { setSummaries(a.data || []); setReferences(b.data || []); setError('') }
    })
  }, [])

  const rows = useMemo(() => buildRegister(summaries, references), [summaries, references])
  useEffect(() => {
    if (!rows.length || selected) return
    const preferred = rows.find(x => x.base === 341) || rows[0]
    setSelected(String(preferred.base))
  }, [rows, selected])
  const row = rows.find(x => String(x.base) === String(selected)) || null

  if (error) return <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
  if (!row) return <div className="rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-500 shadow-sm">Loading SOF report…</div>

  const contract = num(row.contract_value)
  const budgetCost = num(row.total_cost_budget)
  const budgetGp = contract - budgetCost
  const progress = clamp(row.actual_pct)
  const progressContract = contract * progress
  const progressCost = budgetCost * progress
  const progressGp = budgetGp * progress
  const actualRevenue = num(row.revenue)
  const actualCost = num(row.total_cost)
  const actualGp = num(row.gross_profit)
  const varianceContract = actualRevenue - progressContract
  const varianceCost = actualCost - progressCost
  const varianceGp = actualGp - progressGp

  const estimateRows = [
    { label: 'Total contract price', amount: contract, ratio: contract ? '100.00%' : '—' },
    { label: 'Total cost', amount: budgetCost, ratio: percent(budgetCost, contract) },
    { label: 'Gross profit', amount: budgetGp, ratio: percent(budgetGp, contract) },
  ]
  const progressRows = [
    { label: 'Total contract price', amount: progressContract, ratio: progressContract ? '100.00%' : '—' },
    { label: 'Total cost', amount: progressCost, ratio: percent(progressCost, progressContract) },
    { label: 'Gross profit', amount: progressGp, ratio: percent(progressGp, progressContract) },
  ]
  const actualRows = [
    { label: 'Revenue / invoice', amount: actualRevenue, ratio: actualRevenue ? '100.00%' : '—' },
    { label: 'Total cost', amount: actualCost, ratio: percent(actualCost, actualRevenue) },
    { label: 'Gross profit', amount: actualGp, ratio: percent(actualGp, actualRevenue), amountClass: actualGp < 0 ? 'text-rose-600 font-semibold' : 'text-emerald-700 font-semibold' },
  ]
  const varianceRows = [
    { label: 'Revenue variance', amount: varianceContract, ratio: percent(varianceContract, progressContract), amountClass: varianceContract < 0 ? 'text-rose-600' : 'text-emerald-700' },
    { label: 'Cost variance', amount: varianceCost, ratio: percent(varianceCost, progressCost), amountClass: varianceCost > 0 ? 'text-rose-600' : 'text-emerald-700' },
    { label: 'Gross profit variance', amount: varianceGp, ratio: percent(varianceGp, progressGp), amountClass: varianceGp < 0 ? 'text-rose-600 font-semibold' : 'text-emerald-700 font-semibold' },
  ]

  return <>
    <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div><h1 className="text-2xl font-semibold text-slate-950">SOF Financial & Progress Report</h1><p className="mt-1 text-sm text-slate-500">Select one SOF to review only that project’s estimates, progress-based position, QuickBooks actuals, and variance.</p></div>
      <label className="block min-w-[280px] max-w-full">
        <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Select SOF</span>
        <select value={selected} onChange={e => setSelected(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 shadow-sm">
          {rows.map(x => <option key={x.base} value={x.base}>SOF {x.base}{x.project_name ? ` — ${x.project_name}` : ''}</option>)}
        </select>
      </label>
    </div>

    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div><div className="text-xs font-extrabold uppercase tracking-[0.14em] text-emerald-600">E-WORKS</div><h2 className="mt-1 text-xl font-extrabold uppercase tracking-wide text-[#173c68]">Electrical Works</h2><p className="text-xs uppercase tracking-wide text-slate-400">Project progress & cost monitoring report</p></div>
        <div className="rounded-lg bg-[#173c68] px-4 py-2 text-center text-white"><div className="text-[10px] uppercase tracking-widest opacity-70">SOF #</div><div className="text-xl font-extrabold">{row.base}</div></div>
      </div>

      <div className="grid gap-3 p-5 lg:grid-cols-2 lg:gap-x-8">
        <div className="space-y-2"><InfoRow label="Project name" value={row.project_name} strong /><InfoRow label="Client" value={row.client_name} /><InfoRow label="Project manager / PIC" value={row.pic} /><InfoRow label="Overall progress" value={`${(progress * 100).toFixed(2)}%`} strong /><InfoRow label="Progress data updated" value={sourceDate(row.source_modified_at)} /></div>
        <div className="space-y-2"><InfoRow label="Award date" value={shortDate(row.date_of_award)} /><InfoRow label="Start date" value={shortDate(row.start_date)} /><InfoRow label="Target completion" value={shortDate(row.target_completion_date)} /><InfoRow label="Status" value={row.project_status} strong /><InfoRow label="QB activity through" value={shortDate(row.last_transaction_date)} /></div>
      </div>
    </section>

    <div className="mt-6 mb-3 text-lg font-extrabold uppercase tracking-wide text-[#17578d]">Project <span className="text-emerald-600">Financial & Progress Summary</span></div>
    <div className="grid gap-3 xl:grid-cols-4">
      <SummaryBlock title="SOF Based" subtitle="Estimates" tone="blue" rows={estimateRows} />
      <SummaryBlock title="Based on actual progress of work" subtitle="PM progress record" tone="green" rows={progressRows} />
      <SummaryBlock title="Actual finance record" subtitle="QuickBooks" tone="cyan" rows={actualRows} />
      <SummaryBlock title="Variance vs. progress" subtitle="Actual less progress estimate" tone="teal" rows={varianceRows} />
    </div>

    <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="text-sm font-bold uppercase tracking-wide text-slate-700">Project remarks</h3><p className="mt-3 text-sm leading-6 text-slate-600">{row.remarks || 'No reference remark recorded for this SOF.'}</p></section>
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="text-sm font-bold uppercase tracking-wide text-slate-700">Quick view</h3><div className="mt-3 space-y-2 text-sm text-slate-600"><div className="flex justify-between gap-3"><span>Transactions</span><b>{row.transaction_count || 0}</b></div><div className="flex justify-between gap-3"><span>Budget margin</span><b>{pct(contract ? budgetGp / contract * 100 : null)}</b></div><div className="flex justify-between gap-3"><span>Actual margin</span><b className={actualGp < 0 ? 'text-rose-600' : 'text-emerald-700'}>{pct(actualRevenue ? actualGp / actualRevenue * 100 : null)}</b></div></div></section>
    </div>
  </>
}

export default function SofReport() {
  if (!supabase) return <div className="p-8">Supabase connection is unavailable.</div>
  return <Shell><SofReportBody /></Shell>
}
