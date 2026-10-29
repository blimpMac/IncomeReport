import * as XLSX from 'xlsx'
import { normalizeSof, parseQuickBooksFile, uploadQuickBooks, supabase } from './lib.js'

const cleanText = (value) => value == null ? '' : String(value).replace(/\s+/g, ' ').trim()
const headerText = (value) => cleanText(value).toLowerCase()

const num = (value) => {
  if (value == null || value === '') return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const parsed = Number(String(value).replace(/[₱,$\s]/g, '').replace(/\((.*)\)/, '-$1'))
  return Number.isFinite(parsed) ? parsed : 0
}

const pctValue = (value) => {
  if (value == null || value === '') return 0
  if (typeof value === 'number') return Math.abs(value) > 1.5 ? value / 100 : value
  const text = cleanText(value)
  const parsed = Number(text.replace('%', '').replace(/,/g, ''))
  if (!Number.isFinite(parsed)) return 0
  return text.includes('%') || Math.abs(parsed) > 1.5 ? parsed / 100 : parsed
}

const excelDateToIso = (serial) => {
  if (typeof serial !== 'number' || serial < 20000 || serial > 80000) return null
  const epoch = new Date(Date.UTC(1899, 11, 30))
  return new Date(epoch.getTime() + Math.floor(serial) * 86400000).toISOString().slice(0, 10)
}

const toIsoDate = (value) => {
  if (value == null || value === '') return null
  const serialDate = excelDateToIso(value)
  if (serialDate) return serialDate
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}

function parseReferenceData(rows) {
  let headerRow = -1
  for (let r = 0; r < Math.min(rows.length, 40); r += 1) {
    const cells = (rows[r] || []).map(headerText)
    if (cells.some(x => x === 'project name') && cells.some(x => x.includes('sof number'))) {
      headerRow = r
      break
    }
  }
  if (headerRow < 0) throw new Error('REFERENCE DATA is present, but the PROJECT NAME / SOF NUMBER header row could not be found.')

  const headers = (rows[headerRow] || []).map(headerText)
  const subheaders = (rows[headerRow + 1] || []).map(headerText)
  const find = (tests, fallback) => {
    const idx = headers.findIndex(h => tests.some(test => h.includes(test)))
    return idx >= 0 ? idx : fallback
  }
  const findSub = (tests, fallback) => {
    const idx = subheaders.findIndex(h => tests.some(test => h === test || h.includes(test)))
    return idx >= 0 ? idx : fallback
  }

  const c = {
    project: find(['project name'], 0),
    sof: find(['sof number'], 1),
    po: find(['p.o/ contract', 'p.o / contract', 'po/ contract'], 2),
    location: find(['project location'], 3),
    client: find(['client name'], 4),
    owner: find(['project owner'], 5),
    classification: find(['construction classification'], 6),
    scope: find(['scope of works'], 7),
    pic: find(['pic'], 8),
    contact: find(['contact no'], 9),
    award: find(['date of award'], 10),
    start: find(['start date'], 11),
    target: find(['target date'], 12),
    contract: find(['contract value'], 13),
    planned: findSub(['planned'], 14),
    actual: findSub(['actual'], 15),
    remarks: find(['remarks'], 16),
    status: find(['project status'], 17),
    completion: find(['actual date of completion'], 18),
    finalContract: find(['final contract value'], 19),
    coc: find(['certificate of completion'], 20),
    projectCode: find(['project code'], 21),
    cancelled: find(['cancelled date'], 23),
    materials: find(['materials'], 24),
    labor: find(['labor'], 25),
    overhead: find(['overhead'], 26),
    tpc: find(['tpc'], 27),
    totalCost: find(['total cost'], 28),
  }

  const hasSubheader = subheaders.some(x => x === 'planned') || subheaders.some(x => x === 'actual')
  const firstDataRow = headerRow + (hasSubheader ? 2 : 1)
  const projects = []

  for (let r = firstDataRow; r < rows.length; r += 1) {
    const row = rows[r] || []
    const projectName = cleanText(row[c.project])
    const sofNumber = cleanText(row[c.sof])
    const projectOwner = cleanText(row[c.owner])
    if (!projectName && !sofNumber && !projectOwner) continue
    if (/^total\b/i.test(projectName)) continue

    const sof = normalizeSof(sofNumber)
    projects.push({
      source_row: r + 1,
      project_name: projectName,
      sof_number: sofNumber,
      sof_key: sof.key,
      sof_base: sof.base,
      po_contract: cleanText(row[c.po]),
      project_location: cleanText(row[c.location]),
      client_name: cleanText(row[c.client]),
      project_owner: projectOwner,
      construction_classification: cleanText(row[c.classification]),
      scope_of_works: cleanText(row[c.scope]),
      pic: cleanText(row[c.pic]),
      contact_no: cleanText(row[c.contact]),
      date_of_award: toIsoDate(row[c.award]),
      start_date: toIsoDate(row[c.start]),
      target_completion_date: toIsoDate(row[c.target]),
      contract_value: num(row[c.contract]),
      planned_pct: pctValue(row[c.planned]),
      actual_pct: pctValue(row[c.actual]),
      remarks: cleanText(row[c.remarks]),
      project_status: cleanText(row[c.status]),
      actual_completion_date: toIsoDate(row[c.completion]),
      final_contract_value: num(row[c.finalContract]),
      certificate_of_completion: cleanText(row[c.coc]),
      project_code: cleanText(row[c.projectCode]),
      cancelled_date: toIsoDate(row[c.cancelled]),
      materials_budget: num(row[c.materials]),
      labor_budget: num(row[c.labor]),
      overhead_budget: num(row[c.overhead]),
      tpc_budget: num(row[c.tpc]),
      total_cost_budget: num(row[c.totalCost]),
      source_sheet: 'REFERENCE DATA',
      source_cells: row.slice(0, Math.max(29, row.length)),
    })
  }

  if (!projects.length) throw new Error('REFERENCE DATA was found, but no project rows could be read.')
  return { headerRow: headerRow + 1, projects }
}

export async function parseMasterWorkbook(file) {
  if (!file) throw new Error('Choose an Excel workbook first.')
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (!['xlsx', 'xls'].includes(extension)) throw new Error('Master Workbook Sync requires an Excel .xlsx or .xls file.')
  if (file.size > 30 * 1024 * 1024) throw new Error('File is over the 30 MB browser upload limit.')

  const data = await file.arrayBuffer()
  const book = XLSX.read(data, { type: 'array', raw: true, cellDates: false })
  const referenceSheet = book.SheetNames.find(name => name.trim().toUpperCase() === 'REFERENCE DATA')
  const qbSheet = book.SheetNames.find(name => name.trim().toUpperCase() === 'QB FILE')
  if (!referenceSheet || !qbSheet) throw new Error('This workbook must contain both REFERENCE DATA and QB FILE sheets.')

  const referenceRows = XLSX.utils.sheet_to_json(book.Sheets[referenceSheet], { header: 1, raw: true, defval: null })
  const reference = parseReferenceData(referenceRows)
  const qb = await parseQuickBooksFile(file)
  const modifiedAt = file.lastModified ? new Date(file.lastModified).toISOString() : new Date().toISOString()

  return {
    fileName: file.name,
    extension,
    fileSize: file.size,
    sourceFileId: `${file.name}:${file.size}:${file.lastModified || 0}`,
    sourceModifiedAt: modifiedAt,
    sheets: book.SheetNames,
    ignoredSheets: book.SheetNames.filter(name => !['REFERENCE DATA', 'QB FILE'].includes(name.trim().toUpperCase())),
    references: reference.projects,
    referenceHeaderRow: reference.headerRow,
    qb,
  }
}

export async function syncMasterWorkbook(parsed, onProgress = () => {}) {
  if (!supabase) throw new Error('Supabase environment variables are missing.')
  if (!parsed?.references?.length || !parsed?.qb?.transactions?.length) throw new Error('The workbook preview is incomplete. Choose the workbook again.')

  onProgress(2, 'Uploading QuickBooks transactions')
  await uploadQuickBooks(parsed.qb, (value) => onProgress(Math.max(2, Math.round(value * 0.82)), 'Uploading QuickBooks transactions'))

  onProgress(88, 'Replacing Reference Data')
  const { data, error } = await supabase.rpc('income_replace_reference_projects', {
    p_rows: parsed.references,
    p_file_name: parsed.fileName,
    p_source_file_id: parsed.sourceFileId,
    p_source_modified_at: parsed.sourceModifiedAt,
    p_confirmation: 'REPLACE_REFERENCE_DATA',
  })
  if (error) throw error
  onProgress(100, 'Sync complete')
  return { referenceRows: Number(data || parsed.references.length), qbTransactions: parsed.qb.transactions.length }
}
