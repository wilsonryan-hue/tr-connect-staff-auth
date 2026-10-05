/**
 * Staff desk book. One JSON file under DATA_DIR so a refresh and a second
 * device see the same jobs. The file is gitignored. A corrupt file is not
 * overwritten with an empty book.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import {
  FORMULA,
  assertStatus,
  clip,
  companyProfile,
  formatPounds,
  formatUk,
  isReviewMark,
  londonToday,
  marginPercent,
  parseDate,
  parseMark,
  parsePounds,
  parseStatus,
  parseTax,
  parseVatTreatment,
  vatPence,
  vatSpec,
} from './money.js'
import { markMailboxRead, syncMailbox } from './mail-sync.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

function dataDir() {
  return process.env.DATA_DIR || join(ROOT, 'data')
}

export function deskPath() {
  return process.env.DESK_STORE_PATH || join(dataDir(), 'desk.json')
}

function filesDir() {
  return join(dataDir(), 'job-files')
}

function emptyBook() {
  return {
    v: 1,
    jobs: [],
    variations: [],
    costs: [],
    invoices: [],
    supplierBills: [],
    workers: [],
    assignments: [],
    quotes: [],
    tenders: [],
    mail: [],
    hours: [],
    siteNotes: [],
    files: [],
    materials: [],
    purchaseOrders: [],
    suppliers: [],
    creditNotes: [],
    invoiceSeq: 0,
    billSeq: 0,
    quoteSeq: 0,
    poSeq: 0,
    creditSeq: 0,
  }
}

function httpError(status, error) {
  const err = new Error(error)
  err.status = status
  return err
}

let tail = Promise.resolve()

function locked(fn) {
  const run = tail.then(fn, fn)
  tail = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

function readBook() {
  const path = deskPath()
  if (!existsSync(path)) return emptyBook()
  let raw
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw httpError(500, 'The desk file could not be read. Nothing was overwritten.')
  }
  const book = emptyBook()
  for (const key of [
    'jobs',
    'variations',
    'costs',
    'invoices',
    'supplierBills',
    'workers',
    'assignments',
    'quotes',
    'tenders',
    'mail',
    'hours',
    'siteNotes',
    'files',
    'materials',
    'purchaseOrders',
    'suppliers',
    'creditNotes',
  ]) {
    if (Array.isArray(raw?.[key])) book[key] = raw[key]
  }
  book.invoiceSeq = Number(raw?.invoiceSeq) || 0
  book.billSeq = Number(raw?.billSeq) || 0
  book.quoteSeq = Number(raw?.quoteSeq) || 0
  book.poSeq = Number(raw?.poSeq) || 0
  book.creditSeq = Number(raw?.creditSeq) || 0
  return book
}

function writeBook(book) {
  const path = deskPath()
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(book, null, 2), 'utf8')
  renameSync(tmp, path)
}

function nid(prefix) {
  return `${prefix}_${randomBytes(8).toString('hex')}`
}

function sameTenant(row, tenantId) {
  return row && row.tenantId === tenantId
}

function findJob(book, tenantId, id) {
  const job = book.jobs.find((j) => j.id === id && sameTenant(j, tenantId))
  if (!job) throw httpError(404, 'That job is not on the desk.')
  return job
}

function moneyFor(job, variations, costs) {
  const approved = variations
    .filter((v) => v.approved && !isReviewMark(v.mark))
    .reduce((sum, v) => sum + v.amountPence, 0)
  const costTotal = costs
    .filter((c) => !isReviewMark(c.mark))
    .reduce((sum, c) => sum + c.amountPence, 0)
  const base = job.contractSumPence + approved
  const margin = base - costTotal
  const pct = marginPercent(margin, base)
  return {
    formula: FORMULA,
    contractSum: formatPounds(job.contractSumPence),
    contractSumPence: job.contractSumPence,
    approvedVariations: formatPounds(approved),
    approvedVariationsPence: approved,
    costs: formatPounds(costTotal),
    costsPence: costTotal,
    margin: formatPounds(margin),
    marginPence: margin,
    marginPercent: pct,
  }
}

function shapeWorker(worker, book) {
  const today = londonToday()
  const jobIds = book.assignments
    .filter((a) => a.workerId === worker.id && a.tenantId === worker.tenantId)
    .map((a) => a.jobId)
  const jobs = book.jobs
    .filter((j) => jobIds.includes(j.id) && j.tenantId === worker.tenantId)
    .map((j) => ({ id: j.id, name: j.name }))
  return {
    id: worker.id,
    name: worker.name,
    trade: worker.trade,
    phone: worker.phone,
    tax: worker.tax,
    ticketExpiry: worker.ticketExpiry || '',
    ticketExpiryDisplay: formatUk(worker.ticketExpiry),
    ticketExpired: Boolean(worker.ticketExpiry && worker.ticketExpiry < today),
    note: worker.note || '',
    jobs,
  }
}

function approvalOf(row) {
  if (row.approval === 'pending' || row.approval === 'in-review' || row.approval === 'none') {
    return row.approval
  }
  return isReviewMark(row.mark) ? 'pending' : 'none'
}

function shapeLine(row) {
  const mark = row.mark || ''
  return {
    id: row.id,
    jobId: row.jobId,
    description: row.description,
    amount: formatPounds(row.amountPence),
    amountPence: row.amountPence,
    approved: Boolean(row.approved),
    mark,
    review: isReviewMark(mark),
    approval: approvalOf(row),
  }
}

function shapeInvoice(inv) {
  return {
    id: inv.id,
    jobId: inv.jobId,
    number: inv.number,
    date: inv.date,
    dateDisplay: formatUk(inv.date),
    status: inv.status,
    issued: inv.status === 'issued',
    lines: inv.lines.map((line) => ({
      description: line.description,
      net: formatPounds(line.netPence),
      netPence: line.netPence,
    })),
    net: formatPounds(inv.netPence),
    netPence: inv.netPence,
    vat: formatPounds(inv.vatPence),
    vatPence: inv.vatPence,
    gross: formatPounds(inv.grossPence),
    grossPence: inv.grossPence,
    vatLabel: inv.vatLabel,
    vatTreatment: inv.vatTreatment,
    jobName: inv.jobName,
    clientName: inv.clientName,
    siteAddress: inv.siteAddress,
  }
}

function shapeBill(bill, book) {
  const job = book.jobs.find((j) => j.id === bill.jobId)
  return {
    id: bill.id,
    supplier: bill.supplier,
    date: bill.date,
    dateDisplay: formatUk(bill.date),
    reference: bill.reference || '',
    net: formatPounds(bill.netPence),
    netPence: bill.netPence,
    vat: formatPounds(bill.vatPence),
    vatPence: bill.vatPence,
    gross: formatPounds(bill.grossPence),
    grossPence: bill.grossPence,
    vatLabel: bill.vatLabel,
    jobId: bill.jobId || '',
    jobName: job && job.tenantId === bill.tenantId ? job.name : '',
    supplierId: bill.supplierId || '',
    mark: bill.mark || '',
    review: isReviewMark(bill.mark),
    approval: approvalOf(bill),
  }
}

function shapeJob(job, book) {
  const variations = book.variations.filter((v) => v.jobId === job.id && v.tenantId === job.tenantId)
  const costs = book.costs.filter((c) => c.jobId === job.id && c.tenantId === job.tenantId)
  const workerIds = book.assignments
    .filter((a) => a.jobId === job.id && a.tenantId === job.tenantId)
    .map((a) => a.workerId)
  const workers = book.workers
    .filter((w) => workerIds.includes(w.id) && w.tenantId === job.tenantId)
    .map((w) => shapeWorker(w, book))
  const spec = vatSpec(job.vatTreatment)
  return {
    id: job.id,
    name: job.name,
    client: job.client,
    siteAddress: job.siteAddress,
    status: assertStatus(job.status),
    contractSum: formatPounds(job.contractSumPence),
    contractSumPence: job.contractSumPence,
    vatTreatment: job.vatTreatment,
    vatLabel: spec.label,
    notes: job.notes || '',
    startDate: job.startDate || '',
    startDateDisplay: formatUk(job.startDate),
    quoteId: job.quoteId || '',
    money: moneyFor(job, variations, costs),
    workers,
  }
}

function staffView(book, tenantId) {
  const jobs = book.jobs.filter((j) => sameTenant(j, tenantId))
  return {
    company: companyProfile(),
    jobs: jobs.map((j) => shapeJob(j, book)),
    variations: book.variations.filter((v) => sameTenant(v, tenantId)).map(shapeLine),
    costs: book.costs.filter((c) => sameTenant(c, tenantId)).map(shapeLine),
    invoices: book.invoices.filter((inv) => sameTenant(inv, tenantId)).map(shapeInvoice),
    supplierBills: book.supplierBills.filter((b) => sameTenant(b, tenantId)).map((b) => shapeBill(b, book)),
    workers: book.workers.filter((w) => sameTenant(w, tenantId)).map((w) => shapeWorker(w, book)),
    quotes: book.quotes.filter((q) => sameTenant(q, tenantId)).map((q) => shapeQuote(q, book)),
    tenders: book.tenders.filter((t) => sameTenant(t, tenantId)).map((t) => shapeTender(t, book)),
    mail: book.mail.filter((m) => sameTenant(m, tenantId)).map((m) => shapeMail(m, book)),
    hours: book.hours.filter((h) => sameTenant(h, tenantId)).map((h) => shapeHour(h, book)),
    siteNotes: book.siteNotes.filter((n) => sameTenant(n, tenantId)).map((n) => shapeSiteNote(n, book)),
    files: book.files.filter((f) => sameTenant(f, tenantId)).map((f) => shapeFile(f, book)),
    materials: book.materials.filter((row) => sameTenant(row, tenantId)).map(shapeMaterial),
    purchaseOrders: book.purchaseOrders
      .filter((row) => sameTenant(row, tenantId))
      .map((row) => shapePurchaseOrder(row, book)),
    suppliers: suppliersFor(book, tenantId),
    creditNotes: book.creditNotes.filter((row) => sameTenant(row, tenantId)).map(shapeCredit),
  }
}

function requireText(value, max, sentence) {
  const text = clip(value, max)
  if (!text) throw httpError(400, sentence)
  return text
}

function requirePounds(value, blankSentence) {
  if (value == null || String(value).trim() === '') throw httpError(400, blankSentence)
  const parsed = parsePounds(value)
  if (!parsed.ok) throw httpError(400, parsed.error)
  return parsed.pence
}

function requireDate(value, fallbackIso) {
  const source = value == null || String(value).trim() === '' ? fallbackIso : value
  const iso = parseDate(source)
  if (!iso) throw httpError(400, 'Enter the date as dd/mm/yyyy.')
  return iso
}

function linesFrom(input, fallbackPence) {
  const raw = Array.isArray(input?.lines) ? input.lines : []
  if (!raw.length) {
    return [{ description: 'Works', netPence: fallbackPence }]
  }
  return raw.map((line) => {
    const netPence = requirePounds(line?.net, 'Enter the invoice net.')
    const description = clip(line?.description, 200) || 'Works'
    return { description, netPence }
  })
}

function totalsFor(lines, treatment) {
  const netPence = lines.reduce((sum, line) => sum + line.netPence, 0)
  const vat = vatPence(netPence, treatment)
  const spec = vatSpec(treatment)
  return {
    netPence,
    vatPence: vat,
    grossPence: netPence + vat,
    vatLabel: spec.label,
    vatTreatment: treatment,
  }
}

function snapshotJob(job) {
  return {
    jobName: job.name,
    clientName: job.client,
    siteAddress: job.siteAddress,
  }
}

function rejectImage(note) {
  const s = String(note ?? '')
  if (/^data:image\//i.test(s) || /\.(png|jpe?g|gif|webp)$/i.test(s.trim())) {
    throw httpError(400, 'Do not store passport images.')
  }
}

export function getStaffView(tenantId) {
  return locked(async () => {
    const book = readBook()
    const mailbox = await syncMailbox(book, tenantId)
    if (mailbox.changed) writeBook(book)
    const view = staffView(book, tenantId)
    view.mailbox = {
      connected: mailbox.connected,
      mode: mailbox.mode,
      banner: mailbox.banner || '',
    }
    return view
  })
}

export function createJob(tenantId, input) {
  return locked(() => {
    const book = readBook()
    const now = new Date().toISOString()
    const status = input.status == null || String(input.status).trim() === ''
      ? 'quoted'
      : parseStatus(input.status)
    if (!status) throw httpError(400, 'Status must be quoted, live, snagging or done.')
    const vatTreatment = input.vatTreatment == null || String(input.vatTreatment).trim() === ''
      ? 'standard'
      : parseVatTreatment(input.vatTreatment)
    if (!vatTreatment) throw httpError(400, 'VAT must be 20%, zero-rate, or reverse charge.')
    const job = {
      id: nid('job'),
      tenantId,
      name: requireText(input.name, 200, 'Enter a job name.'),
      client: requireText(input.client, 200, 'Enter the client.'),
      siteAddress: requireText(input.siteAddress, 300, 'Enter the site address.'),
      status,
      contractSumPence: requirePounds(input.contractSum, 'Enter a contract sum in pounds and pence.'),
      vatTreatment,
      notes: clip(input.notes, 4000),
      startDate: optionalDate(input.startDate),
      quoteId: clip(input.quoteId, 80),
      createdAt: now,
      updatedAt: now,
    }
    book.jobs.push(job)
    writeBook(book)
    return shapeJob(job, book)
  })
}

export function updateJob(tenantId, id, input) {
  return locked(() => {
    const book = readBook()
    const job = findJob(book, tenantId, id)
    if ('name' in input) job.name = requireText(input.name, 200, 'Enter a job name.')
    if ('client' in input) job.client = requireText(input.client, 200, 'Enter the client.')
    if ('siteAddress' in input) {
      job.siteAddress = requireText(input.siteAddress, 300, 'Enter the site address.')
    }
    if ('status' in input) {
      const status = parseStatus(input.status)
      if (!status) throw httpError(400, 'Status must be quoted, live, snagging or done.')
      job.status = status
    }
    if ('contractSum' in input) {
      job.contractSumPence = requirePounds(input.contractSum, 'Enter a contract sum in pounds and pence.')
    }
    if ('vatTreatment' in input) {
      const vatTreatment = parseVatTreatment(input.vatTreatment)
      if (!vatTreatment) throw httpError(400, 'VAT must be 20%, zero-rate, or reverse charge.')
      job.vatTreatment = vatTreatment
    }
    if ('notes' in input) job.notes = clip(input.notes, 4000)
    if ('startDate' in input) job.startDate = optionalDate(input.startDate)
    job.updatedAt = new Date().toISOString()
    writeBook(book)
    return shapeJob(job, book)
  })
}

function addMoneyLine(tenantId, jobId, input, kind) {
  return locked(() => {
    const book = readBook()
    findJob(book, tenantId, jobId)
    const mark = parseMark(input.mark)
    if (mark == null) throw httpError(400, 'Mark a review line Ryan, Ryan2 or Kacey, or leave it blank.')
    const blank = kind === 'cost' ? 'Enter a cost amount.' : 'Enter a variation amount.'
    const fallback = kind === 'cost' ? 'Cost' : 'Variation'
    const row = {
      id: nid(kind === 'cost' ? 'cost' : 'var'),
      tenantId,
      jobId,
      description: clip(input.description, 200) || fallback,
      amountPence: requirePounds(input.amount, blank),
      mark,
      approved: kind === 'variation' ? Boolean(input.approved) : false,
      approval: isReviewMark(mark) || input.needsApproval ? 'pending' : 'none',
    }
    if (kind === 'cost') book.costs.push(row)
    else book.variations.push(row)
    writeBook(book)
    return staffView(book, tenantId)
  })
}

export function addCost(tenantId, jobId, input) {
  return addMoneyLine(tenantId, jobId, input, 'cost')
}

export function addVariation(tenantId, jobId, input) {
  return addMoneyLine(tenantId, jobId, input, 'variation')
}

export function createInvoice(tenantId, jobId, input) {
  return locked(() => {
    const book = readBook()
    const job = findJob(book, tenantId, jobId)
    const lines = linesFrom(input, job.contractSumPence)
    const totals = totalsFor(lines, job.vatTreatment)
    book.invoiceSeq += 1
    const now = new Date().toISOString()
    const inv = {
      id: nid('inv'),
      tenantId,
      jobId,
      number: `INV-${String(book.invoiceSeq).padStart(4, '0')}`,
      date: requireDate(input.date, londonToday()),
      status: 'draft',
      lines,
      ...totals,
      ...snapshotJob(job),
      createdAt: now,
      updatedAt: now,
      issuedAt: null,
    }
    book.invoices.push(inv)
    writeBook(book)
    return shapeInvoice(inv)
  })
}

export function updateInvoice(tenantId, id, input) {
  return locked(() => {
    const book = readBook()
    const inv = book.invoices.find((row) => row.id === id && sameTenant(row, tenantId))
    if (!inv) throw httpError(404, 'That invoice is not on the desk.')
    if (inv.status === 'issued') {
      throw httpError(409, 'This invoice is issued. Credit it to change the lines.')
    }
    const job = findJob(book, tenantId, inv.jobId)
    if ('date' in input) inv.date = requireDate(input.date, inv.date)
    if ('lines' in input) inv.lines = linesFrom(input, job.contractSumPence)
    const totals = totalsFor(inv.lines, job.vatTreatment)
    Object.assign(inv, totals, snapshotJob(job))
    inv.updatedAt = new Date().toISOString()
    writeBook(book)
    return shapeInvoice(inv)
  })
}

export function issueInvoice(tenantId, id) {
  return locked(() => {
    const book = readBook()
    const inv = book.invoices.find((row) => row.id === id && sameTenant(row, tenantId))
    if (!inv) throw httpError(404, 'That invoice is not on the desk.')
    if (inv.status !== 'issued') {
      const job = findJob(book, tenantId, inv.jobId)
      const totals = totalsFor(inv.lines, job.vatTreatment)
      Object.assign(inv, totals, snapshotJob(job))
      inv.status = 'issued'
      inv.issuedAt = new Date().toISOString()
      inv.updatedAt = inv.issuedAt
      writeBook(book)
    }
    return shapeInvoice(inv)
  })
}

export function addSupplierBill(tenantId, input) {
  return locked(() => {
    const book = readBook()
    const netPence = requirePounds(input.net, 'Enter a bill amount.')
    const vat = vatPence(netPence, 'standard')
    let jobId = ''
    if (input.jobId) {
      findJob(book, tenantId, String(input.jobId))
      jobId = String(input.jobId)
    }
    book.billSeq += 1
    const bill = {
      id: nid('bill'),
      tenantId,
      number: `BILL-${String(book.billSeq).padStart(4, '0')}`,
      supplier: requireText(input.supplier, 200, 'Enter the supplier name.'),
      date: requireDate(input.date, londonToday()),
      reference: clip(input.reference, 80),
      netPence,
      vatPence: vat,
      grossPence: netPence + vat,
      vatLabel: vatSpec('standard').label,
      jobId,
      mark: '',
      approval: 'none',
    }
    const mark = parseMark(input.mark)
    if (mark == null) throw httpError(400, 'Mark a review line Ryan, Ryan2 or Kacey, or leave it blank.')
    bill.mark = mark
    bill.approval = isReviewMark(mark) || input.needsApproval ? 'pending' : 'none'
    const supplier = upsertSupplier(book, tenantId, bill.supplier)
    bill.supplierId = supplier.id
    book.supplierBills.push(bill)
    writeBook(book)
    return shapeBill(bill, book)
  })
}

export function createWorker(tenantId, input) {
  return locked(() => {
    const book = readBook()
    rejectImage(input.note)
    const tax = parseTax(input.tax)
    if (!tax) throw httpError(400, 'Mark the worker CIS or PAYE.')
    let ticketExpiry = ''
    if (input.ticketExpiry != null && String(input.ticketExpiry).trim() !== '') {
      const iso = parseDate(input.ticketExpiry)
      if (!iso) throw httpError(400, 'Enter the ticket expiry as dd/mm/yyyy.')
      ticketExpiry = iso
    }
    const worker = {
      id: nid('worker'),
      tenantId,
      name: requireText(input.name, 200, 'Enter a worker name.'),
      trade: clip(input.trade, 80),
      phone: clip(input.phone, 40),
      tax,
      ticketExpiry,
      note: clip(input.note, 2000),
    }
    book.workers.push(worker)
    writeBook(book)
    return shapeWorker(worker, book)
  })
}

export function updateWorker(tenantId, id, input) {
  return locked(() => {
    const book = readBook()
    const worker = book.workers.find((w) => w.id === id && sameTenant(w, tenantId))
    if (!worker) throw httpError(404, 'That worker is not on the desk.')
    if ('name' in input) worker.name = requireText(input.name, 200, 'Enter a worker name.')
    if ('trade' in input) worker.trade = clip(input.trade, 80)
    if ('phone' in input) worker.phone = clip(input.phone, 40)
    if ('tax' in input) {
      const tax = parseTax(input.tax)
      if (!tax) throw httpError(400, 'Mark the worker CIS or PAYE.')
      worker.tax = tax
    }
    if ('ticketExpiry' in input) {
      if (String(input.ticketExpiry ?? '').trim() === '') worker.ticketExpiry = ''
      else {
        const iso = parseDate(input.ticketExpiry)
        if (!iso) throw httpError(400, 'Enter the ticket expiry as dd/mm/yyyy.')
        worker.ticketExpiry = iso
      }
    }
    if ('note' in input) {
      rejectImage(input.note)
      worker.note = clip(input.note, 2000)
    }
    writeBook(book)
    return shapeWorker(worker, book)
  })
}

export function assignWorker(tenantId, jobId, workerId) {
  return locked(() => {
    const book = readBook()
    findJob(book, tenantId, jobId)
    const worker = book.workers.find((w) => w.id === workerId && sameTenant(w, tenantId))
    if (!worker) throw httpError(404, 'That worker is not on the desk.')
    const exists = book.assignments.some(
      (a) => a.tenantId === tenantId && a.jobId === jobId && a.workerId === workerId,
    )
    if (!exists) book.assignments.push({ tenantId, jobId, workerId })
    writeBook(book)
    return staffView(book, tenantId)
  })
}

function optionalDate(value) {
  if (value == null || String(value).trim() === '') return ''
  const iso = parseDate(value)
  if (!iso) throw httpError(400, 'Enter the date as dd/mm/yyyy.')
  return iso
}

function parseQuoteStatus(value) {
  const s = String(value ?? '').trim().toLowerCase()
  switch (s) {
    case 'draft':
    case 'sent-draft':
    case 'accepted':
      return s
    default:
      return null
  }
}

function parseTenderStatus(value) {
  const s = String(value ?? '').trim().toLowerCase()
  switch (s) {
    case 'open':
    case 'submitted':
    case 'won':
    case 'lost':
      return s
    default:
      return null
  }
}

function shapeQuote(quote, book) {
  const job = book.jobs.find((j) => j.id === quote.jobId && j.tenantId === quote.tenantId)
  return {
    id: quote.id,
    number: quote.number,
    title: quote.title,
    client: quote.client,
    siteAddress: quote.siteAddress,
    description: quote.description,
    status: quote.status,
    date: quote.date,
    dateDisplay: formatUk(quote.date),
    net: formatPounds(quote.netPence),
    netPence: quote.netPence,
    vat: formatPounds(quote.vatPence),
    vatPence: quote.vatPence,
    gross: formatPounds(quote.grossPence),
    grossPence: quote.grossPence,
    vatLabel: quote.vatLabel,
    vatTreatment: quote.vatTreatment,
    jobId: quote.jobId || '',
    jobName: job ? job.name : '',
  }
}

function shapeTender(tender, book) {
  const quote = book.quotes.find((q) => q.id === tender.quoteId && q.tenantId === tender.tenantId)
  const job = book.jobs.find((j) => j.id === tender.jobId && j.tenantId === tender.tenantId)
  return {
    id: tender.id,
    title: tender.title,
    client: tender.client,
    status: tender.status,
    dueDate: tender.dueDate || '',
    dueDateDisplay: formatUk(tender.dueDate),
    note: tender.note || '',
    quoteId: tender.quoteId || '',
    quoteNumber: quote ? quote.number : '',
    jobId: tender.jobId || '',
    jobName: job ? job.name : '',
  }
}

function shapeMail(thread, book) {
  const received = thread.received || thread.at || ''
  const job = book?.jobs?.find((row) => row.id === thread.jobId && row.tenantId === thread.tenantId)
  return {
    id: thread.id,
    subject: thread.subject,
    from: thread.from,
    body: thread.body,
    at: thread.at,
    atDisplay: formatUk(String(thread.at || '').slice(0, 10)),
    received,
    receivedDisplay: formatUk(String(received).slice(0, 10)),
    read: Boolean(thread.read),
    jobId: thread.jobId || '',
    jobName: job ? job.name : '',
    source: thread.graphId ? 'mailbox' : 'log',
    replies: (thread.replies || []).map((reply) => ({
      id: reply.id,
      text: reply.text,
      at: reply.at,
      status: 'draft',
      notSent: true,
    })),
  }
}

function shapeHour(row, book) {
  const worker = book.workers.find((w) => w.id === row.workerId && w.tenantId === row.tenantId)
  const job = book.jobs.find((j) => j.id === row.jobId && j.tenantId === row.tenantId)
  const hours = (row.minutes / 60).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
  return {
    id: row.id,
    jobId: row.jobId,
    jobName: job ? job.name : '',
    workerId: row.workerId,
    workerName: worker ? worker.name : '',
    date: row.date,
    dateDisplay: formatUk(row.date),
    hours,
    minutes: row.minutes,
    note: row.note || '',
  }
}

function shapeSiteNote(note, book) {
  const job = book.jobs.find((j) => j.id === note.jobId && j.tenantId === note.tenantId)
  return {
    id: note.id,
    jobId: note.jobId,
    jobName: job ? job.name : '',
    text: note.text,
    author: note.author || '',
    at: note.at,
    atDisplay: formatUk(String(note.at || '').slice(0, 10)),
  }
}

function shapeFile(file, book) {
  const job = book.jobs.find((j) => j.id === file.jobId && j.tenantId === file.tenantId)
  return {
    id: file.id,
    jobId: file.jobId,
    jobName: job ? job.name : '',
    name: file.name,
    note: file.note || '',
    type: file.type || 'application/octet-stream',
    bytes: file.bytes || 0,
    addedAt: file.addedAt,
  }
}

function quoteTotals(netPence, treatment) {
  const vat = vatPence(netPence, treatment)
  const spec = vatSpec(treatment)
  return {
    netPence,
    vatPence: vat,
    grossPence: netPence + vat,
    vatLabel: spec.label,
    vatTreatment: treatment,
  }
}

function quoteDraftText(quote) {
  const company = companyProfile()
  return [
    'QUOTE DRAFT',
    company.name,
    company.number ? `Company number ${company.number}` : '',
    company.address,
    quote.number,
    formatUk(quote.date),
    quote.title,
    quote.client,
    quote.siteAddress,
    quote.description,
    `Net ${formatPounds(quote.netPence)}`,
    `${quote.vatLabel} ${formatPounds(quote.vatPence)}`,
    `Gross ${formatPounds(quote.grossPence)}`,
    'not sent',
  ].filter(Boolean).join('\n')
}

function findQuote(book, tenantId, id) {
  const quote = book.quotes.find((row) => row.id === id && sameTenant(row, tenantId))
  if (!quote) throw httpError(404, 'That quote is not on the desk.')
  return quote
}

export function createQuote(tenantId, input) {
  return locked(() => {
    const book = readBook()
    const treatment = input.vatTreatment == null || String(input.vatTreatment).trim() === ''
      ? 'standard'
      : parseVatTreatment(input.vatTreatment)
    if (!treatment) throw httpError(400, 'VAT must be 20%, zero-rate, or reverse charge.')
    const netPence = requirePounds(input.net, 'Enter the quote net.')
    book.quoteSeq += 1
    const now = new Date().toISOString()
    const quote = {
      id: nid('quote'),
      tenantId,
      number: `Q-${String(book.quoteSeq).padStart(4, '0')}`,
      title: requireText(input.title, 200, 'Enter a quote title.'),
      client: requireText(input.client, 200, 'Enter the client.'),
      siteAddress: requireText(input.siteAddress, 300, 'Enter the site address.'),
      description: clip(input.description, 2000) || 'Works',
      date: requireDate(input.date, londonToday()),
      status: 'draft',
      jobId: '',
      ...quoteTotals(netPence, treatment),
      createdAt: now,
      updatedAt: now,
    }
    book.quotes.push(quote)
    writeBook(book)
    return shapeQuote(quote, book)
  })
}

export function updateQuote(tenantId, id, input) {
  return locked(() => {
    const book = readBook()
    const quote = findQuote(book, tenantId, id)
    if (quote.status === 'accepted') {
      throw httpError(409, 'This quote is accepted. Open the job to change the work.')
    }
    if ('title' in input) quote.title = requireText(input.title, 200, 'Enter a quote title.')
    if ('client' in input) quote.client = requireText(input.client, 200, 'Enter the client.')
    if ('siteAddress' in input) quote.siteAddress = requireText(input.siteAddress, 300, 'Enter the site address.')
    if ('description' in input) quote.description = clip(input.description, 2000) || 'Works'
    if ('date' in input) quote.date = requireDate(input.date, quote.date)
    if ('net' in input) {
      const treatment = quote.vatTreatment
      Object.assign(quote, quoteTotals(requirePounds(input.net, 'Enter the quote net.'), treatment))
    }
    if ('vatTreatment' in input) {
      const treatment = parseVatTreatment(input.vatTreatment)
      if (!treatment) throw httpError(400, 'VAT must be 20%, zero-rate, or reverse charge.')
      Object.assign(quote, quoteTotals(quote.netPence, treatment))
    }
    quote.updatedAt = new Date().toISOString()
    writeBook(book)
    return shapeQuote(quote, book)
  })
}

export function draftQuote(tenantId, id) {
  return locked(() => {
    const book = readBook()
    const quote = findQuote(book, tenantId, id)
    if (quote.status === 'draft') quote.status = 'sent-draft'
    quote.updatedAt = new Date().toISOString()
    writeBook(book)
    return { quote: shapeQuote(quote, book), draft: quoteDraftText(quote), notSent: true }
  })
}

export function acceptQuote(tenantId, id) {
  return locked(() => {
    const book = readBook()
    const quote = findQuote(book, tenantId, id)
    if (quote.jobId) {
      const existing = book.jobs.find((j) => j.id === quote.jobId && sameTenant(j, tenantId))
      if (existing) return { quote: shapeQuote(quote, book), job: shapeJob(existing, book) }
    }
    const now = new Date().toISOString()
    const job = {
      id: nid('job'),
      tenantId,
      name: quote.title,
      client: quote.client,
      siteAddress: quote.siteAddress,
      status: 'quoted',
      contractSumPence: quote.netPence,
      vatTreatment: quote.vatTreatment,
      notes: quote.description === 'Works' ? '' : quote.description,
      startDate: '',
      quoteId: quote.id,
      createdAt: now,
      updatedAt: now,
    }
    book.jobs.push(job)
    quote.status = 'accepted'
    quote.jobId = job.id
    quote.updatedAt = now
    writeBook(book)
    return { quote: shapeQuote(quote, book), job: shapeJob(job, book) }
  })
}

export function createTender(tenantId, input) {
  return locked(() => {
    const book = readBook()
    const status = input.status == null || String(input.status).trim() === ''
      ? 'open'
      : parseTenderStatus(input.status)
    if (!status) throw httpError(400, 'Status must be open, submitted, won or lost.')
    const tender = linkTender(book, tenantId, {
      id: nid('tender'),
      tenantId,
      title: requireText(input.title, 200, 'Enter a tender title.'),
      client: requireText(input.client, 200, 'Enter the client.'),
      status,
      dueDate: optionalDate(input.dueDate),
      note: clip(input.note, 2000),
      quoteId: '',
      jobId: '',
    }, input)
    book.tenders.push(tender)
    writeBook(book)
    return shapeTender(tender, book)
  })
}

function linkTender(book, tenantId, tender, input) {
  if ('quoteId' in input) {
    const quoteId = clip(input.quoteId, 80)
    if (quoteId) findQuote(book, tenantId, quoteId)
    tender.quoteId = quoteId
  }
  if ('jobId' in input) {
    const jobId = clip(input.jobId, 80)
    if (jobId) findJob(book, tenantId, jobId)
    tender.jobId = jobId
  }
  return tender
}

export function updateTender(tenantId, id, input) {
  return locked(() => {
    const book = readBook()
    const tender = book.tenders.find((row) => row.id === id && sameTenant(row, tenantId))
    if (!tender) throw httpError(404, 'That tender is not on the desk.')
    if ('title' in input) tender.title = requireText(input.title, 200, 'Enter a tender title.')
    if ('client' in input) tender.client = requireText(input.client, 200, 'Enter the client.')
    if ('status' in input) {
      const status = parseTenderStatus(input.status)
      if (!status) throw httpError(400, 'Status must be open, submitted, won or lost.')
      tender.status = status
    }
    if ('dueDate' in input) tender.dueDate = optionalDate(input.dueDate)
    if ('note' in input) tender.note = clip(input.note, 2000)
    linkTender(book, tenantId, tender, input)
    if (tender.status === 'won') jobFromTender(book, tenantId, tender)
    writeBook(book)
    return shapeTender(tender, book)
  })
}

function jobFromTender(book, tenantId, tender) {
  if (tender.jobId) {
    const existing = book.jobs.find((row) => row.id === tender.jobId && sameTenant(row, tenantId))
    if (existing) return existing
  }
  const quote = tender.quoteId
    ? book.quotes.find((row) => row.id === tender.quoteId && sameTenant(row, tenantId))
    : null
  const now = new Date().toISOString()
  const job = {
    id: nid('job'),
    tenantId,
    name: tender.title,
    client: tender.client,
    siteAddress: quote?.siteAddress || 'Site to confirm',
    status: 'quoted',
    contractSumPence: quote?.netPence || 0,
    vatTreatment: quote?.vatTreatment || 'standard',
    notes: tender.note || '',
    startDate: '',
    quoteId: quote?.id || '',
    createdAt: now,
    updatedAt: now,
  }
  book.jobs.push(job)
  tender.status = 'won'
  tender.jobId = job.id
  return job
}

export function winTender(tenantId, id) {
  return locked(() => {
    const book = readBook()
    const tender = book.tenders.find((row) => row.id === id && sameTenant(row, tenantId))
    if (!tender) throw httpError(404, 'That tender is not on the desk.')
    tender.status = 'won'
    const job = jobFromTender(book, tenantId, tender)
    writeBook(book)
    return { tender: shapeTender(tender, book), job: shapeJob(job, book) }
  })
}

export function createMail(tenantId, input) {
  return locked(() => {
    const book = readBook()
    let jobId = ''
    if (input.jobId) {
      findJob(book, tenantId, String(input.jobId))
      jobId = String(input.jobId)
    }
    const thread = {
      id: nid('mail'),
      tenantId,
      subject: requireText(input.subject, 200, 'Enter a subject.'),
      from: requireText(input.from, 200, 'Enter who it is from.'),
      body: requireText(input.body, 8000, 'Enter the message.'),
      at: new Date().toISOString(),
      read: false,
      jobId,
      replies: [],
    }
    book.mail.push(thread)
    writeBook(book)
    return shapeMail(thread, book)
  })
}

export function markMail(tenantId, id, read) {
  return locked(async () => {
    const book = readBook()
    const thread = book.mail.find((row) => row.id === id && sameTenant(row, tenantId))
    if (!thread) throw httpError(404, 'That message is not on the desk.')
    thread.read = Boolean(read)
    writeBook(book)
    if (thread.graphId) await markMailboxRead(thread.graphId, Boolean(read))
    return shapeMail(thread, book)
  })
}

export function draftMailReply(tenantId, id, text) {
  return locked(() => {
    const book = readBook()
    const thread = book.mail.find((row) => row.id === id && sameTenant(row, tenantId))
    if (!thread) throw httpError(404, 'That message is not on the desk.')
    const replyText = requireText(text, 8000, 'Enter the reply.')
    const reply = {
      id: nid('reply'),
      text: replyText,
      at: new Date().toISOString(),
      status: 'draft',
    }
    thread.replies.push(reply)
    writeBook(book)
    return { thread: shapeMail(thread, book), draft: replyText, notSent: true }
  })
}

function approvalTarget(book, tenantId, kind, id) {
  switch (kind) {
    case 'cost':
      return book.costs.find((row) => row.id === id && sameTenant(row, tenantId))
    case 'variation':
      return book.variations.find((row) => row.id === id && sameTenant(row, tenantId))
    case 'bill':
      return book.supplierBills.find((row) => row.id === id && sameTenant(row, tenantId))
    default: {
      const unknown = kind
      throw httpError(400, `Approval kind is not recognised: ${String(unknown)}`)
    }
  }
}

export function approveIntoReview(tenantId, kind, id) {
  return locked(() => {
    const book = readBook()
    const row = approvalTarget(book, tenantId, kind, id)
    if (!row) throw httpError(404, 'That line is not on the desk.')
    const approval = approvalOf(row)
    if (approval === 'none') throw httpError(400, 'That line is not waiting for approval.')
    if (approval === 'pending') row.approval = 'in-review'
    writeBook(book)
    return staffView(book, tenantId)
  })
}

function parseMinutes(value) {
  const raw = String(value ?? '').trim()
  if (!raw) throw httpError(400, 'Enter the hours.')
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) throw httpError(400, 'Enter the hours as a number.')
  const minutes = Math.round(Number(raw) * 60)
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 24 * 60) {
    throw httpError(400, 'Enter the hours, up to 24.')
  }
  return minutes
}

export function addHours(tenantId, jobId, input) {
  return locked(() => {
    const book = readBook()
    findJob(book, tenantId, jobId)
    const worker = book.workers.find((w) => w.id === String(input.workerId || '') && sameTenant(w, tenantId))
    if (!worker) throw httpError(400, 'Choose a worker.')
    const row = {
      id: nid('hour'),
      tenantId,
      jobId,
      workerId: worker.id,
      date: requireDate(input.date, londonToday()),
      minutes: parseMinutes(input.hours),
      note: clip(input.note, 500),
    }
    book.hours.push(row)
    writeBook(book)
    return shapeHour(row, book)
  })
}

export function addSiteNote(tenantId, jobId, input) {
  return locked(() => {
    const book = readBook()
    findJob(book, tenantId, jobId)
    const note = {
      id: nid('note'),
      tenantId,
      jobId,
      text: requireText(input.text, 4000, 'Enter the site note.'),
      author: clip(input.author, 120),
      at: new Date().toISOString(),
    }
    book.siteNotes.push(note)
    writeBook(book)
    return shapeSiteNote(note, book)
  })
}

const FILE_TYPES = new Map([
  ['pdf', 'application/pdf'],
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['webp', 'image/webp'],
  ['txt', 'text/plain'],
  ['csv', 'text/csv'],
])

export function addJobFile(tenantId, jobId, input) {
  return locked(() => {
    const book = readBook()
    findJob(book, tenantId, jobId)
    const name = requireText(input.name, 180, 'Enter a file name.')
    if (/passport/i.test(name)) throw httpError(400, 'Do not store passport images.')
    const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : ''
    const type = FILE_TYPES.get(ext)
    if (!type) throw httpError(400, 'Use a pdf, photo, txt, or csv.')
    let buf
    try {
      buf = Buffer.from(String(input.dataBase64 || ''), 'base64')
    } catch {
      throw httpError(400, 'Choose a document.')
    }
    if (!buf.length) throw httpError(400, 'Choose a document.')
    if (buf.length > 1_500_000) throw httpError(400, 'That document is over 1.5 MB.')
    const id = nid('file')
    const storedName = `${id}.bin`
    mkdirSync(filesDir(), { recursive: true })
    writeFileSync(join(filesDir(), storedName), buf)
    const file = {
      id,
      tenantId,
      jobId,
      name: basename(name),
      note: clip(input.note, 500),
      type,
      bytes: buf.length,
      storedName,
      addedAt: new Date().toISOString(),
    }
    book.files.push(file)
    writeBook(book)
    return shapeFile(file, book)
  })
}

export function readJobFile(tenantId, id) {
  return locked(() => {
    const book = readBook()
    const file = book.files.find((row) => row.id === id && sameTenant(row, tenantId))
    if (!file) throw httpError(404, 'That file is not on the desk.')
    const stored = basename(String(file.storedName || ''))
    if (!stored || stored !== file.storedName) throw httpError(404, 'That file is not on the desk.')
    const full = join(filesDir(), stored)
    if (!existsSync(full)) throw httpError(404, 'That file is not on the desk.')
    return { name: file.name, type: file.type || 'application/octet-stream', buf: readFileSync(full) }
  })
}

function parseQtyHundredths(value, blankSentence, allowZero) {
  const text = String(value ?? '').trim()
  if (!text) throw httpError(400, blankSentence)
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw httpError(400, 'Enter the quantity as a number.')
  const hundredths = Math.round(Number(text) * 100)
  if (!Number.isSafeInteger(hundredths) || hundredths < 0) throw httpError(400, 'Enter the quantity as a number.')
  if (!allowZero && hundredths === 0) throw httpError(400, 'Enter a quantity greater than zero.')
  return hundredths
}

function formatQty(hundredths) {
  const n = Number(hundredths) || 0
  const text = (n / 100).toFixed(2)
  return text.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
}

function lineNetPence(line) {
  return Math.round((line.pricePence * line.qtyHundredths) / 100)
}

function shapeMaterial(row) {
  return {
    id: row.id,
    name: row.name,
    unit: row.unit,
    price: formatPounds(row.pricePence),
    pricePence: row.pricePence,
    qty: formatQty(row.qtyHundredths),
    qtyHundredths: row.qtyHundredths,
  }
}

function shapePurchaseOrder(po, book) {
  const job = book.jobs.find((row) => row.id === po.jobId)
  const lines = (po.lines || []).map((line) => {
    const netPence = lineNetPence(line)
    return {
      materialId: line.materialId || '',
      name: line.name,
      unit: line.unit,
      qty: formatQty(line.qtyHundredths),
      qtyHundredths: line.qtyHundredths,
      price: formatPounds(line.pricePence),
      pricePence: line.pricePence,
      net: formatPounds(netPence),
      netPence,
    }
  })
  return {
    id: po.id,
    number: po.number,
    supplier: po.supplier,
    supplierId: po.supplierId || '',
    jobId: po.jobId || '',
    jobName: job && job.tenantId === po.tenantId ? job.name : '',
    date: po.date,
    dateDisplay: formatUk(po.date),
    lines,
    net: formatPounds(po.netPence),
    netPence: po.netPence,
  }
}

function supplierOwnsBill(supplier, bill) {
  if (!bill || bill.tenantId !== supplier.tenantId) return false
  if (bill.supplierId && bill.supplierId === supplier.id) return true
  return String(bill.supplier || '').trim().toLowerCase() === String(supplier.name || '').trim().toLowerCase()
}

function supplierOwnsOrder(supplier, po) {
  if (!po || po.tenantId !== supplier.tenantId) return false
  if (po.supplierId && po.supplierId === supplier.id) return true
  return String(po.supplier || '').trim().toLowerCase() === String(supplier.name || '').trim().toLowerCase()
}

function shapeSupplier(row, book) {
  const bills = book.supplierBills.filter((bill) => supplierOwnsBill(row, bill)).map((bill) => shapeBill(bill, book))
  const purchaseOrders = book.purchaseOrders
    .filter((po) => supplierOwnsOrder(row, po))
    .map((po) => shapePurchaseOrder(po, book))
  return {
    id: row.id,
    name: row.name,
    phone: row.phone || '',
    bills,
    purchaseOrders,
  }
}

function suppliersFor(book, tenantId) {
  const rows = book.suppliers.filter((row) => sameTenant(row, tenantId)).map((row) => ({ ...row }))
  for (const bill of book.supplierBills.filter((row) => sameTenant(row, tenantId))) {
    const name = String(bill.supplier || '').trim()
    if (!name) continue
    const found = rows.find((row) => row.name.trim().toLowerCase() === name.toLowerCase())
      if (!found) {
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'supplier'
        rows.push({ id: `from-bill-${slug}`, tenantId, name, phone: '' })
      }
  }
  return rows.map((row) => shapeSupplier(row, book))
}

function upsertSupplier(book, tenantId, name, phone) {
  const wanted = String(name || '').trim().toLowerCase()
  let row = book.suppliers.find((item) => item.tenantId === tenantId && item.name.trim().toLowerCase() === wanted)
  if (!row) {
    row = {
      id: nid('sup'),
      tenantId,
      name: String(name || '').trim(),
      phone: clip(phone, 40),
    }
    book.suppliers.push(row)
  } else if (phone != null && String(phone).trim() !== '') {
    row.phone = clip(phone, 40)
  }
  return row
}

function shapeCredit(note) {
  return {
    id: note.id,
    invoiceId: note.invoiceId,
    jobId: note.jobId,
    invoiceNumber: note.invoiceNumber,
    number: note.number,
    date: note.date,
    dateDisplay: formatUk(note.date),
    status: note.status,
    lines: (note.lines || []).map((line) => ({
      description: line.description,
      net: formatPounds(line.netPence),
      netPence: line.netPence,
    })),
    net: formatPounds(note.netPence),
    netPence: note.netPence,
    vat: formatPounds(note.vatPence),
    vatPence: note.vatPence,
    gross: formatPounds(note.grossPence),
    grossPence: note.grossPence,
    vatLabel: note.vatLabel,
    vatTreatment: note.vatTreatment,
    jobName: note.jobName,
    clientName: note.clientName,
    siteAddress: note.siteAddress,
  }
}

export function createMaterial(tenantId, input) {
  return locked(() => {
    const book = readBook()
    const qtySource = input.qty == null || String(input.qty).trim() === '' ? '0' : input.qty
    const material = {
      id: nid('mat'),
      tenantId,
      name: requireText(input.name, 200, 'Enter a material name.'),
      unit: clip(input.unit, 40) || 'each',
      pricePence: requirePounds(input.price, 'Enter the catalogue price.'),
      qtyHundredths: parseQtyHundredths(qtySource, 'Enter the stock quantity.', true),
    }
    book.materials.push(material)
    writeBook(book)
    return shapeMaterial(material)
  })
}

export function updateMaterial(tenantId, id, input) {
  return locked(() => {
    const book = readBook()
    const material = book.materials.find((row) => row.id === id && sameTenant(row, tenantId))
    if (!material) throw httpError(404, 'That material is not on the desk.')
    if ('name' in input) material.name = requireText(input.name, 200, 'Enter a material name.')
    if ('unit' in input) material.unit = clip(input.unit, 40) || 'each'
    if ('price' in input) material.pricePence = requirePounds(input.price, 'Enter the catalogue price.')
    if ('qty' in input) {
      const qtySource = input.qty == null || String(input.qty).trim() === '' ? '0' : input.qty
      material.qtyHundredths = parseQtyHundredths(qtySource, 'Enter the stock quantity.', true)
    }
    writeBook(book)
    return shapeMaterial(material)
  })
}

export function createPurchaseOrder(tenantId, input) {
  return locked(() => {
    const book = readBook()
    const supplierName = requireText(input.supplier, 200, 'Enter the supplier name.')
    if (!input.jobId) throw httpError(400, 'Choose a job for the purchase order.')
    findJob(book, tenantId, String(input.jobId))
    const rawLines = Array.isArray(input.lines) && input.lines.length
      ? input.lines
      : [{ materialId: input.materialId, qty: input.qty }]
    const lines = rawLines.map((line) => {
      const material = book.materials.find((row) => row.id === String(line.materialId || '') && sameTenant(row, tenantId))
      if (!material) throw httpError(400, 'Choose a material from the catalogue.')
      const qtyHundredths = parseQtyHundredths(line.qty, 'Enter the order quantity.', false)
      return {
        materialId: material.id,
        name: material.name,
        unit: material.unit,
        qtyHundredths,
        pricePence: material.pricePence,
      }
    })
    const supplier = upsertSupplier(book, tenantId, supplierName)
    book.poSeq += 1
    const po = {
      id: nid('po'),
      tenantId,
      number: `PO-${String(book.poSeq).padStart(4, '0')}`,
      supplier: supplier.name,
      supplierId: supplier.id,
      jobId: String(input.jobId),
      date: londonToday(),
      lines,
      netPence: lines.reduce((sum, line) => sum + lineNetPence(line), 0),
    }
    book.purchaseOrders.push(po)
    writeBook(book)
    return shapePurchaseOrder(po, book)
  })
}

export function createSupplier(tenantId, input) {
  return locked(() => {
    const book = readBook()
    const row = upsertSupplier(
      book,
      tenantId,
      requireText(input.name, 200, 'Enter the supplier name.'),
      input.phone,
    )
    writeBook(book)
    return shapeSupplier(row, book)
  })
}

export function createCreditNote(tenantId, invoiceId) {
  return locked(() => {
    const book = readBook()
    const inv = book.invoices.find((row) => row.id === invoiceId && sameTenant(row, tenantId))
    if (!inv) throw httpError(404, 'That invoice is not on the desk.')
    if (inv.status !== 'issued') throw httpError(400, 'Issue the invoice before a credit note.')
    const existing = book.creditNotes.find((row) => row.invoiceId === inv.id && sameTenant(row, tenantId))
    if (existing) return shapeCredit(existing)
    book.creditSeq += 1
    const note = {
      id: nid('cn'),
      tenantId,
      invoiceId: inv.id,
      jobId: inv.jobId,
      invoiceNumber: inv.number,
      number: `CN-${String(book.creditSeq).padStart(4, '0')}`,
      date: londonToday(),
      status: 'issued',
      lines: (inv.lines || []).map((line) => ({ description: line.description, netPence: line.netPence })),
      netPence: inv.netPence,
      vatPence: inv.vatPence,
      grossPence: inv.grossPence,
      vatLabel: inv.vatLabel,
      vatTreatment: inv.vatTreatment,
      jobName: inv.jobName,
      clientName: inv.clientName,
      siteAddress: inv.siteAddress,
    }
    book.creditNotes.push(note)
    writeBook(book)
    return shapeCredit(note)
  })
}

export function clientView(tenantId, clientName) {
  return locked(() => {
    const name = clip(clientName, 200)
    if (!name) throw httpError(400, 'Enter a client name.')
    const book = readBook()
    const wanted = name.toLowerCase()
    const jobs = book.jobs.filter(
      (j) => sameTenant(j, tenantId) && j.client.trim().toLowerCase() === wanted,
    )
    const jobIds = new Set(jobs.map((j) => j.id))
    const company = companyProfile()
    const invoices = book.invoices
      .filter((inv) => sameTenant(inv, tenantId) && jobIds.has(inv.jobId) && inv.status === 'issued')
      .map((inv) => ({
        id: inv.id,
        number: inv.number,
        dateDisplay: formatUk(inv.date),
        jobName: inv.jobName,
        net: formatPounds(inv.netPence),
        vat: formatPounds(inv.vatPence),
        gross: formatPounds(inv.grossPence),
        vatLabel: inv.vatLabel,
        companyName: company.name,
      }))
    return {
      staffPreview: true,
      client: jobs[0]?.client || name,
      jobs: jobs.map((j) => ({
        id: j.id,
        name: j.name,
        status: assertStatus(j.status),
        siteAddress: j.siteAddress,
      })),
      invoices,
    }
  })
}
