import React, { useState } from 'react'
import { number, parseQuickBooksFile, shortDate, uploadQuickBooks } from './lib.js'
import { parseMasterWorkbook, syncMasterWorkbook } from './master-sync.js'

export default function DataUpload() {
  const [master, setMaster] = useState(true)
  const [parsed, setParsed] = useState(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [stage, setStage] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function choose(file) {
    setParsed(null); setError(''); setMessage(''); setProgress(0)
    if (!file) return
    try {
      setBusy(true)
      setParsed(master ? await parseMasterWorkbook(file) : await parseQuickBooksFile(file))
    } catch (e) {
      setError(e.message || 'File could not be read.')
    } finally {
      setBusy(false)
    }
  }

  async function send() {
    try {
      setBusy(true); setError(''); setMessage('')
      if (master) {
        const result = await syncMasterWorkbook(parsed, (value, text) => { setProgress(value); setStage(text) })
        setMessage(`Sync complete: ${number(result.referenceRows)} Reference Data rows and ${number(result.qbTransactions)} QuickBooks transactions.`)
      } else {
        await uploadQuickBooks(parsed, setProgress)
        setMessage(`${parsed.sheetName} imported: ${number(parsed.transactions.length)} transactions.`)
      }
    } catch (e) {
      setError(e.message || 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="w-full min-w-0">
    <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div><h1 className="text-2xl font-semibold text-slate-950">Data Upload & Workbook Sync</h1><p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">Upload the Excel version of the E-WORKS workbook to update Supabase internally. This page only reads the file you select and never connects to or modifies Google Drive.</p></div>
      <div className="flex flex-wrap gap-2"><button onClick={() => { setMaster(true); setParsed(null) }} className={`rounded-lg px-4 py-2 text-sm font-semibold ${master ? 'bg-slate-900 text-white' : 'border bg-white text-slate-600'}`}>Master workbook</button><button onClick={() => { setMaster(false); setParsed(null) }} className={`rounded-lg px-4 py-2 text-sm font-semibold ${!master ? 'bg-slate-900 text-white' : 'border bg-white text-slate-600'}`}>QuickBooks only</button></div>
    </div>

    {error && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}
    {message && <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{message}</div>}
    {master && <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800"><b>Master sync:</b> reads REFERENCE DATA and QB FILE, ignores FORMAT, replaces Reference Data atomically, and replaces the same-dated QB batch instead of duplicating it.</div>}

    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><label className="block cursor-pointer rounded-xl border-2 border-dashed border-slate-300 p-8 text-center"><input hidden type="file" accept={master ? '.xlsx,.xls' : '.csv,.xlsx,.xls'} onChange={e => choose(e.target.files?.[0])} /><b>{busy && !parsed ? 'Reading file…' : master ? 'Choose master workbook Excel file' : 'Choose QuickBooks export'}</b><div className="mt-1 text-xs text-slate-500">{master ? 'XLSX/XLS with REFERENCE DATA + QB FILE' : 'CSV, XLSX or XLS'}</div></label></section>

    {parsed && <section className="mt-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{master ? <><Info label="Reference projects" value={number(parsed.references.length)} /><Info label="QB transactions" value={number(parsed.qb.transactions.length)} /><Info label="QB report date" value={shortDate(parsed.qb.reportDate)} /><Info label="Ignored sheets" value={parsed.ignoredSheets.join(', ') || 'None'} /></> : <><Info label="Worksheet" value={parsed.sheetName} /><Info label="Report date" value={shortDate(parsed.reportDate)} /><Info label="Transactions" value={number(parsed.transactions.length)} /></>}</div><div className="mt-5 flex justify-end"><button disabled={busy} onClick={send} className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? `${stage || 'Uploading'} ${progress}%` : master ? 'Sync workbook to Supabase' : 'Import QuickBooks batch'}</button></div></section>}
  </div>
}

function Info({ label, value }) {
  return <div className="rounded-lg bg-slate-50 p-3"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</div><div className="mt-1 break-words font-semibold text-slate-800">{value}</div></div>
}
