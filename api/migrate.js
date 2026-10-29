import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'

export const config = { maxDuration: 300 }

const FILE_ID = '1FBsSwS7EAvRCYyBhSm0y9YqZL2NLaG25fODy4Ri-lVc'
const IMPORT_ID = 'fa835fa9-85e3-4330-9f79-1f7e1cfefe57'
const UPLOAD_ID = '6fd507cf-d30c-4d08-ac92-9a61787b381f'
const SOURCE_MODIFIED_AT = '2026-10-29T03:06:27.407Z'

const clean = (v) => v == null ? '' : String(v).trim()
const num = (v) => {
  if (v == null || v === '') return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const n = Number(String(v).replace(/[₱,$\s]/g, '').replace(/\((.*)\)/, '-$1').replace(/%$/, ''))
  return Number.isFinite(n) ? n : 0
}
const toIsoDate = (v) => {
  if (v == null || v === '') return null
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10)
  if (typeof v === 'number' && v >= 20000 && v <= 80000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000).toISOString().slice(0, 10)
  }
  const d = new Date(clean(v))
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}
const normalizeSof = (raw) => {
  const text = clean(raw).toUpperCase()
  if (!text || /^NO\s*SOF$/i.test(text)) return { label: text, key: '', base: '' }
  const value = text.replace(/^TOTAL\s+/i, '').replace(/^SOF[\s:_-]*/i, '').trim().replace(/\s+/g, '').replace(/_/g, '-')
  return { label: text, key: value, base: value.match(/\d+/)?.[0] || '' }
}
const categorize = (account) => {
  const a = clean(account).toLowerCase()
  if (/sales|revenue|service income|income on/.test(a)) return 'Revenue'
  if (/salary|wage|overtime|labor|labour|sss|philhealth|phic|pag-ibig|hdmf|13th month|employee benefit|payroll/.test(a)) return 'Labor'
  if (/material|consumable|ppe cost|tool|equipment|parts|electrical supply|hardware/.test(a)) return 'Materials'
  if (/fare|transport|accomm?odation|lodging|meal|food|communication|internet|gasoline|fuel|parking|toll|courier|hauler|mobilization|freight|permit|miscellaneous|rental|rent|printing|grocer|delivery/.test(a)) return 'Overhead'
  return 'Other'
}
const nonEmpty = (row) => row.some((v) => v != null && v !== '')
const cells = (row) => row.map((v) => v instanceof Date ? v.toISOString() : v)

function parseReference(rows) {
  let header = -1
  for (let i = 0; i < Math.min(rows.length, 30); i += 1) {
    const r = (rows[i] || []).map((v) => clean(v).toUpperCase())
    if (r.includes('PROJECT NAME') && r.includes('SOF NUMBER')) { header = i; break }
  }
  if (header < 0) throw new Error('REFERENCE DATA header not found')
  const out = []
  for (let i = header + 2; i < rows.length; i += 1) {
    const r = rows[i] || []
    const projectName = clean(r[0]), sofNumber = clean(r[1]), projectStatus = clean(r[17]), projectCode = clean(r[21])
    if (!projectName && !sofNumber && !projectStatus && !projectCode) continue
    const sof = normalizeSof(sofNumber)
    out.push({
      source_row: i + 1, project_name: projectName || null, sof_number: sofNumber || null,
      sof_key: sof.key || null, sof_base: sof.base || null, po_contract: clean(r[2]) || null,
      project_location: clean(r[3]) || null, client_name: clean(r[4]) || null, project_owner: clean(r[5]) || null,
      construction_classification: clean(r[6]) || null, scope_of_works: clean(r[7]) || null,
      pic: clean(r[8]) || null, contact_no: clean(r[9]) || null, date_of_award: toIsoDate(r[10]),
      start_date: toIsoDate(r[11]), target_completion_date: toIsoDate(r[12]), contract_value: num(r[13]),
      planned_pct: num(r[14]), actual_pct: num(r[15]), remarks: clean(r[16]) || null, project_status: projectStatus || null,
      actual_completion_date: toIsoDate(r[18]), final_contract_value: num(r[19]), certificate_of_completion: clean(r[20]) || null,
      project_code: projectCode || null, cancelled_date: toIsoDate(r[23]), materials_budget: num(r[24]), labor_budget: num(r[25]),
      overhead_budget: num(r[26]), tpc_budget: num(r[27]), total_cost_budget: num(r[28]),
      source_sheet: 'REFERENCE DATA', source_cells: cells(r), source_file_id: FILE_ID, source_modified_at: SOURCE_MODIFIED_AT,
    })
  }
  return out
}

function parseQB(rows) {
  let header = -1
  for (let i = 0; i < Math.min(rows.length, 40); i += 1) {
    const h = (rows[i] || []).map((v) => clean(v).toLowerCase())
    if (h.includes('type') && h.includes('date') && h.includes('account') && h.includes('debit') && h.includes('credit')) { header = i; break }
  }
  if (header < 0) throw new Error('QB FILE header not found')
  const headers = (rows[header] || []).map((v) => clean(v).toLowerCase())
  const idx = (name) => headers.indexOf(name)
  const typeIdx = idx('type'), dateIdx = idx('date'), numIdx = idx('num'), nameIdx = idx('name'), memoIdx = idx('memo')
  const accountIdx = idx('account'), debitIdx = idx('debit'), creditIdx = idx('credit'), balanceIdx = idx('balance')
  let hierarchy = Array(Math.max(typeIdx, 0)).fill('')
  const out = []
  let minDate = null, maxDate = null

  for (let ri = header + 1; ri < rows.length; ri += 1) {
    const row = rows[ri] || []
    if (typeIdx > 0) {
      for (let c = 0; c < typeIdx; c += 1) {
        const cell = clean(row[c])
        if (!cell || /^total\b/i.test(cell)) continue
        hierarchy[c] = cell
        for (let j = c + 1; j < hierarchy.length; j += 1) hierarchy[j] = ''
      }
    }
    const type = clean(row[typeIdx])
    if (!type || /^total\b/i.test(type)) continue
    const transactionDate = toIsoDate(row[dateIdx])
    if (!transactionDate) continue
    const memo = clean(row[memoIdx]), txName = clean(row[nameIdx]), hv = hierarchy.filter(Boolean)
    let sofRaw = [...hv].reverse().find((v) => /\bSOF[\s:_-]*\d+/i.test(v)) || ''
    if (!sofRaw) {
      const found = `${memo} ${txName}`.match(/\bSOF[\s:_-]*([0-9]+(?:[-A-Z0-9]+)*)/i)
      if (found) sofRaw = `SOF${found[1]}`
    }
    const sof = normalizeSof(sofRaw)
    const sofIndex = hv.findIndex((v) => v === sofRaw)
    const projectGroup = sofIndex > 0 ? hv[sofIndex - 1] : (hv.at(-1) || '')
    const division = sofIndex > 1 ? hv[sofIndex - 2] : (hv.length > 1 ? hv[0] : '')
    const account = clean(row[accountIdx])
    out.push({
      upload_id: UPLOAD_ID, source_row: ri + 1, division: division || null, project_group: projectGroup || null,
      sof_label: sof.label || null, sof_key: sof.key || null, sof_base: sof.base || null, type,
      transaction_date: transactionDate, num: clean(row[numIdx]) || null, name: txName || null, memo: memo || null,
      account: account || null, debit: num(row[debitIdx]), credit: num(row[creditIdx]),
      balance: row[balanceIdx] == null || row[balanceIdx] === '' ? null : num(row[balanceIdx]), category: categorize(account),
      source_sheet: 'QB FILE', source_cells: cells(row), source_file_id: FILE_ID, source_modified_at: SOURCE_MODIFIED_AT,
    })
    if (!minDate || transactionDate < minDate) minDate = transactionDate
    if (!maxDate || transactionDate > maxDate) maxDate = transactionDate
  }
  return { transactions: out, minDate, maxDate, reportDate: toIsoDate(rows[1]?.[13]) || maxDate }
}

async function insertChunks(client, table, rows, size = 400, concurrency = 4) {
  const chunks = []
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size))
  for (let i = 0; i < chunks.length; i += concurrency) {
    await Promise.all(chunks.slice(i, i + concurrency).map(async (chunk) => {
      const { error } = await client.from(table).insert(chunk)
      if (error) throw new Error(`${table}: ${error.message}`)
    }))
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false })
  if (!process.env.MIGRATION_RUN_TOKEN || req.query.token !== process.env.MIGRATION_RUN_TOKEN) return res.status(404).json({ ok: false })
  try {
    const sourceUrl = String(req.query.sourceUrl || '')
    const source = new URL(sourceUrl)
    if (source.protocol !== 'https:' || !source.hostname.endsWith('.oaiusercontent.com')) throw new Error('Invalid migration source')

    const response = await fetch(sourceUrl)
    if (!response.ok) throw new Error(`Workbook fetch failed (${response.status})`)
    const workbook = XLSX.read(new Uint8Array(await response.arrayBuffer()), { type: 'array', cellDates: true, raw: true })
    for (const required of ['Sheet1', 'REFERENCE DATA', 'QB FILE']) if (!workbook.Sheets[required]) throw new Error(`Missing sheet: ${required}`)
    const rows = (name) => XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, defval: null })
    const sheet1 = rows('Sheet1'), referenceRows = rows('REFERENCE DATA'), qbRows = rows('QB FILE')
    const refs = parseReference(referenceRows)
    const qb = parseQB(qbRows)
    const refStructured = new Set(refs.map((x) => x.source_row))
    const qbStructured = new Set(qb.transactions.map((x) => x.source_row))
    const rawRows = []
    const addRaw = (sheet, sourceRows, structured, kind) => sourceRows.forEach((row, index) => {
      const sourceRow = index + 1
      if (!nonEmpty(row) || structured.has(sourceRow)) return
      rawRows.push({ import_id: IMPORT_ID, source_file_id: FILE_ID, source_sheet: sheet, source_row: sourceRow, row_kind: kind, source_cells: cells(row), source_modified_at: SOURCE_MODIFIED_AT })
    })
    addRaw('Sheet1', sheet1, new Set(), 'legacy')
    addRaw('REFERENCE DATA', referenceRows, refStructured, 'source_context')
    addRaw('QB FILE', qbRows, qbStructured, 'source_context')

    const client = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } })
    await insertChunks(client, 'income_reference_projects', refs, 195, 1)
    await insertChunks(client, 'income_qb_transactions', qb.transactions, 400, 4)
    await insertChunks(client, 'income_source_rows', rawRows, 350, 2)

    const sourceNonempty = [sheet1, referenceRows, qbRows].reduce((sum, list) => sum + list.filter(nonEmpty).length, 0)
    return res.status(200).json({ ok: true, sourceNonempty, referenceRows: refs.length, qbTransactions: qb.transactions.length, rawContextRows: rawRows.length, reportDate: qb.reportDate, minDate: qb.minDate, maxDate: qb.maxDate })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ ok: false, error: error?.message || 'Migration failed' })
  }
}
