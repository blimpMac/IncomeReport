import { createClient } from '@supabase/supabase-js'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null

export const money = (value) => new Intl.NumberFormat('en-PH', {
  style: 'currency', currency: 'PHP', maximumFractionDigits: 2,
}).format(Number(value || 0))

export const number = (value) => new Intl.NumberFormat('en-PH').format(Number(value || 0))

export const pct = (value) => value == null || Number.isNaN(Number(value)) ? '—' : `${Number(value).toFixed(2)}%`

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
  const d = new Date(epoch.getTime() + Math.floor(serial) * 86400000)
  return d.toISOString().slice(0, 10)
}

const toIsoDate = (value) => {
  if (!value && value !== 0) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  const fromSerial = excelDateToIso(value)
  if (fromSerial) return fromSerial
  const s = cleanText(value)
  if (!s) return null
  const parsed = new Date(s)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 10)
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
  if (/fare|transport|accomm?odation|lodging|meal|food|communication|internet|gasoline|fuel|parking|toll|courier|hauler|mobilization|freight|permit|miscellaneous|rental|rent|printing|grocer|delivery/.test(a)) return 'Overhead'
  return 'Other'
}

const looksLikeHeader = (row) => {
  const lowered = row.map((v) => cleanText(v).toLowerCase())
  return lowered.includes('type') && lowered.includes('date') && lowered.includes('account') && lowered.includes('debit') && lowered.includes('credit')
}

function parseRows(rows, fileName, extension) {
  if (!rows?.length) throw new Error('The file is empty.')
  const scanLimit = Math.min(rows.length, 40)
  let headerRow = -1
  for (let i = 0; i < scanLimit; i += 1) {
    if (looksLikeHeader(rows[i] || [])) { headerRow = i; break }
  }
  if (headerRow < 0) throw new Error('Could not find the QuickBooks columns Type, Date, Account, Debit and Credit.')

  const headers = (rows[headerRow] || []).map((v) => cleanText(v).toLowerCase())
  const idx = (name) => headers.indexOf(name.toLowerCase())
  const typeIdx = idx('type')
  const dateIdx = idx('date')
  const numIdx = idx('num')
  const nameIdx = idx('name')
  const memoIdx = idx('memo')
  const accountIdx = idx('account')
  const debitIdx = idx('debit')
  const creditIdx = idx('credit')
  const balanceIdx = idx('balance')

  let hierarchy = Array(Math.max(typeIdx, 0)).fill('')
  const transactions = []
  let minDate = null
  let maxDate = null

  for (let r = headerRow + 1; r < rows.length; r += 1) {
    const row = rows[r] || []
    if (typeIdx > 0) {
      for (let c = 0; c < typeIdx; c += 1) {
        const cell = cleanText(row[c])
        if (!cell) continue
        if (/^total\b/i.test(cell)) continue
        hierarchy[c] = cell
        for (let j = c + 1; j < hierarchy.length; j += 1) hierarchy[j] = ''
      }
    }

    const type = cleanText(row[typeIdx])
    if (!type || /^total\b/i.test(type)) continue
    const transactionDate = toIsoDate(row[dateIdx])
    if (!transactionDate) continue

    const memo = cleanText(row[memoIdx])
    const txName = cleanText(row[nameIdx])
    const hierarchyValues = hierarchy.filter(Boolean)
    let sofRaw = [...hierarchyValues].reverse().find((v) => /\bSOF[\s:_-]*\d+/i.test(v)) || ''
    if (!sofRaw) {
      const found = `${memo} ${txName}`.match(/\bSOF[\s:_-]*([0-9]+(?:[-A-Z0-9]+)*)/i)
      if (found) sofRaw = `SOF${found[1]}`
    }
    const sof = normalizeSof(sofRaw)
    const sofIndex = hierarchyValues.findIndex((v) => v === sofRaw)
    const projectGroup = sofIndex > 0 ? hierarchyValues[sofIndex - 1] : (hierarchyValues.at(-1) || '')
    const division = sofIndex > 1 ? hierarchyValues[sofIndex - 2] : (hierarchyValues.length > 1 ? hierarchyValues[0] : '')
    const account = cleanText(row[accountIdx])

    transactions.push({
      source_row: r + 1,
      division: division || null,
      project_group: projectGroup || null,
      sof_label: sof.label || null,
      sof_key: sof.key || null,
      sof_base: sof.base || null,
      type,
      transaction_date: transactionDate,
      num: cleanText(row[numIdx]) || null,
      name: txName || null,
      memo: memo || null,
      account: account || null,
      debit: num(row[debitIdx]),
      credit: num(row[creditIdx]),
      balance: row[balanceIdx] == null || row[balanceIdx] === '' ? null : num(row[balanceIdx]),
      category: categorizeAccount(account),
    })
    if (!minDate || transactionDate < minDate) minDate = transactionDate
    if (!maxDate || transactionDate > maxDate) maxDate = transactionDate
  }

  if (!transactions.length) throw new Error('The file was read, but no transaction rows with valid dates were found.')

  let reportDate = null
  for (let r = 0; r < Math.min(headerRow, 5); r += 1) {
    for (let c = (rows[r] || []).length - 1; c >= 0; c -= 1) {
      const candidate = toIsoDate(rows[r][c])
      if (candidate && candidate >= minDate && candidate <= '2100-12-31') { reportDate = candidate; break }
    }
    if (reportDate) break
  }
  reportDate ||= maxDate
  const [yyyy, mm, dd] = reportDate.split('-')
  const sheetName = `QB ${Number(mm)}/${Number(dd)}/${yyyy}`

  return { fileName, extension, headerRow: headerRow + 1, reportDate, sheetName, minDate, maxDate, transactions }
}

export async function parseQuickBooksFile(file) {
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (!['csv', 'xlsx', 'xls'].includes(extension)) throw new Error('Use a CSV or Excel (.xlsx/.xls) QuickBooks export.')
  if (file.size > 30 * 1024 * 1024) throw new Error('File is over the 30 MB browser upload limit.')

  if (extension === 'csv') {
    const text = await file.text()
    const parsed = Papa.parse(text, { skipEmptyLines: false, dynamicTyping: false })
    if (parsed.errors?.length && !parsed.data?.length) throw new Error(parsed.errors[0].message)
    return parseRows(parsed.data, file.name, extension)
  }

  const data = await file.arrayBuffer()
  const book = XLSX.read(data, { type: 'array', raw: true, cellDates: false })
  const sheetName = book.SheetNames.includes('QB FILE') ? 'QB FILE' : book.SheetNames[0]
  const rows = XLSX.utils.sheet_to_json(book.Sheets[sheetName], { header: 1, raw: true, defval: null })
  return parseRows(rows, file.name, extension)
}

export async function uploadQuickBooks(parsed, onProgress = () => {}) {
  if (!supabase) throw new Error('Supabase environment variables are missing.')
  const begin = await supabase.rpc('income_begin_qb_upload', {
    p_file_name: parsed.fileName,
    p_file_type: parsed.extension,
    p_sheet_name: parsed.sheetName,
    p_report_date: parsed.reportDate,
    p_min_date: parsed.minDate,
    p_max_date: parsed.maxDate,
  })
  if (begin.error) throw begin.error
  const uploadId = begin.data
  const chunkSize = 500
  try {
    for (let i = 0; i < parsed.transactions.length; i += chunkSize) {
      const chunk = parsed.transactions.slice(i, i + chunkSize).map((t) => ({ ...t, upload_id: uploadId }))
      const { error } = await supabase.from('income_qb_transactions').insert(chunk)
      if (error) throw error
      onProgress(Math.min(100, Math.round(((i + chunk.length) / parsed.transactions.length) * 100)))
    }
    const done = await supabase.rpc('income_finalize_qb_upload', {
      p_upload_id: uploadId,
      p_transaction_count: parsed.transactions.length,
      p_error_message: null,
    })
    if (done.error) throw done.error
    return uploadId
  } catch (error) {
    await supabase.rpc('income_finalize_qb_upload', {
      p_upload_id: uploadId,
      p_transaction_count: 0,
      p_error_message: error.message || 'Upload failed',
    })
    throw error
  }
}

export function buildRemarks(report) {
  if (!report || !Number(report.transaction_count)) return ['No transactions were recorded for this month. Upload the corresponding QuickBooks export before closing the month.']

  const remarks = []
  const revenue = Number(report.revenue || 0)
  const cost = Number(report.total_cost || 0)
  const grossProfit = Number(report.gross_profit || 0)
  const margin = report.margin_pct == null ? null : Number(report.margin_pct)
  const overhead = Number(report.overhead || 0)
  const other = Number(report.other_cost || 0)
  const unassigned = Number(report.unassigned_count || 0)
  const topAccounts = Array.isArray(report.top_cost_accounts) ? report.top_cost_accounts : []

  if (unassigned > 0) {
    remarks.push(`${number(unassigned)} transaction${unassigned === 1 ? '' : 's'} ${unassigned === 1 ? 'is' : 'are'} not assigned to an SOF. Correct the SOF mapping before month-end sign-off.`)
  }

  if (grossProfit < 0) {
    const costRatio = revenue > 0 ? cost / revenue * 100 : null
    remarks.push(`Gross loss is ${money(Math.abs(grossProfit))}${costRatio == null ? '' : `; total cost is ${costRatio.toFixed(1)}% of revenue`}. Review the highest-cost SOFs before closing the month.`)
  } else if (revenue > 0 && margin != null && margin < 15) {
    remarks.push(`Gross margin is ${margin.toFixed(1)}%, below the 15% review threshold. Confirm billing completeness and investigate high-cost SOFs.`)
  }

  if (other > 0 && cost > 0 && other / cost >= 0.10) {
    const top = topAccounts.slice(0, 3).map(x => `${cleanText(x.account) || 'Unspecified'} ${money(x.net_cost)}`).join(', ')
    remarks.push(`Other / unmapped costs are ${money(other)} (${(other / cost * 100).toFixed(1)}% of total cost). Review account classification${top ? `, especially ${top}` : ''}.`)
  }

  if (revenue > 0 && overhead / revenue > 0.15) {
    remarks.push(`Overhead is ${(overhead / revenue * 100).toFixed(1)}% of revenue. Review travel, accommodation, logistics, and miscellaneous expenses for valid project allocation.`)
  }

  if (revenue <= 0 && cost > 0) {
    remarks.push(`Costs of ${money(cost)} were posted without matching revenue. Confirm billing timing and document any legitimate unbilled work.`)
  }

  if (!remarks.length) {
    remarks.push('No major exception was detected. Reconcile SOF assignments, supporting documents, and month-end cut-off dates before closing.')
  }

  return remarks
}

export function monthInput(dateValue = new Date()) {
  const d = new Date(dateValue)
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 7)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
