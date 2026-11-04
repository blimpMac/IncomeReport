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


// Duplicate source records must not increase a parent's contract twice.
// Distinct VO and suffix codes remain separate contract additions.
const canonicalReferenceCode = row => clean(row?.sof_number)
  .toUpperCase().replace(/^SOF[\s:_-]*/i, '').replace(/\s+/g, '')

function uniqueReferences(rows) {
  const seen = new Set()
  return rows.filter(row => {
    const key = [
      canonicalReferenceCode(row),
      contractTotal(row),
      budgetTotal(row),
      clean(row?.project_name).toLowerCase(),
      clean(row?.client_name).toLowerCase(),
      clean(row?.project_status).toLowerCase(),
    ].join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function chooseReference(base, matches) {
  const exact = matches.find(row => canonicalReferenceCode(row) === String(base))
  return exact || matches.find(row => clean(row.project_name)) || matches[0] || null
}

function groupReference(base, references) {
  const matches = uniqueReferences(references.filter(row => referenceBases(row).includes(Number(base))))
  const ref = chooseReference(base, matches)
  // A reference like "52, 57, 65, 68" or "117-118" belongs to
  // several SOFs. Do not book its whole contract to every SOF.
  const exclusive = matches.filter(row => referenceBases(row).length === 1)
  const shared = matches.filter(row => referenceBases(row).length > 1)
  const members = [...exclusive, ...shared].sort((a, b) => {
    const aa = canonicalReferenceCode(a) === String(base) ? -1 : 0
    const bb = canonicalReferenceCode(b) === String(base) ? -1 : 0
    return aa - bb || canonicalReferenceCode(a).localeCompare(canonicalReferenceCode(b), undefined, { numeric: true })
  })
  const withBudget = exclusive.filter(hasBudget)
  const contract = exclusive.length ? exclusive.reduce((s, row) => s + contractTotal(row), 0) : null
  const estimatedCost = withBudget.length ? withBudget.reduce((s, row) => s + budgetTotal(row), 0) : null
  const estimatedGp = contract != null && estimatedCost != null ? contract - estimatedCost : null
  const missingBudgetCount = exclusive.length - withBudget.length

  return {
    groupKey: `sof-${base}`,
    base,
    sof: `SOF ${base}`,
    project: clean(ref?.project_name) || 'Project not available',
    client: clean(ref?.client_name) || clean(ref?.project_owner) || '—',
    status: clean(ref?.project_status) || '—',
    contract,
    estimatedCost,
    estimatedGp,
    missingBudgetCount,
    sharedCount: shared.length,
    members,
    searchText: members.map(row => [
      row.sof_number, row.project_name, row.client_name, row.project_owner,
      row.project_status, row.remarks,
    ].map(clean).join(' ')).join(' ').toLowerCase(),
  }
}

function buildMasterRows(references) {
  const bases = [...new Set(references.flatMap(referenceBases))].sort((a, b) => a - b)
  const groups = bases.map(base => groupReference(base, references))
  const withoutSof = references.filter(row => referenceBases(row).length === 0).map(row => ({
    groupKey: `unassigned-${row.id ?? row.source_row}`,
    base: null,
    sof: clean(row.sof_number) || 'No SOF',
    project: clean(row.project_name) || 'Project not available',
    client: clean(row.client_name) || clean(row.project_owner) || '—',
    status: clean(row.project_status) || '—',
    contract: contractTotal(row),
    estimatedCost: hasBudget(row) ? budgetTotal(row) : null,
    estimatedGp: hasBudget(row) ? contractTotal(row) - budgetTotal(row) : null,
    missingBudgetCount: hasBudget(row) ? 0 : 1,
    sharedCount: 0,
    members: [row],
    searchText: [
      row.sof_number, row.project_name, row.client_name, row.project_owner,
      row.project_status, row.remarks,
    ].map(clean).join(' ').toLowerCase(),
  }))
  return [...groups, ...withoutSof]
}

function buildRegister(references, summaries) {
  const baseSet = new Set([
    ...references.flatMap(referenceBases),
    ...summaries.map(baseOf).filter(value => value != null),
  ])
  return [...baseSet].sort((a, b) => a - b).map(base => {
    const group = groupReference(base, references)
    const actualMatches = summaries.filter(row => baseOf(row) === base)
    const actual = actualMatches.reduce((acc, row) => ({
      transaction_count: acc.transaction_count + num(row.transaction_count),
      revenue: acc.revenue + num(row.revenue),
      total_cost: acc.total_cost + num(row.total_cost),
      gross_profit: acc.gross_profit + num(row.gross_profit),
    }), { transaction_count: 0, revenue: 0, total_cost: 0, gross_profit: 0 })
    const actualAvailable = actual.transaction_count > 0
    const actualSales = actualAvailable ? actual.revenue : null
    const actualCost = actualAvailable ? actual.total_cost : null
    const actualGp = actualAvailable ? actual.gross_profit : null
    return {
      ...group,
      // Both margin percentages are scoped to the same consolidated parent SOF.
      estimatedGpPct: group.contract > 0 && group.estimatedGp != null ? (group.estimatedGp / group.contract) * 100 : null,
      actualSales,
      actualCost,
      actualGp,
      actualGpPct: actualSales > 0 && actualGp != null ? (actualGp / actualSales) * 100 : null,
    }
  })
}

function MoneyCell({ value, emphasize = false, signed = false }) {
  if (value == null) return <span className="text-slate-400">—</span>
  const negative = Number(value) < 0
  return <span className={`${emphasize ? 'font-semibold' : ''} ${signed ? (negative ? 'text-rose-700' : 'text-emerald-700') : ''} whitespace-nowrap tabular-nums`}>{money(value)}</span>
}

function PercentCell({ value }) {
  if (value == null || !Number.isFinite(Number(value))) return <span className="text-slate-400">—</span>
  return <span className={`whitespace-nowrap font-semibold tabular-nums ${Number(value) < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{Number(value).toFixed(2)}%</span>
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
  const [expanded, setExpanded] = useState([])
  const [error, setError] = useState('')
  const toggleExpanded = key => setExpanded(current => current.includes(key)
    ? current.filter(x => x !== key)
    : [...current, key])

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

  const masterRows = useMemo(() => buildMasterRows(references), [references])

  const register = useMemo(() => buildRegister(references, summaries), [references, summaries])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const source = tab === 'master' ? masterRows : register
    if (!q) return source
    if (tab === 'master') {
      return source.filter(row => `${row.sof} ${row.project} ${row.client} ${row.status} ${row.searchText}`.toLowerCase().includes(q))
    }
    return source.filter(row => `${row.sof} ${row.project} ${row.client} ${row.status} ${row.searchText}`.toLowerCase().includes(q))
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
      <div className="border-b border-slate-100 px-4 py-3"><h2 className="text-sm font-semibold text-slate-900">Reference Master</h2><p className="mt-1 text-xs text-slate-500">Consolidated parent SOFs. VO/variation contract amounts are included in the parent; expand a row to inspect source entries.</p></div>
      <div className="w-full overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-3">SOF</th><th className="px-3 py-3">Project</th><th className="px-3 py-3">Client</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Contract</th><th className="px-3 py-3">Budget</th><th className="px-3 py-3">Remarks</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{visible.map(row => <React.Fragment key={row.groupKey}>
            <tr className="hover:bg-slate-50/70">
              <td className="px-3 py-3 font-semibold text-slate-800">{row.sof}</td>
              <td className="px-3 py-3 min-w-[220px] text-slate-700">{row.project}</td>
              <td className="px-3 py-3 min-w-[180px] text-slate-600">{row.client}</td>
              <td className="px-3 py-3"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">{row.status}</span></td>
              <td className="px-3 py-3"><MoneyCell value={row.contract} /></td>
              <td className="px-3 py-3"><MoneyCell value={row.estimatedCost} />{row.estimatedCost != null && row.missingBudgetCount > 0 && <div className="text-[10px] text-amber-700">Partial BOM</div>}</td>
              <td className="px-3 py-3 text-xs leading-5 text-slate-500">
                {row.members.length > 1 ? <button type="button" aria-expanded={expanded.includes(row.groupKey)}
                  onClick={() => toggleExpanded(row.groupKey)}
                  className="rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 font-semibold text-indigo-700 hover:bg-indigo-100">
                  {expanded.includes(row.groupKey) ? 'Hide' : 'View'} {row.members.length} entries {expanded.includes(row.groupKey) ? '▴' : '▾'}
                </button> : clean(row.members[0]?.remarks) || '—'}
                {row.sharedCount > 0 && <div className="mt-1 text-[10px] text-amber-700">Shared SOF reference not allocated to prevent double-counting</div>}
              </td>
            </tr>
            {expanded.includes(row.groupKey) && <tr className="bg-indigo-50/30">
              <td colSpan={7} className="!w-auto !p-3">
                <div className="max-w-full rounded-lg border border-slate-200 bg-white">
                  <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">Included source entries for {row.sof}</div>
                  <div className="divide-y divide-slate-100">{row.members.map((item, i) => <div key={item.id || item.source_row || i}
                    className="grid grid-cols-2 items-start gap-x-3 gap-y-1 px-3 py-2 text-[11px] sm:grid-cols-[minmax(130px,1.1fr)_minmax(145px,1fr)_minmax(140px,1fr)_minmax(100px,.7fr)]">
                    <div className="font-semibold text-slate-700">{item.sof_number || '—'}{referenceBases(item).length > 1 && <span className="ml-1 font-normal text-amber-700">(shared)</span>}</div>
                    <div className="tabular-nums text-slate-700">{referenceBases(item).length > 1 ? 'Unallocated' : money(contractTotal(item))}</div>
                    <div className="tabular-nums text-slate-600">{hasBudget(item) ? money(budgetTotal(item)) : 'No BOM data'}</div>
                    <div className="text-slate-500">{clean(item.project_status) || '—'}</div>
                  </div>)}</div>
                </div>
              </td>
            </tr>}
          </React.Fragment>)}</tbody>
        </table>
      </div>
      <Pager page={page} total={filtered.length} onChange={setPage} />
    </section> : <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-sm font-semibold text-slate-900">SOF Financial Register</h2><p className="mt-1 text-xs text-slate-500">Total Contract Price includes the parent and its VOs/extensions. GP % is based on contract price (estimated) or actual sales (actual).</p></div>
        <span className="self-start rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 sm:self-auto">{number(register.length)} SOFs</span>
      </div>
      <div className="w-full overflow-x-auto overscroll-x-contain">
        <table className="w-full min-w-[1200px] text-left text-sm">
          <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-[0.04em] text-slate-500">
            <tr>
              <th className="px-3 py-3">SOF #</th><th className="px-3 py-3">Project</th><th className="px-3 py-3">Client</th><th className="px-3 py-3">Status</th>
              <th className="border-l border-slate-200 px-3 py-3">Total Contract Price</th><th className="px-3 py-3">Estimated Total Cost</th><th className="px-3 py-3">Estimated GP</th><th className="px-3 py-3">Estimated GP %</th>
              <th className="border-l border-slate-200 px-3 py-3">Actual Sales</th><th className="px-3 py-3">Actual Total Cost</th><th className="px-3 py-3">Actual GP</th><th className="px-3 py-3">Actual GP %</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">{visible.map(row => <React.Fragment key={row.groupKey}>
            <tr className="hover:bg-slate-50/70">
              <td className="px-3 py-3 font-bold text-indigo-700">
                <div>{row.sof}</div>
                {row.members.length > 1 && <button type="button"
                  aria-expanded={expanded.includes(row.groupKey)}
                  aria-label={`${expanded.includes(row.groupKey) ? 'Hide' : 'Show'} ${row.members.length - 1} VO or extension entries for ${row.sof}`}
                  title={`${expanded.includes(row.groupKey) ? 'Hide' : 'View'} ${row.members.length - 1} VO / extension entries`}
                  onClick={() => toggleExpanded(row.groupKey)}
                  className="mt-1.5 inline-flex h-8 min-w-[76px] items-center justify-center whitespace-nowrap rounded-md border border-blue-700 bg-blue-600 px-2.5 text-[11px] font-bold leading-none text-white shadow-sm transition-colors hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500">
                  <span>{expanded.includes(row.groupKey) ? 'HIDE VO' : 'VIEW VO'}</span>
                </button>}
              </td>
              <td className="px-3 py-3 font-medium text-slate-800">{row.project}</td>
              <td className="px-3 py-3 text-slate-600">{row.client}</td>
              <td className="px-3 py-3"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">{row.status}</span></td>
              <td className="border-l border-slate-100 px-3 py-3"><MoneyCell value={row.contract} emphasize /></td>
              <td className="px-3 py-3"><MoneyCell value={row.estimatedCost} /></td>
              <td className="px-3 py-3"><MoneyCell value={row.estimatedGp} emphasize signed />{row.estimatedCost != null && row.missingBudgetCount > 0 && <div className="text-[10px] text-amber-700">Partial BOM</div>}{row.sharedCount > 0 && <div className="text-[10px] text-amber-700">Shared ref excluded</div>}</td>
              <td className="px-3 py-3"><PercentCell value={row.estimatedGpPct} /></td>
              <td className="border-l border-slate-100 px-3 py-3"><MoneyCell value={row.actualSales} /></td>
              <td className="px-3 py-3"><MoneyCell value={row.actualCost} /></td>
              <td className="px-3 py-3"><MoneyCell value={row.actualGp} emphasize signed /></td>
              <td className="px-3 py-3"><PercentCell value={row.actualGpPct} /></td>
            </tr>
            {expanded.includes(row.groupKey) && row.members.length > 1 && <tr className="bg-indigo-50/30">
              <td colSpan={12} className="!w-auto !p-3">
                <div className="max-w-full rounded-lg border border-slate-200 bg-white">
                  <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">Contract breakdown for {row.sof} — includes parent and VO / extension entries</div>
                  <div className="divide-y divide-slate-100">
                    {row.members.map((item, i) => <div key={item.id || item.source_row || i} className="grid grid-cols-2 gap-2 px-3 py-2 text-[11px] sm:grid-cols-4">
                      <span className="font-semibold text-slate-700">{item.sof_number || '—'}{referenceBases(item).length > 1 && ' (shared)'}</span>
                      <span className="tabular-nums text-slate-700">{referenceBases(item).length > 1 ? 'Unallocated' : money(contractTotal(item))}</span>
                      <span className="text-slate-500">Est. cost: {hasBudget(item) ? money(budgetTotal(item)) : 'No BOM'}</span>
                      <span className="text-slate-500">{clean(item.project_status) || '—'}</span>
                    </div>)}
                  </div>
                  <div className="border-t border-slate-200 px-3 py-2 text-right text-xs font-semibold text-slate-800">Total Contract Price: {row.contract == null ? '—' : money(row.contract)}</div>
                </div>
              </td>
            </tr>}
          </React.Fragment>)}</tbody>
        </table>
      </div>
      <Pager page={page} total={filtered.length} onChange={setPage} />
    </section>}
  </div>
}
