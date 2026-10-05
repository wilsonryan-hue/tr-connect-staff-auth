#!/usr/bin/env node
/**
 * Materials, credit notes, the live-jobs report, and suppliers.
 * A purchase order and a credit note must not move the live margin.
 * A second read on the same process still has the rows.
 */
import { spawn } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const store = await import(pathToFileURL(join(ROOT, 'src/store.js')).href)

const PASSWORD = 'ProveComplete-only!'
const EMAIL = 'complete-desk@treunroc.com'
const PORT = Number(process.env.PROVE_COMPLETE_PORT || 18792)
const BASE = `http://127.0.0.1:${PORT}`
const tmp = mkdtempSync(join(tmpdir(), 'tr-complete-'))
const usersFile = join(tmp, 'users.json')

let passed = 0
let failed = 0
function pass(msg) {
  passed += 1
  console.log(`PASS: ${msg}`)
}
function fail(msg) {
  failed += 1
  console.log(`FAIL: ${msg}`)
}
function assert(cond, msg) {
  if (cond) pass(msg)
  else fail(msg)
}

const { salt, hash } = store.hashPassword(PASSWORD)
writeFileSync(usersFile, JSON.stringify({
  users: [{ email: EMAIL, name: 'Complete Desk', role: 'OFFICE', tenantId: 'treunroc', salt, hash }],
}, null, 2))

const child = spawn(process.execPath, [join(ROOT, 'src/server.js')], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    HOST: '127.0.0.1',
    STAFF_AUTH_USERS: usersFile,
    DATA_DIR: tmp,
    SESSIONS_PATH: join(tmp, 'sessions.json'),
    DESK_STORE_PATH: join(tmp, 'desk.json'),
    TR_BOT_THREADS_PATH: join(tmp, 'tr-bot-threads.json'),
    CORS_ORIGIN: '*',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let log = ''
child.stdout.on('data', (d) => { log += d })
child.stderr.on('data', (d) => { log += d })
let fixtureChild = null

async function cleanup() {
  if (!child.killed) child.kill('SIGTERM')
  if (fixtureChild && !fixtureChild.killed) fixtureChild.kill('SIGTERM')
}
process.on('exit', () => { if (!child.killed) child.kill('SIGKILL') })

async function fetchJson(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, opts)
  const text = await res.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  return { res, body, text }
}

function auth(token, extra = {}) {
  return {
    ...extra,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...(extra.headers || {}),
    },
  }
}

try {
  let up = false
  for (let i = 0; i < 40 && !up; i += 1) {
    try {
      const { res } = await fetchJson('/health')
      up = res.status === 200
    } catch { /* retry */ }
    if (!up) await sleep(100)
  }
  assert(up, 'health')
  if (!up) throw new Error(log.slice(0, 400))

  const closed = await fetchJson('/api/materials', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  assert(closed.res.status === 401, 'materials stay behind sign-in')
  const closedPo = await fetchJson('/api/purchase-orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  assert(closedPo.res.status === 401, 'purchase orders stay behind sign-in')
  const closedSup = await fetchJson('/api/suppliers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  assert(closedSup.res.status === 401, 'suppliers stay behind sign-in')

  const login = await fetchJson('/api/staff-auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  const token = login.body?.token
  assert(login.res.status === 200 && token, 'staff login')

  const job = await fetchJson('/api/jobs', auth(token, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Hexham fit-out',
      client: 'Weird Fish',
      siteAddress: 'Hexham town centre',
      status: 'live',
      contractSum: '100000',
    }),
  }))
  const jobId = job.body.job.id
  const quoted = await fetchJson('/api/jobs', auth(token, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Quoted shed',
      client: 'Shed Co',
      siteAddress: 'Yard',
      status: 'quoted',
      contractSum: '5000',
    }),
  }))
  assert(quoted.body.job.status === 'quoted', 'a quoted job is stored')

  const material = await fetchJson('/api/materials', auth(token, {
    method: 'POST',
    body: JSON.stringify({ name: 'Softwood', unit: 'm', price: '12.50', qty: '40' }),
  }))
  const materialId = material.body.material.id
  assert(
    material.res.status === 200
      && material.body.material.name === 'Softwood'
      && material.body.material.pricePence === 1250
      && material.body.material.qty === '40'
      && material.body.material.unit === 'm',
    'catalogue stores name, unit, price pence, and qty',
  )
  const kept = await fetchJson('/api/desk', auth(token))
  const keptMat = kept.body.materials.find((row) => row.id === materialId)
  assert(keptMat && keptMat.pricePence === 1250 && keptMat.qty === '40', 'material survives a second read')

  const order = await fetchJson('/api/purchase-orders', auth(token, {
    method: 'POST',
    body: JSON.stringify({ supplier: 'North timber', jobId, materialId, qty: '2' }),
  }))
  assert(
    order.res.status === 200
      && order.body.purchaseOrder.number === 'PO-0001'
      && order.body.purchaseOrder.jobId === jobId
      && order.body.purchaseOrder.netPence === 2500,
    'purchase order links the job and prices the line',
  )
  const afterPo = await fetchJson('/api/desk', auth(token))
  const liveAfterPo = afterPo.body.jobs.find((row) => row.id === jobId)
  const stock = afterPo.body.materials.find((row) => row.id === materialId)
  assert(liveAfterPo.money.marginPence === 10000000, 'a purchase order does not change the live margin')
  assert(stock.qtyHundredths === 4000, 'a purchase order does not change the stock quantity')
  assert(afterPo.body.purchaseOrders.some((row) => row.number === 'PO-0001' && row.jobName === 'Hexham fit-out'), 'purchase order survives a second read')

  const supplier = await fetchJson('/api/suppliers', auth(token, {
    method: 'POST',
    body: JSON.stringify({ name: 'Jewson', phone: '01923 000000' }),
  }))
  assert(supplier.res.status === 200 && supplier.body.supplier.name === 'Jewson', 'supplier can be added with no bill yet')
  const bill = await fetchJson('/api/supplier-bills', auth(token, {
    method: 'POST',
    body: JSON.stringify({ supplier: 'Jewson', net: '80', reference: 'J-22' }),
  }))
  assert(bill.res.status === 200 && bill.body.bill.supplier === 'Jewson', 'bill saves against the supplier name')
  const onlyBill = await fetchJson('/api/supplier-bills', auth(token, {
    method: 'POST',
    body: JSON.stringify({ supplier: 'Buildbase', net: '15' }),
  }))
  assert(onlyBill.res.status === 200, 'a bill creates a supplier when none was added first')
  const book = await fetchJson('/api/desk', auth(token))
  const jewson = book.body.suppliers.find((row) => row.name === 'Jewson')
  const buildbase = book.body.suppliers.find((row) => row.name === 'Buildbase')
  const north = book.body.suppliers.find((row) => row.name === 'North timber')
  assert(jewson && jewson.bills.some((row) => row.gross === '£96.00'), 'supplier lists its own bill')
  assert(buildbase && buildbase.bills.length === 1, 'bill-only supplier is on the suppliers list')
  assert(north && north.name === 'North timber', 'purchase order supplier is on the suppliers list')
  assert(!book.body.invoices.some((row) => row.jobName === 'Jewson'), 'supplier bills are not client invoices')

  const draftInv = await fetchJson(`/api/jobs/${jobId}/invoices`, auth(token, { method: 'POST', body: '{}' }))
  const early = await fetchJson(`/api/invoices/${draftInv.body.invoice.id}/credit`, auth(token, { method: 'POST', body: '{}' }))
  assert(early.res.status === 400 && early.body.error === 'Issue the invoice before a credit note.', 'a draft invoice is not credited')
  const issued = await fetchJson(`/api/invoices/${draftInv.body.invoice.id}/issue`, auth(token, { method: 'POST', body: '{}' }))
  const beforeGross = issued.body.invoice.grossPence
  const beforeNet = issued.body.invoice.netPence
  const credit = await fetchJson(`/api/invoices/${draftInv.body.invoice.id}/credit`, auth(token, { method: 'POST', body: '{}' }))
  const note = credit.body.creditNote
  assert(
    credit.res.status === 200
      && note.number === 'CN-0001'
      && note.jobName === 'Hexham fit-out'
      && note.lines.length > 0
      && note.netPence === beforeNet
      && note.vatPence === issued.body.invoice.vatPence
      && note.grossPence === beforeGross
      && note.date,
    'credit note CN-0001 copies date, job, lines, net, VAT, and gross',
  )
  assert(!String(credit.text).includes('Credit refused'), 'credit does not refuse the note')
  const second = await fetchJson(`/api/invoices/${draftInv.body.invoice.id}/credit`, auth(token, { method: 'POST', body: '{}' }))
  assert(second.body.creditNote.id === note.id && second.body.creditNote.number === 'CN-0001', 'a second credit opens the same note')
  const after = await fetchJson('/api/desk', auth(token))
  const locked = after.body.invoices.find((row) => row.id === draftInv.body.invoice.id)
  const live = after.body.jobs.find((row) => row.id === jobId)
  const reportJobs = after.body.jobs.filter((row) => row.status === 'live')
  const reportMargin = reportJobs.reduce((sum, row) => sum + row.money.marginPence, 0)
  assert(locked.status === 'issued' && locked.grossPence === beforeGross && locked.netPence === beforeNet, 'issued invoice totals stay locked')
  assert(live.money.marginPence === 10000000 && reportMargin === live.money.marginPence, 'report total matches the live job and ignores the credit note')
  assert(!reportJobs.some((row) => row.name === 'Quoted shed'), 'report source is live jobs only')
  assert(after.body.creditNotes.some((row) => row.number === 'CN-0001'), 'credit note survives a second read')
  assert(after.body.materials.some((row) => row.name === 'Softwood'), 'material is still there after the credit note')

  const northAfter = after.body.suppliers.find((row) => row.name === 'North timber')
  assert(
    northAfter
      && northAfter.id
      && northAfter.purchaseOrders.some((row) => row.number === 'PO-0001' && row.jobId === jobId),
    'supplier keeps the purchase order on its own record',
  )
  const jewsonAfter = after.body.suppliers.find((row) => row.name === 'Jewson')
  const jewsonBill = jewsonAfter?.bills?.find((row) => row.reference === 'J-22')
  assert(jewsonBill && jewsonBill.date && jewsonBill.gross === '£96.00', 'supplier bill keeps date, reference, and gross')
  assert(
    after.body.mailbox
      && after.body.mailbox.connected === false
      && after.body.mailbox.banner === 'Mailbox not connected — set GRAPH_… on the host',
    'mailbox banner when Graph is not set',
  )
  const logged = await fetchJson('/api/mail', auth(token, {
    method: 'POST',
    body: JSON.stringify({ subject: 'Manual gate note', from: 'agent@example.com', body: 'Logged by staff.' }),
  }))
  assert(logged.res.status === 200 && logged.body.thread.source === 'log', 'manual mail still logs when the mailbox is off')
  const loggedAgain = await fetchJson('/api/desk', auth(token))
  assert(
    loggedAgain.body.mail.some((row) => row.subject === 'Manual gate note')
      && !loggedAgain.body.mail.some((row) => row.source === 'mailbox'),
    'disconnected mail does not invent inbox rows',
  )

  const quote = await fetchJson('/api/quotes', auth(token, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Hexham gate quote',
      client: 'Weird Fish',
      siteAddress: 'Hexham town centre',
      net: '4000',
    }),
  }))
  const quoteId = quote.body.quote.id
  const tender = await fetchJson('/api/tenders', auth(token, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Hexham gate tender',
      client: 'Weird Fish',
      status: 'open',
      dueDate: '20/11/2026',
      note: 'Bring the key.',
      quoteId,
    }),
  }))
  const tenderId = tender.body.tender.id
  const editedTender = await fetchJson(`/api/tenders/${tenderId}`, auth(token, {
    method: 'PATCH',
    body: JSON.stringify({
      title: 'Hexham gate tender',
      client: 'Weird Fish',
      status: 'submitted',
      dueDate: '21/11/2026',
      note: 'Bring the key and the boards.',
      quoteId,
      jobId: '',
    }),
  }))
  assert(
    editedTender.body.tender.status === 'submitted'
      && editedTender.body.tender.dueDate === '2026-11-21'
      && editedTender.body.tender.note.includes('boards')
      && editedTender.body.tender.quoteId === quoteId,
    'tender keeps title, client, status, due date, note, and quote',
  )
  const won = await fetchJson(`/api/tenders/${tenderId}/win`, auth(token, { method: 'POST', body: '{}' }))
  assert(
    won.res.status === 200
      && won.body.job.status === 'quoted'
      && won.body.job.name === 'Hexham gate tender'
      && won.body.job.client === 'Weird Fish'
      && won.body.tender.jobId === won.body.job.id
      && won.body.tender.quoteId === quoteId,
    'won tender with no job creates a quoted job and keeps the links',
  )
  const wonBook = await fetchJson('/api/desk', auth(token))
  const wonRow = wonBook.body.tenders.find((row) => row.id === tenderId)
  const quoteRow = wonBook.body.quotes.find((row) => row.id === quoteId)
  assert(wonRow.jobId === won.body.job.id && wonRow.quoteNumber && quoteRow, 'tender links survive a second read')
  const lost = await fetchJson('/api/tenders', auth(token, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Lost yard tender',
      client: 'Shed Co',
      status: 'lost',
      dueDate: '01/12/2026',
      note: 'Not this time.',
      quoteId,
      jobId: won.body.job.id,
    }),
  }))
  assert(lost.body.tender.status === 'lost' && lost.body.tender.jobId === won.body.job.id && lost.body.tender.quoteId === quoteId, 'lost tender stays linked')
  const lostAgain = await fetchJson('/api/desk', auth(token))
  const lostRow = lostAgain.body.tenders.find((row) => row.id === lost.body.tender.id)
  assert(lostRow.status === 'lost' && lostRow.jobName && lostRow.quoteNumber, 'lost tender links survive a second read')

  await cleanup()
  await sleep(300)
  const fixtureFile = join(tmp, 'mailbox.json')
  writeFileSync(fixtureFile, JSON.stringify([
    {
      id: 'msg-hex',
      subject: 'Hexham fit-out delivery',
      from: 'yard@example.com',
      received: '2026-10-05T08:00:00.000Z',
      body: 'Boards are on site.',
      isRead: false,
    },
  ]))
  const FIXTURE_PORT = Number(process.env.PROVE_COMPLETE_FIXTURE_PORT || 18794)
  fixtureChild = spawn(process.execPath, [join(ROOT, 'src/server.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(FIXTURE_PORT),
      HOST: '127.0.0.1',
      STAFF_AUTH_USERS: usersFile,
      DATA_DIR: tmp,
      SESSIONS_PATH: join(tmp, 'sessions.json'),
      DESK_STORE_PATH: join(tmp, 'desk.json'),
      TR_BOT_THREADS_PATH: join(tmp, 'tr-bot-threads.json'),
      CORS_ORIGIN: '*',
      GRAPH_MAIL_FIXTURE: fixtureFile,
      GRAPH_MAILBOX: 'office@treunroccontracts.com',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const fixtureBase = `http://127.0.0.1:${FIXTURE_PORT}`
  let fixtureUp = false
  for (let i = 0; i < 40 && !fixtureUp; i += 1) {
    try {
      fixtureUp = (await fetch(`${fixtureBase}/health`)).status === 200
    } catch { /* retry */ }
    if (!fixtureUp) await sleep(100)
  }
  assert(fixtureUp, 'fixture mailbox server')
  const fixLogin = await fetch(`${fixtureBase}/api/staff-auth`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  const fixToken = (await fixLogin.json()).token
  const synced = await fetch(`${fixtureBase}/api/desk`, { headers: { authorization: `Bearer ${fixToken}` } })
  const syncedBody = await synced.json()
  const inbox = syncedBody.mail.find((row) => row.subject === 'Hexham fit-out delivery')
  assert(
    syncedBody.mailbox.connected === true
      && syncedBody.mailbox.mode === 'fixture'
      && syncedBody.mailbox.banner === ''
      && inbox
      && inbox.from === 'yard@example.com'
      && inbox.source === 'mailbox'
      && inbox.jobId === jobId
      && inbox.jobName === 'Hexham fit-out',
    'fixture mailbox lists the message and links the job',
  )
  assert(syncedBody.mail.some((row) => row.subject === 'Manual gate note'), 'logged mail remains beside the mailbox')
  const marked = await fetch(`${fixtureBase}/api/mail/${inbox.id}/read`, {
    method: 'POST',
    headers: { authorization: `Bearer ${fixToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ read: true }),
  })
  const markedBody = await marked.json()
  assert(markedBody.thread.read === true, 'fixture message can be marked read')
  const reply = await fetch(`${fixtureBase}/api/mail/${inbox.id}/draft`, {
    method: 'POST',
    headers: { authorization: `Bearer ${fixToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'Thanks, leave them by the gate.' }),
  })
  const replyBody = await reply.json()
  assert(replyBody.notSent === true && replyBody.thread.replies[0].status === 'draft', 'mailbox reply stays a draft and is not sent')
  const syncedAgain = await fetch(`${fixtureBase}/api/desk`, { headers: { authorization: `Bearer ${fixToken}` } })
  const againBody = await syncedAgain.json()
  const againInbox = againBody.mail.find((row) => row.id === inbox.id)
  assert(againInbox && againInbox.read === true && againInbox.subject === 'Hexham fit-out delivery', 'fixture mail survives a second read')
} catch (err) {
  fail(err?.message || String(err))
  if (log) console.log(log.slice(0, 800))
} finally {
  await cleanup()
}

console.log(`${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
