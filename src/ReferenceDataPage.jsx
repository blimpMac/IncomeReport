import React, { useEffect, useMemo, useState } from 'react'
import { money, number, supabase } from './lib.js'

const PAGE_SIZE = 25
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim()
const num = value => Number(value || 0)

const baseOf = row => {
  const raw = row?.sof_base ?? row?.sof_key ?? row?.sof_number ?? row?.sof_label ?? ''
  const match = String(raw).match(/\d+/)
  return match ? Number(match[0]) : null
}

const referenceBases = row => {
  const raw = String(row?.sof_number || '').replace(/^SOF\s*/i, '').trim()
  if (/^\d+(?:\s*(?:,|&)\s*\d+)+$/.test(raw)) return [...new Set(raw.match(/\d+/g).map(Number))]
  const range = raw.match(/^(\d+)\s*-\s*(\d+)$/)
  if (range && Number(range[2]) === Number(range[1]) + 1) return [Number(range[1]), Number(range[2])]
  const base = baseOf(row)
  return base == null ? [] : [base]
}

const hasBudget = row => Math.abs(num(row?.total_cost_budget)) > 0.005 || Math.abs(num(row?.materials_budget) + num(row?.labor_budget) + num(row?.overhead_budget)) > 0.005
const budgetTotal = row => num(row?.total_cost_budget) || (num(row?.materials_budget) + num(row?.labor_budget) + num(row?.overhead_budget))
const contractTotal = row => num(row?.final_contract_value) > 0 ? num(row?.final_contract_value) : num(row?.contract_value)

function chooseReference(base, references) {
  const matches = references.filter(row => referenceBases(row).includes(Number(base)))
  if (!matches.length) return null
  const exact = matches.find(row => clean(row.sof_number).replace(/^SOF\s*/i, '') === String(base))
  return exact || matches.find(row => clean(row.project_name)) || matches[0]
}

function buildRegister(references, summaries) {
  const bases = [...new Set([
    ...references.flatMap(referenceBases),
    ...summaries.map(baseOf).filter(value => value != null),
  ])].sort((a, b) => a - b)

  return bases.map(base => {
    const ref = chooseReference(base, references)
    const actualMatches = summaries.filter(row => baseOf(row) === base)
    const actual = actualMatches.reduce((acc, row) => ({
      transaction_count: acc.transaction_count + num(row.transaction_count),
      revenue: acc.revenue + num(row.revenue),
      total_cost: acc.total_cost + num(row.total_cost),
      gross_profit: acc.gross_profit + num(row.gross_profit),
    }), { transaction_count: 0, revenue: 0, total_cost: 0, gross_profit: 0 })

    const contract = ref ? contractTotal(ref) : 0
    const budgetAvailable = !!ref && hasBudget(ref)
    const estimatedCost = budgetAvailable ? budgetTotal(ref) : null
    const estimatedGp = budgetAvailable ? contract - estimatedCost : null
    const actualAvailable = actual.transaction_count > 0

    return {
      base,
      sof: `SOF ${base}`,
      project: clean(ref?.project_name) || 'Project not available',
      client: clean(ref?.client_name) || clean(ref?.project_owner) || '—',
      status: clean(ref?.project_status) || '—',
      contract: ref ? contract : null,
      estimatedCost,
      estimatedGp,
      actualSales: actualAvailable ? actual.revenue : null,
      actualCost: actualAvailable ? actual.total_cost : null,
      actualGp: actualAvailable ? actual.gross_profit : null,
    }
  })
}

function MoneyCell({ value, emphasize = false, signed = false }) {
  if (value == null) return <span className="text-slate-400">—</span>
  const negative = Number(value) < 0
  return <span className={`${emphasize ? 'font-semibold' : ''} ${signed ? (negative ? 'text-rose-700' : 'text-emerald-700') : ''} whitespace-nowrap tabular-nums`}>{money(value)}</span>
}

function Pager({ page, total, onChange }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  return <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-500">
    <span>{total ? `${page * PAGE_SIZE + 1}-${Math.min((page + 1) * PAGE_SIZE, total)} of ${number(total)}` : '0 records'}</span>
    <div className="flex items-center gap-2">
      <button disabled={!page} onClick={() => onChange(page - 1)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 disabled:opacity-40">Previous</button>
      <span>{page + 1}/{pages}</span>
      <button disabled={page + 1 >= pages} onClick={() => onChange(page + 1)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 disabled:opacity-40">Next</button>
    </div>
  </div>
}

export default function ReferenceDataPage() {
  const [tab, setTab] = useState('master')
  const [references, setReferences] = useState([])
  const [summaries, setSummaries] = useState([])
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      supabase.from('income_reference_projects').select('*').limit(2000),
      supabase.from('income_sof_summary').select('*').limit(2000),
    ]).then(([a, b]) => {
      if (a.error || b.error) setError(a.error?.message || b.error?.message)
      else {
        setReferences(a.data || [])
        setSummaries(b.data || [])
        setError('')
      }
    })
  }, [])

  const masterRows = useMemo(() => [...references].sort((a, b) => {
    const aa = baseOf(a)
    const bb = baseOf(b)
    if (aa == null && bb != null) return 1
    if (aa != null && bb == null) return -1
    if (aa != null && bb != null && aa !== bb) return aa - bb
    return String(a.sof_number || '').localeCompare(String(b.sof_number || ''), undefined, { numeric: true, sensitivity: 'base' })
  }), [references])

  const register = useMemo(() => buildRegister(references, summaries), [references, summaries])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const source = tab === 'master' ? masterRows : register
    if (!q) return source
    if (tab === 'master') {
      return source.filter(row => `${row.sof_number || ''} ${row.project_name || ''} ${row.client_name || ''} ${row.project_owner || ''} ${row.project_status || ''}`.toLowerCase().includes(q))
    }
    return source.filter(row => `${row.sof} ${row.project} ${row.client} ${row.status}`.toLowerCase().includes(q))
  }, [tab, masterRows, register, search])

  useEffect(() => setPage(0), [tab, search])
  const visible = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)

  return <div className="min-w-0">
    <div className="mb-5 flex min-w-0 flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold text-slate-950">Reference Data</h1>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">Project master information and a consolidated SOF financial register using Reference Data estimates and QuickBooks actuals.</p>
      </div>
      <label className="relative block w-full max-w-md">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">⌕</span>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search SOF, project, client, or status…" className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-9 pr-9 text-sm shadow-sm" />
        {search && <button type="button" onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">×</button>}
      </label>
    </div>

    <div className="mb-4 inline-flex max-w-full gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
      <button onClick={() => setTab('master')} className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold transition ${tab === 'master' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}>Reference Master</button>
      <button onClick={() => setTab('summary')} className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold transition ${tab === 'summary' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}>SOF Financial Register</button>
    </div>

    {error && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}

    {tab === 'master' ? <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-3"><h2 className="text-sm font-semibold text-slate-900">Reference Master</h2><p className="mt-1 text-xs text-slate-500">Original project/SOF master rows from the uploaded Reference Data workbook.</p></div>
      <div className="w-full overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-3">SOF</th><th className="px-3 py-3">Project</th><th className="px-3 py-3">Client</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Contract</th><th className="px-3 py-3">Budget</th><th className="px-3 py-3">Remarks</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{visible.map(row => <tr key={row.id} className="hover:bg-slate-50/70">
            <td className="px-3 py-3 font-semibold text-slate-800">{row.sof_number || '—'}</td>
            <td className="px-3 py-3 min-w-[220px] text-slate-700">{clean(row.project_name) || 'Continuation row'}</td>
            <td className="px-3 py-3 min-w-[180px] text-slate-600">{clean(row.client_name) || clean(row.project_owner) || '—'}</td>
            <td className="px-3 py-3"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">{clean(row.project_status) || '—'}</span></td>
            <td className="px-3 py-3"><MoneyCell value={contractTotal(row)} /></td>
            <td className="px-3 py-3">{hasBudget(row) ? <MoneyCell value={budgetTotal(row)} /> : <span className="text-slate-400">—</span>}</td>
            <td className="px-3 py-3 min-w-[220px] text-xs leading-5 text-slate-500">{clean(row.remarks) || '—'}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <Pager page={page} total={filtered.length} onChange={setPage} />
    </section> : <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-sm font-semibold text-slate-900">SOF Financial Register</h2><p className="mt-1 text-xs text-slate-500">Estimated figures come from Reference Data. Actual figures are lifetime QuickBooks totals currently stored in Supabase.</p></div>
        <span className="self-start rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 sm:self-auto">{number(register.length)} SOFs</span>
      </div>
      <div className="w-full overflow-x-auto overscroll-x-contain">
        <table className="w-full min-w-[1500px] text-left text-sm">
          <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-[0.04em] text-slate-500">
            <tr>
              <th className="px-3 py-3">SOF #</th><th className="px-3 py-3">Project</th><th className="px-3 py-3">Client</th><th className="px-3 py-3">Status</th>
              <th className="border-l border-slate-200 px-3 py-3">Contract Amount</th><th className="px-3 py-3">Estimated Total Cost</th><th className="px-3 py-3">Estimated GP</th>
              <th className="border-l border-slate-200 px-3 py-3">Actual Sales</th><th className="px-3 py-3">Actual Total Cost</th><th className="px-3 py-3">Actual GP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">{visible.map(row => <tr key={row.base} className="hover:bg-slate-50/70">
            <td className="px-3 py-3 font-bold text-indigo-700">{row.sof}</td>
            <td className="px-3 py-3 min-w-[230px] font-medium text-slate-800">{row.project}</td>
            <td className="px-3 py-3 min-w-[190px] text-slate-600">{row.client}</td>
            <td className="px-3 py-3"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">{row.status}</span></td>
            <td className="border-l border-slate-100 px-3 py-3"><MoneyCell value={row.contract} /></td>
            <td className="px-3 py-3"><MoneyCell value={row.estimatedCost} /></td>
            <td className="px-3 py-3"><MoneyCell value={row.estimatedGp} emphasize signed /></td>
            <td className="border-l border-slate-100 px-3 py-3"><MoneyCell value={row.actualSales} /></td>
            <td className="px-3 py-3"><MoneyCell value={row.actualCost} /></td>
            <td className="px-3 py-3"><MoneyCell value={row.actualGp} emphasize signed /></td>
          </tr>)}</tbody>
        </table>
      </div>
      <Pager page={page} total={filtered.length} onChange={setPage} />
    </section>}
  </div>
}
