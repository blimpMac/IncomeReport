import React, { useEffect, useMemo, useState } from 'react'
import { money, supabase } from './lib.js'

const NAV = [['dashboard','Dashboard'],['upload','Data Upload'],['monthly','Monthly Report'],['sof','SOF Analysis'],['costcompare','Cost Comparison'],['transactions','Transactions'],['reference','Reference Data'],['worksheets','QB Worksheets']]
const go = p => { location.hash = `#/${p}` }
const num = v => Number(v || 0)
const clamp = v => Math.min(1, Math.max(0, num(v)))
const baseOf = row => {
  const raw = row?.sof_base ?? row?.sof_number ?? row?.sof_key ?? row?.sof_label ?? ''
  const match = String(raw).match(/\d+/)
  return match ? Number(match[0]) : null
}
const refBases = row => {
  const raw = String(row?.sof_number || '').replace(/^SOF\s*/i, '').trim()
  if (/^\d+(?:\s*(?:,|&)\s*\d+)+$/.test(raw)) return [...new Set(raw.match(/\d+/g).map(Number))]
  const range = raw.match(/^(\d+)\s*-\s*(\d+)$/)
  if (range && Number(range[2]) === Number(range[1]) + 1) return [Number(range[1]), Number(range[2])]
  const base = baseOf(row)
  return base == null ? [] : [base]
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
        <button aria-label={open ? 'Close navigation' : 'Open navigation'} className="shrink-0" onClick={() => setOpen(!open)}>☰</button>
        <button onClick={() => go('dashboard')} className="min-w-0 text-left"><b className="block truncate text-sm">E-WORKS Income Report</b><div className="truncate text-xs text-slate-500">Finance reporting workspace</div></button>
      </div>
    </header>
    {open && <button aria-label="Close navigation" onClick={() => setOpen(false)} className="fixed inset-0 top-16 z-40 bg-slate-950/30 backdrop-blur-[1px]" />}
    <aside className={`${open ? 'block' : 'hidden'} fixed left-0 top-16 z-50 h-[calc(100vh-4rem)] w-64 border-r border-slate-200 bg-[#171d2c] p-3 text-white shadow-xl`}>
      <nav className="space-y-1">{NAV.map(([id,label]) => <button key={id} onClick={() => go(id)} className={`w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium ${id === 'costcompare' ? 'bg-white text-slate-900' : 'text-slate-300 hover:bg-white/10 hover:text-white'}`}>{label}</button>)}</nav>
    </aside>
    <main className="mx-auto w-full max-w-[1500px] p-4 lg:p-6 xl:p-8">{children}</main>
  </div>
}

function summarize(selection, summaries, references) {
  const all = selection === 'all'
  const selectedBase = all ? null : Number(selection)
  const refs = references.filter(r => all || refBases(r).includes(selectedBase))
  const tx = summaries.filter(s => all || baseOf(s) === selectedBase)
  const uniqueRefs = [...new Map(refs.map(r => [r.source_row ?? r.id, r])).values()]
  const budget = { materials:0, labor:0, overhead:0, total:0 }
  const progressBudget = { materials:0, labor:0, overhead:0, total:0 }
  for (const r of uniqueRefs) {
    const p = clamp(r.actual_pct)
    const m = num(r.materials_budget)
    const l = num(r.labor_budget)
    const o = num(r.overhead_budget)
    const t = num(r.total_cost_budget) || (m + l + o)
    budget.materials += m; budget.labor += l; budget.overhead += o; budget.total += t
    progressBudget.materials += m * p; progressBudget.labor += l * p; progressBudget.overhead += o * p; progressBudget.total += t * p
  }
  const actual = tx.reduce((a,s) => ({
    materials:a.materials + num(s.materials), labor:a.labor + num(s.labor), overhead:a.overhead + num(s.overhead), other:a.other + num(s.other_cost), total:a.total + num(s.total_cost)
  }), { materials:0,labor:0,overhead:0,other:0,total:0 })
  const progress = budget.total ? progressBudget.total / budget.total : 0
  const project = all ? 'All SOFs' : (refs.find(r => r.project_name)?.project_name || `SOF ${selection}`)
  return { all, project, budget, progressBudget, actual, progress }
}

function comparisonRows(summary) {
  const specs = [
    ['Materials', summary.budget.materials, summary.progressBudget.materials, summary.actual.materials],
    ['Labor', summary.budget.labor, summary.progressBudget.labor, summary.actual.labor],
    ['Overhead', summary.budget.overhead, summary.progressBudget.overhead, summary.actual.overhead],
  ]
  if (Math.abs(summary.actual.other) > 0.005) specs.push(['Other / Unmapped', 0, 0, summary.actual.other])
  const rows = specs.map(([label,budget,progressBudget,actual]) => {
    const variance = progressBudget - actual
    const variancePct = progressBudget ? variance / progressBudget * 100 : null
    let analysis = 'No cost posted against this category.'
    if (actual > 0 && progressBudget <= 0) analysis = 'Actual cost has no matching progress-based budget. Review account classification and SOF allocation.'
    else if (variance < 0) analysis = `${money(Math.abs(variance))} over the budget allowed by current project progress.`
    else if (actual > 0) analysis = `${money(variance)} remains below the budget allowed by current project progress.`
    return { label,budget,progressBudget,actual,variance,variancePct,analysis }
  })
  const variance = summary.progressBudget.total - summary.actual.total
  rows.push({ label:'Total', budget:summary.budget.total, progressBudget:summary.progressBudget.total, actual:summary.actual.total, variance, variancePct:summary.progressBudget.total ? variance / summary.progressBudget.total * 100 : null, analysis: variance < 0 ? `Total actual cost exceeds the progress-based budget by ${money(Math.abs(variance))}.` : `Total actual cost is ${money(variance)} below the progress-based budget.` })
  return rows
}

function Stat({ label, note, value, danger=false }) {
  return <div className={`rounded-xl border p-4 text-center shadow-sm ${danger ? 'border-rose-200 bg-rose-50' : 'border-emerald-200 bg-emerald-50'}`}><div className="text-xs font-extrabold uppercase tracking-wide text-slate-700">{label}</div><div className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-500">{note}</div><div className={`mt-3 text-xl font-extrabold tabular-nums ${danger ? 'text-rose-700' : 'text-slate-900'}`}>{money(value)}</div></div>
}

export default function CostComparisonPage() {
  const [summaries,setSummaries] = useState([])
  const [references,setReferences] = useState([])
  const [selection,setSelection] = useState('all')
  const [error,setError] = useState('')
  useEffect(() => {
    Promise.all([
      supabase.from('income_sof_summary').select('*').limit(2000),
      supabase.from('income_reference_projects').select('*').limit(2000),
    ]).then(([a,b]) => {
      if (a.error || b.error) setError(a.error?.message || b.error?.message)
      else { setSummaries(a.data || []); setReferences(b.data || []); setError('') }
    })
  }, [])
  const options = useMemo(() => [...new Set([...summaries.map(baseOf), ...references.flatMap(refBases)].filter(x => x != null))].sort((a,b) => a-b), [summaries,references])
  const summary = useMemo(() => summarize(selection,summaries,references), [selection,summaries,references])
  const rows = useMemo(() => comparisonRows(summary), [summary])
  const total = rows[rows.length-1]

  return <Shell>
    <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div><h1 className="text-2xl font-semibold text-slate-950">Cost Comparison</h1><p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">Compare BOM budget against the budget allowed by current progress, then compare that progress-based budget with actual QuickBooks cost.</p></div>
      <label className="block min-w-[290px]"><span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">SOF scope</span><select value={selection} onChange={e => setSelection(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 shadow-sm"><option value="all">All SOFs</option>{options.map(base => <option key={base} value={base}>SOF {base}</option>)}</select></label>
    </div>
    {error && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}

    <section className="cost-comparison-section !mt-0">
      <div className="cost-comparison-title"><div><h3>Cost Comparison</h3><p>{summary.project} · progress & cost analysis</p></div><div className="cost-comparison-brand"><div><span>Total Progress</span><b>{(summary.progress*100).toFixed(2)}%</b></div><strong>GREENLIGHT</strong></div></div>
      <div className="cost-stat-grid">
        <Stat label="Total Project Cost" note="Budgeted / BOM" value={summary.budget.total} />
        <Stat label="Total Project Cost" note="Budgeted based on progress" value={summary.progressBudget.total} />
        <Stat label="Total Project Cost" note="Actual QuickBooks" value={summary.actual.total} />
        <Stat label="Variance" note="On-progress budget vs actual" value={total.variance} danger={total.variance < 0} />
      </div>
      <div className="cost-table-wrap"><table className="cost-table"><thead><tr><th>Account</th><th>BOM</th><th>BOM Based on Progress</th><th>Actual</th><th>Variance vs. On Progress</th><th>% Variance on Progress</th><th>Analysis</th></tr></thead><tbody>{rows.map(r => <tr key={r.label} className={r.label === 'Total' ? 'cost-total-row' : ''}><td>{r.label}</td><td>{money(r.budget)}</td><td>{money(r.progressBudget)}</td><td>{money(r.actual)}</td><td className={r.variance < 0 ? 'cost-negative' : 'cost-positive'}>{money(r.variance)}</td><td className={r.variancePct != null && r.variancePct < 0 ? 'cost-negative' : 'cost-positive'}>{r.variancePct == null ? '—' : `${r.variancePct.toFixed(2)}%`}</td><td>{r.analysis}</td></tr>)}</tbody></table></div>
    </section>

    <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-900"><b>Variance basis:</b> BOM Based on Progress − Actual Cost. A positive variance means actual cost is still below the cost allowance for the current progress. A negative variance means actual cost has exceeded the progress-based budget.</div>
  </Shell>
}
