import crypto from 'node:crypto'

const DEFAULT_SPREADSHEET_ID = '1FBsSwS7EAvRCYyBhSm0y9YqZL2NLaG25fODy4Ri-lVc'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets'
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets'
const CACHE_MS = 10_000

let tokenCache = { token: null, expiresAt: 0 }
let liveCache = { at: 0, data: null }

const clean = (value) => value == null ? '' : String(value).trim()
const num = (value) => {
  if (value == null || value === '') return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const n = Number(String(value).replace(/[₱,$\s]/g, '').replace(/\((.*)\)/, '-$1').replace(/%$/, ''))
  return Number.isFinite(n) ? n : 0
}
const round2 = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100
const escapeSheet = (title) => `'${String(title).replace(/'/g, "''")}'`

function toIsoDate(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number' && value >= 20_000 && value <= 80_000) {
    const epoch = Date.UTC(1899, 11, 30)
    return new Date(epoch + Math.floor(value) * 86_400_000).toISOString().slice(0, 10)
  }
  const s = clean(value)
  const mdY = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/)
  if (mdY) {
    let year = Number(mdY[3])
    if (year < 100) year += year >= 70 ? 1900 : 2000
    const date = new Date(Date.UTC(year, Number(mdY[1]) - 1, Number(mdY[2])))
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
  }
  const date = new Date(s)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

function normalizeSof(raw) {
  const text = clean(raw).toUpperCase()
  if (!text || /^NO\s*SOF$/i.test(text)) return { label: text, key: '', base: '' }
  let value = text.replace(/^TOTAL\s+/i, '').replace(/^SOF[\s:_-]*/i, '').trim()
  value = value.replace(/\s+/g, '').replace(/_/g, '-')
  const base = value.match(/\d+/)?.[0] || ''
  return { label: text, key: value, base }
}

function categorizeAccount(account = '') {
  const a = clean(account).toLowerCase()
  if (/sales|revenue|service income|income on/.test(a)) return 'Revenue'
  if (/salary|wage|overtime|labor|labour|sss|philhealth|phic|pag-ibig|hdmf|13th month|employee benefit|payroll/.test(a)) return 'Labor'
  if (/material|consumable|ppe cost|tool|equipment|parts|electrical supply|hardware/.test(a)) return 'Materials'
  if (/fare|transport|accommodation|lodging|meal|food|communication|internet|gasoline|fuel|parking|toll|courier|hauler|mobilization|freight|permit|miscellaneous|rental|rent|printing|grocer|delivery/.test(a)) return 'Overhead'
  return 'Other'
}

function parseReferenceRows(rows = []) {
  let header = -1
  for (let i = 0; i < Math.min(rows.length, 30); i += 1) {
    const r = (rows[i] || []).map((v) => clean(v).toUpperCase())
    if (r.includes('PROJECT NAME') && r.includes('SOF NUMBER')) { header = i; break }
  }
  if (header < 0) return []
  const result = []
  for (let i = header + 2; i < rows.length; i += 1) {
    const r = rows[i] || []
    const projectName = clean(r[0])
    const sofNumber = clean(r[1])
    const projectStatus = clean(r[17])
    if (!projectName && !sofNumber && !projectStatus && !clean(r[21])) continue
    const sof = normalizeSof(sofNumber)
    result.push({
      id: `ref-${i + 1}`,
      source_row: i + 1,
      project_name: projectName || null,
      sof_number: sofNumber || null,
      sof_key: sof.key || null,
      sof_base: sof.base || null,
      po_contract: clean(r[2]) || null,
      project_location: clean(r[3]) || null,
      client_name: clean(r[4]) || null,
      project_owner: clean(r[5]) || null,
      construction_classification: clean(r[6]) || null,
      scope_of_works: clean(r[7]) || null,
      pic: clean(r[8]) || null,
      contact_no: clean(r[9]) || null,
      date_of_award: toIsoDate(r[10]),
      start_date: toIsoDate(r[11]),
      target_completion_date: toIsoDate(r[12]),
      contract_value: num(r[13]),
      planned_pct: num(r[14]),
      actual_pct: num(r[15]),
      remarks: clean(r[16]) || null,
      project_status: projectStatus || null,
      actual_completion_date: toIsoDate(r[18]),
      final_contract_value: num(r[19]),
      certificate_of_completion: clean(r[20]) || null,
      project_code: clean(r[21]) || null,
      cancelled_date: toIsoDate(r[23]),
      materials_budget: num(r[24]),
      labor_budget: num(r[25]),
      overhead_budget: num(r[26]),
      tpc_budget: num(r[27]),
      total_cost_budget: num(r[28]),
    })
  }
  return result
}

function looksLikeHeader(row = []) {
  const h = row.map((v) => clean(v).toLowerCase())
  return h.includes('type') && h.includes('date') && h.includes('account') && h.includes('debit') && h.includes('credit')
}

function parseQuickBooksRows(rows = [], sheetTitle = 'QB FILE') {
  let headerRow = -1
  for (let i = 0; i < Math.min(rows.length, 40); i += 1) {
    if (looksLikeHeader(rows[i] || [])) { headerRow = i; break }
  }
  if (headerRow < 0) return []
  const headers = (rows[headerRow] || []).map((v) => clean(v).toLowerCase())
  const idx = (name) => headers.indexOf(name)
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

  for (let r = headerRow + 1; r < rows.length; r += 1) {
    const row = rows[r] || []
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
    const memo = clean(row[memoIdx])
    const txName = clean(row[nameIdx])
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
    const account = clean(row[accountIdx])
    transactions.push({
      id: `${sheetTitle}-${r + 1}`,
      source_row: r + 1,
      division: division || null,
      project_group: projectGroup || null,
      sof_label: sof.label || null,
      sof_key: sof.key || null,
      sof_base: sof.base || null,
      type,
      transaction_date: transactionDate,
      num: clean(row[numIdx]) || null,
      name: txName || null,
      memo: memo || null,
      account: account || null,
      debit: num(row[debitIdx]),
      credit: num(row[creditIdx]),
      balance: row[balanceIdx] == null || row[balanceIdx] === '' ? null : num(row[balanceIdx]),
      category: categorizeAccount(account),
      source_sheet: sheetTitle,
    })
  }
  return transactions
}

function monthlyReport(transactions, month) {
  const tx = month ? transactions.filter((t) => t.transaction_date?.startsWith(month)) : transactions
  const report = { month, transaction_count: tx.length, unique_sof: 0, unassigned_count: 0, revenue: 0, materials: 0, labor: 0, overhead: 0, other_cost: 0, total_cost: 0, gross_profit: 0, margin_pct: null, top_cost_accounts: [] }
  const sof = new Set()
  const accounts = new Map()
  for (const t of tx) {
    if (t.sof_key) sof.add(t.sof_key); else report.unassigned_count += 1
    const value = t.category === 'Revenue' ? t.credit - t.debit : t.debit - t.credit
    if (t.category === 'Revenue') report.revenue += value
    else if (t.category === 'Materials') report.materials += value
    else if (t.category === 'Labor') report.labor += value
    else if (t.category === 'Overhead') report.overhead += value
    else report.other_cost += value
    if (t.category !== 'Revenue') accounts.set(t.account || 'Unspecified', (accounts.get(t.account || 'Unspecified') || 0) + value)
  }
  report.unique_sof = sof.size
  for (const key of ['revenue', 'materials', 'labor', 'overhead', 'other_cost']) report[key] = round2(report[key])
  report.total_cost = round2(report.materials + report.labor + report.overhead + report.other_cost)
  report.gross_profit = round2(report.revenue - report.total_cost)
  report.margin_pct = report.revenue ? round2(report.gross_profit / report.revenue * 100) : null
  report.top_cost_accounts = [...accounts.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 5).map(([account, net_cost]) => ({ account, net_cost: round2(net_cost) }))
  return report
}

function sofSummary(transactions, refs, month = null) {
  const refByKey = new Map(), refByBase = new Map()
  for (const r of refs) {
    if (r.sof_key && !refByKey.has(r.sof_key)) refByKey.set(r.sof_key, r)
    if (r.sof_base && !refByBase.has(r.sof_base)) refByBase.set(r.sof_base, r)
  }
  const groups = new Map()
  const list = month ? transactions.filter((t) => t.transaction_date?.startsWith(month)) : transactions
  for (const t of list) {
    const key = t.sof_key || 'UNASSIGNED'
    if (!groups.has(key)) groups.set(key, { sof_key: key, sof_label: t.sof_label || 'Unassigned', sof_base: t.sof_base || null, transaction_count: 0, first_transaction_date: null, last_transaction_date: null, revenue: 0, materials: 0, labor: 0, overhead: 0, other_cost: 0 })
    const g = groups.get(key)
    g.transaction_count += 1
    if (!g.first_transaction_date || t.transaction_date < g.first_transaction_date) g.first_transaction_date = t.transaction_date
    if (!g.last_transaction_date || t.transaction_date > g.last_transaction_date) g.last_transaction_date = t.transaction_date
    const value = t.category === 'Revenue' ? t.credit - t.debit : t.debit - t.credit
    if (t.category === 'Revenue') g.revenue += value
    else if (t.category === 'Materials') g.materials += value
    else if (t.category === 'Labor') g.labor += value
    else if (t.category === 'Overhead') g.overhead += value
    else g.other_cost += value
  }
  return [...groups.values()].map((g) => {
    for (const key of ['revenue', 'materials', 'labor', 'overhead', 'other_cost']) g[key] = round2(g[key])
    g.total_cost = round2(g.materials + g.labor + g.overhead + g.other_cost)
    g.gross_profit = round2(g.revenue - g.total_cost)
    g.margin_pct = g.revenue ? round2(g.gross_profit / g.revenue * 100) : null
    const ref = refByKey.get(g.sof_key) || (g.sof_base ? refByBase.get(g.sof_base) : null)
    if (ref) Object.assign(g, {
      project_name: ref.project_name,
      project_status: ref.project_status,
      contract_value: ref.contract_value,
      final_contract_value: ref.final_contract_value,
      materials_budget: ref.materials_budget,
      labor_budget: ref.labor_budget,
      overhead_budget: ref.overhead_budget,
      total_cost_budget: ref.total_cost_budget,
      budget_variance: ref.total_cost_budget ? round2(ref.total_cost_budget - g.total_cost) : null,
    })
    return g
  }).sort((a, b) => month
    ? (Math.abs(b.revenue) + Math.abs(b.total_cost)) - (Math.abs(a.revenue) + Math.abs(a.total_cost))
    : String(b.last_transaction_date || '').localeCompare(String(a.last_transaction_date || '')))
}

function serviceAccount() {
  let email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  let privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      const parsed = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
      email ||= parsed.client_email
      privateKey ||= parsed.private_key
    } catch {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.')
    }
  }
  if (!email || !privateKey) throw new Error('Google Sheets runtime credentials are not configured. Add GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY in Vercel, then share the source workbook with that service-account email as Editor.')
  return { email, privateKey: privateKey.replace(/\\n/g, '\n') }
}

function b64url(value) {
  return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url')
}

async function accessToken() {
  if (tokenCache.token && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token
  const { email, privateKey } = serviceAccount()
  const now = Math.floor(Date.now() / 1000)
  const unsigned = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({ iss: email, scope: SCOPE, aud: TOKEN_URL, iat: now - 30, exp: now + 3600 })}`
  const signer = crypto.createSign('RSA-SHA256')
  signer.update(unsigned)
  signer.end()
  const assertion = `${unsigned}.${signer.sign(privateKey).toString('base64url')}`
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  })
  const data = await response.json()
  if (!response.ok || !data.access_token) throw new Error(data.error_description || data.error || 'Google OAuth token request failed.')
  tokenCache = { token: data.access_token, expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000 }
  return tokenCache.token
}

function spreadsheetId() {
  return process.env.GOOGLE_SHEETS_SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID
}

async function googleFetch(path, options = {}) {
  const token = await accessToken()
  const response = await fetch(`${SHEETS_API}/${spreadsheetId()}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!response.ok) throw new Error(data?.error?.message || data?.error_description || `Google Sheets API returned ${response.status}.`)
  return data
}

async function metadata() {
  const fields = encodeURIComponent('properties(title,timeZone),sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount)))')
  return googleFetch(`?includeGridData=false&fields=${fields}`)
}

async function batchValues(ranges) {
  const params = new URLSearchParams({ majorDimension: 'ROWS', valueRenderOption: 'FORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING' })
  for (const range of ranges) params.append('ranges', range)
  return googleFetch(`/values:batchGet?${params.toString()}`)
}

async function liveData(force = false) {
  if (!force && liveCache.data && Date.now() - liveCache.at < CACHE_MS) return liveCache.data
  const meta = await metadata()
  const sheets = meta.sheets?.map((x) => x.properties) || []
  const reference = sheets.find((s) => s.title === 'REFERENCE DATA')
  const qb = sheets.find((s) => s.title === 'QB FILE')
  if (!reference) throw new Error('REFERENCE DATA sheet was not found in the configured workbook.')
  if (!qb) throw new Error('QB FILE sheet was not found in the configured workbook.')
  const ranges = [
    `${escapeSheet('REFERENCE DATA')}!A1:AC${reference.gridProperties?.rowCount || 1003}`,
    `${escapeSheet('QB FILE')}!A1:N${qb.gridProperties?.rowCount || 20000}`,
  ]
  const values = await batchValues(ranges)
  const referenceRows = values.valueRanges?.[0]?.values || []
  const qbRows = values.valueRanges?.[1]?.values || []
  const references = parseReferenceRows(referenceRows)
  const transactions = parseQuickBooksRows(qbRows, 'QB FILE')
  const latestDate = transactions.reduce((max, t) => !max || t.transaction_date > max ? t.transaction_date : max, null)
  const data = { spreadsheetTitle: meta.properties?.title || 'E-WORKS REFERENCE DATA', sheets, references, transactions, latestDate, fetchedAt: new Date().toISOString() }
  liveCache = { at: Date.now(), data }
  return data
}

function paginate(rows, page = 0, pageSize = 10) {
  const p = Math.max(0, Number(page) || 0)
  const size = Math.min(100, Math.max(1, Number(pageSize) || 10))
  return { rows: rows.slice(p * size, p * size + size), total: rows.length, page: p, pageSize: size }
}

function sheetDate(title) {
  const match = String(title).match(/^QB\s+(\d{1,2})\/(\d{1,2})\/(\d{4})$/i)
  if (!match) return null
  return `${match[3]}-${String(match[1]).padStart(2, '0')}-${String(match[2]).padStart(2, '0')}`
}

async function ensureSheet(title, rowCount, columnCount = 26) {
  const meta = await metadata()
  let sheet = meta.sheets?.map((s) => s.properties).find((s) => s.title === title)
  if (!sheet) {
    const created = await googleFetch(':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title, gridProperties: { rowCount: Math.max(1000, rowCount + 20), columnCount: Math.max(26, columnCount) } } } }] }),
    })
    sheet = created.replies?.[0]?.addSheet?.properties
  } else if ((sheet.gridProperties?.rowCount || 0) < rowCount + 5 || (sheet.gridProperties?.columnCount || 0) < columnCount) {
    await googleFetch(':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({ requests: [{ updateSheetProperties: { properties: { sheetId: sheet.sheetId, gridProperties: { rowCount: Math.max(sheet.gridProperties?.rowCount || 0, rowCount + 20), columnCount: Math.max(sheet.gridProperties?.columnCount || 0, columnCount) } }, fields: 'gridProperties(rowCount,columnCount)' } }] }),
    })
  }
  return sheet
}

async function clearSheet(title) {
  await googleFetch(`/values/${encodeURIComponent(`${escapeSheet(title)}!A:Z`)}:clear`, { method: 'POST', body: '{}' })
}

async function writeRows(title, startRow, rows) {
  if (!rows?.length) return
  const range = `${escapeSheet(title)}!A${startRow}`
  await googleFetch(`/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ majorDimension: 'ROWS', values: rows }),
  })
}

function normalizeRows(rows) {
  return (rows || []).map((row) => (Array.isArray(row) ? row : []).map((cell) => {
    if (cell == null) return ''
    if (cell instanceof Date) return cell.toISOString()
    if (typeof cell === 'number' || typeof cell === 'boolean') return cell
    return String(cell)
  }))
}

function send(res, status, payload) {
  res.setHeader('Cache-Control', 'no-store, max-age=0')
  return res.status(status).json(payload)
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const action = String(req.query.action || 'dashboard')
      const data = await liveData(req.query.refresh === '1')
      if (action === 'status') return send(res, 200, { connected: true, spreadsheetTitle: data.spreadsheetTitle, spreadsheetId: spreadsheetId(), sourceSheet: 'QB FILE', referenceSheet: 'REFERENCE DATA', transactionCount: data.transactions.length, referenceCount: data.references.length, latestDate: data.latestDate, fetchedAt: data.fetchedAt })
      if (action === 'dashboard') {
        const month = String(req.query.month || data.latestDate?.slice(0, 7) || new Date().toISOString().slice(0, 7))
        const tx = [...data.transactions].sort((a, b) => String(b.transaction_date).localeCompare(String(a.transaction_date)) || b.source_row - a.source_row)
        return send(res, 200, { report: monthlyReport(data.transactions, month), recent: tx.slice(0, 10), latestDate: data.latestDate, month, fetchedAt: data.fetchedAt })
      }
      if (action === 'monthly') {
        const month = String(req.query.month || data.latestDate?.slice(0, 7) || new Date().toISOString().slice(0, 7))
        return send(res, 200, { report: monthlyReport(data.transactions, month), rows: sofSummary(data.transactions, data.references, month), month, fetchedAt: data.fetchedAt })
      }
      if (action === 'transactions') {
        const sorted = [...data.transactions].sort((a, b) => String(b.transaction_date).localeCompare(String(a.transaction_date)) || b.source_row - a.source_row)
        return send(res, 200, { ...paginate(sorted, req.query.page, req.query.pageSize), fetchedAt: data.fetchedAt })
      }
      if (action === 'reference') return send(res, 200, { ...paginate(data.references, req.query.page, req.query.pageSize), fetchedAt: data.fetchedAt })
      if (action === 'sof') return send(res, 200, { ...paginate(sofSummary(data.transactions, data.references), req.query.page, req.query.pageSize), fetchedAt: data.fetchedAt })
      if (action === 'worksheets') {
        const worksheetRows = data.sheets
          .filter((s) => s.title === 'QB FILE' || /^QB\s+\d{1,2}\/\d{1,2}\/\d{4}$/i.test(s.title))
          .map((s) => ({ id: s.sheetId, sheet_name: s.title, report_date: s.title === 'QB FILE' ? data.latestDate : sheetDate(s.title), row_count: s.gridProperties?.rowCount || 0, source: s.title === 'QB FILE' ? 'Live source' : 'Upload snapshot' }))
          .sort((a, b) => (a.sheet_name === 'QB FILE' ? -1 : b.sheet_name === 'QB FILE' ? 1 : String(b.report_date || '').localeCompare(String(a.report_date || ''))))
        return send(res, 200, { ...paginate(worksheetRows, req.query.page, req.query.pageSize), fetchedAt: data.fetchedAt })
      }
      return send(res, 400, { error: 'Unknown action.' })
    }

    if (req.method === 'POST') {
      const action = String(req.body?.action || '')
      if (action === 'beginUpload') {
        const sheetName = clean(req.body.sheetName)
        const rowCount = Math.max(1, Number(req.body.rowCount) || 1)
        const columnCount = Math.min(100, Math.max(1, Number(req.body.columnCount) || 26))
        if (!/^QB\s+\d{1,2}\/\d{1,2}\/\d{4}$/i.test(sheetName)) return send(res, 400, { error: 'Invalid QB worksheet name.' })
        await ensureSheet(sheetName, rowCount, columnCount)
        await ensureSheet('QB FILE', rowCount, columnCount)
        await Promise.all([clearSheet(sheetName), clearSheet('QB FILE')])
        liveCache = { at: 0, data: null }
        return send(res, 200, { ok: true, sheetName })
      }
      if (action === 'uploadChunk') {
        const sheetName = clean(req.body.sheetName)
        const startRow = Math.max(1, Number(req.body.startRow) || 1)
        if (!/^QB\s+\d{1,2}\/\d{1,2}\/\d{4}$/i.test(sheetName)) return send(res, 400, { error: 'Invalid QB worksheet name.' })
        const rows = normalizeRows(req.body.rows)
        if (!rows.length || rows.length > 1000) return send(res, 400, { error: 'Upload chunks must contain 1 to 1000 rows.' })
        await Promise.all([writeRows(sheetName, startRow, rows), writeRows('QB FILE', startRow, rows)])
        return send(res, 200, { ok: true, written: rows.length })
      }
      if (action === 'finishUpload') {
        liveCache = { at: 0, data: null }
        const data = await liveData(true)
        return send(res, 200, { ok: true, transactionCount: data.transactions.length, latestDate: data.latestDate, fetchedAt: data.fetchedAt })
      }
      return send(res, 400, { error: 'Unknown upload action.' })
    }

    res.setHeader('Allow', 'GET, POST')
    return send(res, 405, { error: 'Method not allowed.' })
  } catch (error) {
    console.error('Google Sheets integration error:', error)
    return send(res, 503, { error: error?.message || 'Google Sheets request failed.' })
  }
}
