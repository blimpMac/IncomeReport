import Papa from 'papaparse'
import * as XLSX from 'xlsx'

export const money = (value) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 }).format(Number(value || 0))
export const number = (value) => new Intl.NumberFormat('en-PH').format(Number(value || 0))
export const pct = (value) => value == null ? '—' : `${Number(value).toFixed(2)}%`
export const shortDate = (value) => {
  if (!value) return '—'
  const d = new Date(`${value}T00:00:00`)
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
}

const cleanText = (v) => v == null ? '' : String(v).trim()
const num = (v) => {
  if (v == null || v === '') return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const n = Number(String(v).replace(/[₱,$\s]/g, '').replace(/\((.*)\)/, '-$1'))
  return Number.isFinite(n) ? n : 0
}

const excelDateToIso = (serial) => {
  if (typeof serial !== 'number' || serial < 20000 || serial > 80000) return null
  const epoch = new Date(Date.UTC(1899, 11, 30))
  return new Date(epoch.getTime() + Math.floor(serial) * 86400000).toISOString().slice(0, 10)
}

const toIsoDate = (value) => {
  if (!value && value !== 0) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  const fromSerial = excelDateToIso(value)
  if (fromSerial) return fromSerial
  const s = cleanText(value)
  if (!s) return null
  const mdY = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/)
  if (mdY) {
    let year = Number(mdY[3]); if (year < 100) year += year >= 70 ? 1900 : 2000
    return new Date(Date.UTC(year, Number(mdY[1]) - 1, Number(mdY[2]))).toISOString().slice(0, 10)
  }
  const parsed = new Date(s)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}

export function normalizeSof(raw) {
  const text = cleanText(raw).toUpperCase()
  if (!text) return { label: '', key: '', base: '' }
  let value = text.replace(/^TOTAL\s+/i, '').replace(/^SOF[\s:_-]*/i, '').trim()
  value = value.replace(/\s+/g, '').replace(/_/g, '-')
  const baseMatch = value.match(/\d+/)
  return { label: text, key: value, base: baseMatch?.[0] || '' }
}

export function categorizeAccount(account = '') {
  const a = cleanText(account).toLowerCase()
  if (/sales|revenue|service income|income on/.test(a)) return 'Revenue'
  if (/salary|wage|overtime|labor|labour|sss|philhealth|phic|pag-ibig|hdmf|13th month|employee benefit|payroll/.test(a)) return 'Labor'
  if (/material|consumable|ppe cost|tool|equipment|parts|electrical supply|hardware/.test(a)) return 'Materials'
  if (/fare|transport|accommodation|lodging|meal|food|communication|internet|gasoline|fuel|parking|toll|courier|hauler|mobilization|freight|permit|miscellaneous|rental|rent|printing|grocer|delivery/.test(a)) return 'Overhead'
  return 'Other'
}

const looksLikeHeader = (row) => {
  const lowered = row.map((v) => cleanText(v).toLowerCase())
  return lowered.includes('type') && lowered.includes('date') && lowered.includes('account') && lowered.includes('debit') && lowered.includes('credit')
}

function parseRows(rows, fileName, extension, sheetRows = rows) {
  if (!rows?.length) throw new Error('The file is empty.')
  let headerRow = -1
  for (let i = 0; i < Math.min(rows.length, 40); i += 1) if (looksLikeHeader(rows[i] || [])) { headerRow = i; break }
  if (headerRow < 0) throw new Error('Could not find the QuickBooks columns Type, Date, Account, Debit and Credit.')

  const headers = (rows[headerRow] || []).map((v) => cleanText(v).toLowerCase())
  const idx = (name) => headers.indexOf(name.toLowerCase())
  const typeIdx = idx('type'), dateIdx = idx('date'), numIdx = idx('num'), nameIdx = idx('name'), memoIdx = idx('memo'), accountIdx = idx('account'), debitIdx = idx('debit'), creditIdx = idx('credit'), balanceIdx = idx('balance')
  let hierarchy = Array(Math.max(typeIdx, 0)).fill('')
  const transactions = []
  let minDate = null, maxDate = null

  for (let r = headerRow + 1; r < rows.length; r += 1) {
    const row = rows[r] || []
    if (typeIdx > 0) for (let c = 0; c < typeIdx; c += 1) {
      const cell = cleanText(row[c]); if (!cell || /^total\b/i.test(cell)) continue
      hierarchy[c] = cell; for (let j = c + 1; j < hierarchy.length; j += 1) hierarchy[j] = ''
    }
    const type = cleanText(row[typeIdx]); if (!type || /^total\b/i.test(type)) continue
    const transactionDate = toIsoDate(row[dateIdx]); if (!transactionDate) continue
    const memo = cleanText(row[memoIdx]), txName = cleanText(row[nameIdx]), hierarchyValues = hierarchy.filter(Boolean)
    let sofRaw = [...hierarchyValues].reverse().find((v) => /\bSOF[\s:_-]*\d+/i.test(v)) || ''
    if (!sofRaw) { const found = `${memo} ${txName}`.match(/\bSOF[\s:_-]*([0-9]+(?:[-A-Z0-9]+)*)/i); if (found) sofRaw = `SOF${found[1]}` }
    const sof = normalizeSof(sofRaw), account = cleanText(row[accountIdx])
    transactions.push({ source_row: r + 1, sof_label: sof.label || null, sof_key: sof.key || null, sof_base: sof.base || null, type, transaction_date: transactionDate, num: cleanText(row[numIdx]) || null, name: txName || null, memo: memo || null, account: account || null, debit: num(row[debitIdx]), credit: num(row[creditIdx]), balance: row[balanceIdx] == null || row[balanceIdx] === '' ? null : num(row[balanceIdx]), category: categorizeAccount(account) })
    if (!minDate || transactionDate < minDate) minDate = transactionDate
    if (!maxDate || transactionDate > maxDate) maxDate = transactionDate
  }
  if (!transactions.length) throw new Error('The file was read, but no transaction rows with valid dates were found.')

  let reportDate = null
  for (let r = 0; r < Math.min(headerRow, 5); r += 1) {
    for (let c = (rows[r] || []).length - 1; c >= 0; c -= 1) {
      const candidate = toIsoDate(rows[r][c]); if (candidate && candidate >= minDate && candidate <= '2100-12-31') { reportDate = candidate; break }
    }
    if (reportDate) break
  }
  reportDate ||= maxDate
  const [yyyy, mm, dd] = reportDate.split('-')
  return { fileName, extension, headerRow: headerRow + 1, reportDate, sheetName: `QB ${Number(mm)}/${Number(dd)}/${yyyy}`, minDate, maxDate, transactions, sheetRows }
}

export async function parseQuickBooksFile(file) {
  if (!file) throw new Error('Choose a QuickBooks export first.')
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (!['csv', 'xlsx', 'xls'].includes(extension)) throw new Error('Use a CSV or Excel (.xlsx/.xls) QuickBooks export.')
  if (file.size > 30 * 1024 * 1024) throw new Error('File is over the 30 MB browser upload limit.')
  if (extension === 'csv') {
    const text = await file.text()
    const parsed = Papa.parse(text, { skipEmptyLines: false, dynamicTyping: false })
    if (parsed.errors?.length && !parsed.data?.length) throw new Error(parsed.errors[0].message)
    return parseRows(parsed.data, file.name, extension, parsed.data)
  }
  const data = await file.arrayBuffer()
  const book = XLSX.read(data, { type: 'array', raw: true, cellDates: false })
  const sourceName = book.SheetNames.includes('QB FILE') ? 'QB FILE' : book.SheetNames[0]
  const rawRows = XLSX.utils.sheet_to_json(book.Sheets[sourceName], { header: 1, raw: true, defval: null })
  const displayRows = XLSX.utils.sheet_to_json(book.Sheets[sourceName], { header: 1, raw: false, defval: '' })
  return parseRows(rawRows, file.name, extension, displayRows)
}

export async function apiGet(action, params = {}) {
  const search = new URLSearchParams({ action, ...Object.fromEntries(Object.entries(params).filter(([, v]) => v != null)) })
  const response = await fetch(`/api/sheets?${search}`, { cache: 'no-store' })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`)
  return data
}

async function apiPost(body) {
  const response = await fetch('/api/sheets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Upload failed (${response.status}).`)
  return data
}

export async function uploadQuickBooks(parsed, onProgress = () => {}) {
  const rows = parsed?.sheetRows || []
  if (!rows.length) throw new Error('No worksheet rows were found to upload.')
  const columnCount = rows.reduce((max, row) => Math.max(max, row?.length || 0), 0)
  onProgress(2)
  await apiPost({ action: 'beginUpload', sheetName: parsed.sheetName, reportDate: parsed.reportDate, fileName: parsed.fileName, rowCount: rows.length, columnCount })
  const chunkSize = 500
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize)
    await apiPost({ action: 'uploadChunk', sheetName: parsed.sheetName, startRow: i + 1, rows: chunk })
    onProgress(Math.min(96, Math.round(((i + chunk.length) / rows.length) * 94) + 2))
  }
  const result = await apiPost({ action: 'finishUpload', sheetName: parsed.sheetName, reportDate: parsed.reportDate })
  onProgress(100)
  return result
}

export function buildRemarks(report) {
  if (!report || !Number(report.transaction_count)) return ['No transactions were recorded for this month in the live QB FILE sheet.']
  const remarks = [], revenue = Number(report.revenue || 0), cost = Number(report.total_cost || 0), margin = Number(report.margin_pct || 0), overhead = Number(report.overhead || 0), unassigned = Number(report.unassigned_count || 0)
  if (unassigned > 0) remarks.push(`${unassigned} transaction${unassigned === 1 ? '' : 's'} are not assigned to an SOF. Correct the SOF hierarchy or memo before month-end.`)
  if (revenue > 0 && margin < 15) remarks.push(`Gross margin is ${margin.toFixed(1)}%, below the 15% review threshold. Check high-cost SOFs and confirm all billable revenue was posted.`)
  if (revenue > 0 && overhead / revenue > 0.15) remarks.push(`Overhead is ${(overhead / revenue * 100).toFixed(1)}% of revenue. Review travel, accommodation, logistics, and miscellaneous costs.`)
  if (revenue <= 0 && cost > 0) remarks.push('Costs were posted without matching revenue for the month. Confirm billing timing and unbilled work.')
  if (Number(report.gross_profit || 0) < 0) remarks.push('The month is showing a negative gross profit. Review transaction classification and SOF-level overruns.')
  if (!remarks.length) remarks.push('No major exception was detected. Continue reconciling SOF assignments, supporting documents, and cut-off dates.')
  return remarks
}

export function monthInput(dateValue = new Date()) {
  const d = new Date(dateValue)
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 7)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
