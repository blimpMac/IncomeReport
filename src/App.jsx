import React, { useEffect, useMemo, useState } from 'react'
import { supabase, money, number, pct, shortDate, parseQuickBooksFile, uploadQuickBooks, buildRemarks, monthInput } from './lib.js'

const PAGE_SIZE = 10
const NAV = [['dashboard','Dashboard'],['upload','QB Upload'],['monthly','Monthly Report'],['sof','SOF Analysis'],['transactions','Transactions'],['reference','Reference Data'],['worksheets','QB Worksheets']]
const pageNow = () => { const p = (location.hash || '#/dashboard').replace(/^#\/?/, ''); return NAV.some(([x]) => x === p) ? p : 'dashboard' }
const go = (p) => { location.hash = `#/${p}` }
const cleanRemark = (value) => String(value || '').replace(/\s+/g, ' ').trim()
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

function Card({ children, className = '' }) {
  return <div className={`min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>
}
function Button({ children, secondary = false, className = '', ...p }) {
  return <button {...p} className={`${secondary ? 'border border-slate-300 bg-white text-slate-700' : 'bg-slate-900 text-white'} rounded-lg px-3.5 py-2 text-sm font-medium disabled:opacity-50 ${className}`}>{children}</button>
}
function Header({ title, sub, actions }) {
  return <div className="mb-5 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
    <div className="min-w-0"><h1 className="text-2xl font-semibold text-slate-950">{title}</h1><p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">{sub}</p></div>
    {actions && <div className="no-print flex max-w-full flex-wrap items-center gap-2">{actions}</div>}
  </div>
}
function Stat({ label, value, note }) {
  return <Card className="p-4"><div className="text-xs uppercase tracking-wide text-slate-500">{label}</div><div className="mt-2 break-words text-xl font-semibold sm:text-2xl">{value}</div>{note && <div className="mt-1 text-xs text-slate-500">{note}</div>}</Card>
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

function Shell({ children }) {
  const [page, setPage] = useState(pageNow())
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const f = () => { setPage(pageNow()); setOpen(false) }
    addEventListener('hashchange', f)
    return () => removeEventListener('hashchange', f)
  }, [])
  return <div className="min-h-screen w-full overflow-x-hidden bg-[#f7f8fa]">
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between px-4 lg:px-6">
        <div className="flex min-w-0 items-center gap-3"><button className="shrink-0 lg:hidden" onClick={() => setOpen(!open)}>☰</button><button onClick={() => go('dashboard')} className="min-w-0 text-left"><b className="block truncate text-sm">E-WORKS Income Report</b><div className="truncate text-xs text-slate-500">Finance reporting workspace</div></button></div>
      </div>
    </header>
    <div className="mx-auto flex w-full max-w-[1500px]">
      <aside className={`${open ? 'fixed inset-x-4 top-20 z-40 block rounded-xl border bg-white shadow-lg' : 'hidden'} w-60 shrink-0 p-3 lg:sticky lg:top-16 lg:block lg:h-[calc(100vh-4rem)] lg:border-r lg:border-slate-200`}>
        <nav className="space-y-1">{NAV.map(([id, label]) => <button key={id} onClick={() => go(id)} className={`w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium ${page === id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{label}</button>)}</nav>
        <div className="mt-5 border-t px-3 pt-4 text-xs leading-5 text-slate-500">Source: Supabase income data<br/>10 rows per page.</div>
      </aside>
      <main className="w-full min-w-0 flex-1 overflow-x-hidden p-4 lg:p-6 xl:p-8">{children}</main>
    </div>
  </div>
}

function useLatest() {
  const [d, setD] = useState(null)
  useEffect(() => { supabase.from('income_qb_uploads').select('*').eq('status', 'ready').order('report_date', { ascending: false }).limit(1).maybeSingle().then(({ data }) => setD(data)) }, [])
  return d
}

function Dashboard() {
  const latest = useLatest()
  const [r, setR] = useState(null)
  const [tx, setTx] = useState([])
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!latest) return
    Promise.all([
      supabase.rpc('income_monthly_report', { p_month: latest.report_date.slice(0, 7) + '-01' }),
      supabase.from('income_transactions_ready').select('*').order('transaction_date', { ascending: false }).limit(10),
    ]).then(([a, b]) => {
      if (a.error || b.error) setErr(a.error?.message || b.error?.message)
      else { setR(a.data); setTx(b.data || []) }
    })
  }, [latest])
  return <>
    <Header title="Dashboard" sub="Latest month-end position and focused review remarks." actions={<Button onClick={() => go('upload')}>Upload QB file</Button>} />
    <ErrorBox v={err} />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Stat label="Revenue" value={money(r?.revenue)} /><Stat label="Total Cost" value={money(r?.total_cost)} /><Stat label="Gross Profit" value={money(r?.gross_profit)} note={`Margin ${pct(r?.margin_pct)}`} /><Stat label="Active SOFs" value={number(r?.unique_sof)} note={`${number(r?.unassigned_count)} unassigned`} /></div>
    <div className="mt-5 grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,1fr)_340px]">
      <Card><Table minWidth={620} heads={['Date','SOF','Type','Account','Debit / Credit']} rows={tx} row={x => <tr key={x.id}><td className="px-3 py-3 whitespace-nowrap">{shortDate(x.transaction_date)}</td><td className="px-3 py-3 font-medium">{displaySof(x)}</td><td className="px-3 py-3 break-words">{x.type}</td><td className="px-3 py-3 break-words">{x.account || '—'}</td><td className="px-3 py-3 whitespace-nowrap"><div>Dr {money(x.debit)}</div><div className="text-xs text-slate-500">Cr {money(x.credit)}</div></td></tr>} /></Card>
      <Card className="p-4"><h2 className="mb-3 font-semibold">Review remarks</h2>{buildRemarks(r).map((x, i) => <div key={i} className="mb-2 break-words rounded-lg bg-slate-50 p-3 text-sm leading-6">{x}</div>)}</Card>
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
  const [page, setPage] = useState(0)
  const [err, setErr] = useState('')
  useEffect(() => { if (latest) setMonth(latest.report_date.slice(0, 7)) }, [latest])
  useEffect(() => {
    Promise.all([supabase.rpc('income_monthly_report', { p_month: month + '-01' }), supabase.rpc('income_monthly_sof_summary', { p_month: month + '-01' })]).then(([a, b]) => {
      if (a.error || b.error) setErr(a.error?.message || b.error?.message)
      else { setR(a.data); setRows([...(b.data || [])].sort(compareSof)); setPage(0); setErr('') }
    })
  }, [month])
  const data = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
  return <>
    <Header title="Monthly Report" sub="End-of-month financial report. SOFs are listed in numeric order." actions={<><input type="month" value={month} onChange={e => setMonth(e.target.value)} className="max-w-full rounded-lg border px-3 py-2" /><Button secondary onClick={() => window.print()}>Print / PDF</Button></>} />
    <ErrorBox v={err} />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Stat label="Revenue" value={money(r?.revenue)} /><Stat label="Materials" value={money(r?.materials)} /><Stat label="Labor" value={money(r?.labor)} /><Stat label="Overhead" value={money(r?.overhead)} /><Stat label="Gross Profit" value={money(r?.gross_profit)} note={`Margin ${pct(r?.margin_pct)}`} /></div>
    <div className="mt-5 grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,1fr)_340px]">
      <Card><Table minWidth={680} heads={['SOF','Tx','Revenue','Total Cost','Gross Profit','Margin']} rows={data} row={x => <tr key={x.sof_key}><td className="px-3 py-3 font-medium">{displaySof(x)}</td><td className="px-3 py-3">{number(x.transaction_count)}</td><td className="px-3 py-3 whitespace-nowrap">{money(x.revenue)}</td><td className="px-3 py-3"><CostCell row={x} /></td><td className="px-3 py-3 whitespace-nowrap">{money(x.gross_profit)}</td><td className="px-3 py-3 whitespace-nowrap">{pct(x.margin_pct)}</td></tr>} /><Pager page={page} total={rows.length} setPage={setPage} /></Card>
      <Card className="p-4"><h2 className="mb-3 font-semibold">Remarks</h2>{buildRemarks(r).map((x, i) => <p key={i} className="mb-2 break-words rounded-lg bg-slate-50 p-3 text-sm leading-6">{x}</p>)}</Card>
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
  const data = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
  return <>
    <Header title="SOF Analysis" sub="All known SOFs from Reference Data and QB are combined, checked, and sorted numerically from the lowest SOF to the highest." />
    <ErrorBox v={err} />
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
      <Pager page={page} total={rows.length} setPage={setPage} />
    </Card>
  </>
}

function ReferenceData() {
  const [allRows, setAllRows] = useState([])
  const [page, setPage] = useState(0)
  const [err, setErr] = useState('')
  useEffect(() => {
    supabase.from('income_reference_projects').select('*').limit(1000).then(({ data, error }) => {
      if (error) setErr(error.message)
      else { setAllRows([...(data || [])].sort(compareSof)); setErr('') }
    })
  }, [])
  const rows = allRows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
  return <>
    <Header title="Reference Data" sub="Project/SOF master data sorted numerically by SOF. Continuation and variation rows stay directly after their base SOF." />
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
      <Pager page={page} total={allRows.length} setPage={setPage} />
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
