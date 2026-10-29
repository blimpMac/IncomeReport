import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { money, supabase } from './lib.js'

const num = v => Number(v || 0)
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

function buildRow(selected, summaries, references) {
  const base = Number(selected)
  const summary = (summaries || []).filter(x => baseOf(x) === base).reduce((acc, x) => {
    for (const key of ['materials','labor','overhead','other_cost','total_cost']) acc[key] += num(x[key])
    return acc
  }, { materials:0, labor:0, overhead:0, other_cost:0, total_cost:0 })
  const refs = (references || []).filter(x => refBases(x).includes(base))
  const primary = [...refs].sort((a,b) => num(a.source_row) - num(b.source_row))[0] || {}
  return {
    base,
    progress: Math.min(1, Math.max(0, num(primary.actual_pct))),
    materials_budget: num(primary.materials_budget),
    labor_budget: num(primary.labor_budget),
    overhead_budget: num(primary.overhead_budget),
    total_cost_budget: num(primary.total_cost_budget),
    ...summary,
  }
}

function compareData(row) {
  const progress = row.progress
  const parts = [
    ['Materials', row.materials_budget, row.materials],
    ['Labor', row.labor_budget, row.labor],
    ['Overhead', row.overhead_budget, row.overhead],
  ]
  if (Math.abs(row.other_cost) > 0.005) parts.push(['Other / Unmapped', 0, row.other_cost])
  const rows = parts.map(([label,budget,actual]) => {
    const progressBudget = budget * progress
    const variance = progressBudget - actual
    const variancePct = progressBudget ? variance / progressBudget * 100 : null
    let analysis = 'No cost posted.'
    if (actual > 0 && progressBudget <= 0) analysis = 'Actual cost has no matching BOM budget. Review classification or project allocation.'
    else if (variance < 0) analysis = `${money(Math.abs(variance))} over the progress-based budget.`
    else if (actual > 0) analysis = `${money(variance)} remains within the progress-based budget.`
    return { label,budget,progressBudget,actual,variance,variancePct,analysis }
  })
  const budget = rows.reduce((s,x) => s + x.budget, 0) || row.total_cost_budget
  const progressBudget = budget * progress
  const actual = rows.reduce((s,x) => s + x.actual, 0)
  const variance = progressBudget - actual
  const variancePct = progressBudget ? variance / progressBudget * 100 : null
  const total = { label:'Total', budget, progressBudget, actual, variance, variancePct, analysis: variance < 0 ? `Overall cost is ${money(Math.abs(variance))} above the progress-based budget.` : `${money(variance)} remains before reaching the progress-based budget.` }
  return { progress, rows:[...rows,total], total }
}

function Stat({ label, note, value, tone }) {
  const tones = { green:['#effcf4','#16a34a'], blue:['#eff6ff','#2563eb'], red:['#fff1f2','#e11d48'] }
  const [bg,border] = tones[tone] || tones.blue
  return <div className="cost-stat" style={{ background:bg, borderColor:border }}><div className="cost-stat-label">{label}</div><div className="cost-stat-note">({note})</div><div className="cost-stat-value">{money(value)}</div></div>
}

function Panel({ row }) {
  const data = useMemo(() => compareData(row), [row])
  return <section className="cost-comparison-section">
    <div className="cost-comparison-title"><div><h3>Cost Comparison</h3><p>Project progress & cost analysis</p></div><div className="cost-comparison-brand"><div><span>Total Progress</span><b>{(data.progress*100).toFixed(2)}%</b></div><strong>GREENLIGHT</strong></div></div>
    <div className="cost-stat-grid"><Stat label="Total Project Cost" note="Budgeted" value={data.total.budget} tone="green"/><Stat label="Total Project Cost" note="Budgeted based on progress" value={data.total.progressBudget} tone="blue"/><Stat label="Total Project Cost" note="Actual" value={data.total.actual} tone="green"/><Stat label="Variance" note="Progress budget vs. actual" value={data.total.variance} tone={data.total.variance < 0 ? 'red' : 'blue'}/></div>
    <div className="cost-table-wrap"><table className="cost-table"><thead><tr><th>Account</th><th>BOM</th><th>BOM Based on Progress</th><th>Actual</th><th>Variance</th><th>% on Progress</th><th>Analysis</th></tr></thead><tbody>{data.rows.map(x => <tr key={x.label} className={x.label === 'Total' ? 'cost-total-row' : ''}><td>{x.label}</td><td>{money(x.budget)}</td><td>{money(x.progressBudget)}</td><td>{money(x.actual)}</td><td className={x.variance < 0 ? 'cost-negative' : 'cost-positive'}>{money(x.variance)}</td><td className={x.variancePct != null && x.variancePct < 0 ? 'cost-negative' : ''}>{x.variancePct == null ? '—' : `${x.variancePct.toFixed(2)}%`}</td><td>{x.analysis}</td></tr>)}</tbody></table></div>
  </section>
}

export default function SofCostComparison() {
  const [selected,setSelected] = useState('')
  const [summaries,setSummaries] = useState([])
  const [references,setReferences] = useState([])
  const [host,setHost] = useState(null)

  useEffect(() => {
    const attach = () => {
      const main = document.querySelector('main')
      const select = main?.querySelector('select')
      if (main) setHost(main)
      if (select?.value) setSelected(select.value)
    }
    attach()
    const timer = setInterval(attach, 500)
    const onChange = e => { if (e.target?.matches?.('main select')) setSelected(e.target.value) }
    document.addEventListener('change', onChange)
    return () => { clearInterval(timer); document.removeEventListener('change', onChange) }
  }, [])

  useEffect(() => {
    Promise.all([
      supabase.from('income_sof_summary').select('*').limit(1000),
      supabase.from('income_reference_projects').select('*').limit(1000),
    ]).then(([a,b]) => { if (!a.error) setSummaries(a.data || []); if (!b.error) setReferences(b.data || []) })
  }, [])

  if (!host || !selected || (!summaries.length && !references.length)) return null
  const row = buildRow(selected, summaries, references)
  return createPortal(<Panel row={row}/>, host)
}
