import React, { useEffect, useMemo, useState } from 'react'
import { money, supabase } from './lib.js'

const NAV = [['dashboard','Dashboard'],['upload','Data Upload'],['monthly','Monthly Report'],['sof','SOF Analysis'],['costcompare','Cost Comparison'],['transactions','Transactions'],['reference','Reference Data'],['worksheets','QB Worksheets']]
const go = p => { location.hash = `#/${p}` }
const num = v => Number(v || 0)
const clamp = v => Math.min(1, Math.max(0, num(v)))
const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim()

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

const rowBudgetTotal = row => {
  const explicit = num(row?.total_cost_budget)
  if (explicit) return explicit
  return num(row?.materials_budget) + num(row?.labor_budget) + num(row?.overhead_budget)
}
const hasBomBudget = row => Math.abs(rowBudgetTotal(row)) > 0.005

function projectNameForBase(base, references) {
  const names = [...new Set(
    references
      .filter(row => refBases(row).includes(Number(base)))
      .map(row => clean(row.project_name))
      .filter(Boolean),
  )]
  return names[0] || 'Project name not available'
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
        <button aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} className="shrink-0" onClick={() => setOpen(!open)}>☰</button>
        <button onClick={() => go('dashboard')} className="min-w-0 text-left"><b className="block truncate text-sm">E-WORKS Income Report</b><div className="truncate text-xs text-slate-500">Finance reporting workspace</div></button>
      </div>
    </header>
    {open && <button aria-label="Close navigation" onClick={() => setOpen(false)} className="fixed inset-0 top-16 z-40 bg-slate-950/30 backdrop-blur-[1px]" />}
    <aside className={`${open ? 'block' : 'hidden'} fixed left-0 top-16 z-50 h-[calc(100vh-4rem)] w-64 border-r border-slate-200 bg-[#171d2c] p-3 text-white shadow-xl`}>
      <nav className="space-y-1">{NAV.map(([id,label]) => <button key={id} onClick={() => go(id)} className={`w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium ${id === 'costcompare' ? 'bg-white text-slate-900' : 'text-slate-300 hover:bg-white/10 hover:text-white'}`}>{label}</button>)}</nav>
    </aside>
    <main className="mx-auto w-full min-w-0 max-w-[1500px] overflow-x-hidden p-4 lg:p-6 xl:p-8">{children}</main>
  </div>
}

function summarize(selection, summaries, references) {
  const all = selection === 'all'
  const selectedBase = all ? null : Number(selection)
  const refs = references.filter(r => all || refBases(r).includes(selectedBase))
  const tx = summaries.filter(s => all || baseOf(s) === selectedBase)
  const uniqueRefs = [...new Map(refs.map(r => [r.source_row ?? r.id, r])).values()]
  const budgetRefs = uniqueRefs.filter(hasBomBudget)
  const budget = { materials:0, labor:0, overhead:0, total:0 }
  const progressBudget = { materials:0, labor:0, overhead:0, total:0 }

  for (const r of budgetRefs) {
    const p = clamp(r.actual_pct)
    const materials = num(r.materials_budget)
    const labor = num(r.labor_budget)
    const overhead = num(r.overhead_budget)
    const total = rowBudgetTotal(r)
    budget.materials += materials
    budget.labor += labor
    budget.overhead += overhead
    budget.total += total
    progressBudget.materials += materials * p
    progressBudget.labor += labor * p
    progressBudget.overhead += overhead * p
    progressBudget.total += total * p
  }

  const actual = tx.reduce((a,s) => ({
    materials:a.materials + num(s.materials),
    labor:a.labor + num(s.labor),
    overhead:a.overhead + num(s.overhead),
    other:a.other + num(s.other_cost),
    total:a.total + num(s.total_cost),
  }), { materials:0,labor:0,overhead:0,other:0,total:0 })

  const referenceRows = uniqueRefs.length
  const budgetRows = budgetRefs.length
  const hasBom = budgetRows > 0
  const coverageComplete = hasBom && budgetRows === referenceRows
  const varianceAvailable = hasBom && (!all || coverageComplete)
  const progress = hasBom && budget.total ? progressBudget.total / budget.total : null
  const project = all ? 'Portfolio summary' : projectNameForBase(selectedBase, references)
  return { all, selectedBase, project, budget, progressBudget, actual, progress, referenceRows, budgetRows, hasBom, coverageComplete, varianceAvailable }
}

function comparisonRows(summary) {
  const specs = [
    ['Materials', 'materials'],
    ['Labor', 'labor'],
    ['Overhead', 'overhead'],
  ]
  const rows = specs.map(([label,key]) => {
    const budget = summary.hasBom ? summary.budget[key] : null
    const progressBudget = summary.hasBom ? summary.progressBudget[key] : null
    const actual = summary.actual[key]
    const variance = summary.varianceAvailable ? progressBudget - actual : null
    let analysis
    if (!summary.hasBom) analysis = 'No BOM cost budget is encoded in Reference Data for this SOF. Actual QuickBooks cost is shown only.'
    else if (summary.all && !summary.coverageComplete) analysis = 'Partial portfolio BOM only. Variance is withheld because many Reference Data rows do not contain a cost budget.'
    else if (actual <= 0.005) analysis = 'No QuickBooks cost posted against this category.'
    else if (variance < 0) analysis = `${money(Math.abs(variance))} over the budget allowed by current project progress.`
    else analysis = `${money(variance)} remains below the budget allowed by current project progress.`
    return { label,budget,progressBudget,actual,variance,analysis }
  })

  if (Math.abs(summary.actual.other) > 0.005) rows.push({
    label:'Other / Unmapped',
    budget:null,
    progressBudget:null,
    actual:summary.actual.other,
    variance:null,
    analysis:'This QuickBooks cost has no matching BOM category. Review account classification and SOF allocation.',
  })

  const totalVariance = summary.varianceAvailable ? summary.progressBudget.total - summary.actual.total : null
  let totalAnalysis
  if (!summary.hasBom) totalAnalysis = 'BOM cost budget is not encoded in Reference Data, so total budget and variance are unavailable.'
  else if (summary.all && !summary.coverageComplete) totalAnalysis = `Portfolio BOM coverage is incomplete (${summary.budgetRows} of ${summary.referenceRows} Reference Data rows). Actual cost is complete, but portfolio variance is intentionally not calculated.`
  else if (totalVariance < 0) totalAnalysis = `Total actual cost exceeds the progress-based budget by ${money(Math.abs(totalVariance))}.`
  else totalAnalysis = `Total actual cost is ${money(totalVariance)} below the progress-based budget.`
  rows.push({ label:'Total', budget:summary.hasBom ? summary.budget.total : null, progressBudget:summary.hasBom ? summary.progressBudget.total : null, actual:summary.actual.total, variance:totalVariance, analysis:totalAnalysis })
  return rows
}

function displayMoney(value, missingText = '—') {
  return value == null ? missingText : money(value)
}

function Stat({ label, note, value, danger=false, tone='green', missingText='—' }) {
  const toneClass = danger ? 'border-rose-200 bg-rose-50' : tone === 'blue' ? 'border-blue-200 bg-blue-50' : 'border-emerald-200 bg-emerald-50'
  return <div className={`costcompare-stat min-w-0 rounded-xl border p-3.5 text-center shadow-sm ${toneClass}`}>
    <div className="text-[11px] font-extrabold uppercase tracking-wide text-slate-700">{label}</div>
    <div className="mt-0.5 text-[10px] uppercase leading-4 tracking-wide text-slate-500">{note}</div>
    <div className={`costcompare-stat-value mt-2.5 font-extrabold tabular-nums ${danger ? 'text-rose-700' : 'text-slate-900'}`}>{value == null ? missingText : money(value)}</div>
  </div>
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

  const options = useMemo(() => {
    const bases = [...new Set([...summaries.map(baseOf), ...references.flatMap(refBases)].filter(x => x != null))].sort((a,b) => a-b)
    return bases.map(base => {
      const refs = references.filter(row => refBases(row).includes(base))
      return { base, project: projectNameForBase(base, references), hasBom: refs.some(hasBomBudget) }
    })
  }, [summaries,references])

  const summary = useMemo(() => summarize(selection,summaries,references), [selection,summaries,references])
  const rows = useMemo(() => comparisonRows(summary), [summary])
  const total = rows[rows.length - 1]
  const selectedLabel = summary.all ? 'All SOFs' : `SOF ${summary.selectedBase}`
  const coverageMessage = summary.all
    ? `BOM coverage: ${summary.budgetRows} of ${summary.referenceRows} Reference Data rows currently have a cost budget.${summary.coverageComplete ? '' : ' Portfolio variance is intentionally unavailable until BOM coverage is complete.'}`
    : !summary.hasBom
      ? 'No BOM cost budget is encoded in Reference Data for this SOF. Actual QuickBooks costs are shown; budget and variance fields are unavailable.'
      : summary.budgetRows < summary.referenceRows
        ? `This SOF has BOM data on ${summary.budgetRows} of ${summary.referenceRows} matching Reference Data rows. The comparison uses the available encoded budget.`
        : ''

  return <Shell>
    <div className="costcompare-page min-w-0">
      <div className="mb-5 flex min-w-0 flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0"><h1 className="text-2xl font-semibold text-slate-950">Cost Comparison</h1><p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">Compare encoded BOM budget with progress-based budget and actual QuickBooks cost. Missing BOM values are shown as unavailable rather than zero.</p></div>
        <label className="block w-full min-w-0 xl:w-[500px]">
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">SOF scope</span>
          <select value={selection} onChange={e => setSelection(e.target.value)} className="w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 shadow-sm">
            <option value="all">All SOFs — Portfolio Summary</option>
            {options.map(item => <option key={item.base} value={item.base}>SOF {item.base} — {item.project}{item.hasBom ? '' : ' — No BOM budget'}</option>)}
          </select>
        </label>
      </div>

      {error && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}
      {coverageMessage && <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900"><b>Data coverage:</b> {coverageMessage}</div>}

      <section className="cost-comparison-section !mt-0">
        <div className="cost-comparison-title">
          <div className="min-w-0"><h3>Cost Comparison</h3><p className="costcompare-project-name">{selectedLabel}{!summary.all ? ` — ${summary.project}` : ' — Portfolio Summary'} · progress & cost analysis</p></div>
          <div className="cost-comparison-brand"><div><span>Total Progress</span><b>{summary.progress == null ? '—' : `${(summary.progress * 100).toFixed(2)}%`}</b></div><strong>GREENLIGHT</strong></div>
        </div>

        <div className="cost-stat-grid">
          <Stat label="Total Project Cost" note={summary.all && !summary.coverageComplete ? 'Encoded BOM only' : 'Budgeted / BOM'} value={summary.hasBom ? summary.budget.total : null} />
          <Stat label="Total Project Cost" note={summary.all && !summary.coverageComplete ? 'Encoded BOM based on progress' : 'Budgeted based on progress'} value={summary.hasBom ? summary.progressBudget.total : null} tone="blue" />
          <Stat label="Total Project Cost" note="Actual QuickBooks" value={summary.actual.total} />
          <Stat label="Variance" note="On-progress budget vs actual" value={total.variance} danger={total.variance != null && total.variance < 0} tone="blue" missingText="Unavailable" />
        </div>

        <div className="cost-table-wrap">
          <table className="cost-table costcompare-table">
            <thead><tr><th>Account</th><th>BOM</th><th>BOM Based on Progress</th><th>Actual</th><th>Variance vs. On Progress</th><th>Analysis</th></tr></thead>
            <tbody>{rows.map(r => <tr key={r.label} className={r.label === 'Total' ? 'cost-total-row' : ''}>
              <td>{r.label}</td>
              <td><span className="costcompare-money">{displayMoney(r.budget, r.label === 'Other / Unmapped' ? 'No BOM category' : '—')}</span></td>
              <td><span className="costcompare-money">{displayMoney(r.progressBudget)}</span></td>
              <td><span className="costcompare-money">{money(r.actual)}</span></td>
              <td className={r.variance == null ? '' : r.variance < 0 ? 'cost-negative' : 'cost-positive'}><span className="costcompare-money">{displayMoney(r.variance)}</span></td>
              <td>{r.analysis}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>

      <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-900"><b>Variance basis:</b> BOM Based on Progress − Actual Cost. Variance is shown only when a usable BOM budget exists for the selected scope.</div>
    </div>
  </Shell>
}
