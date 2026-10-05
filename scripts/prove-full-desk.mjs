#!/usr/bin/env node
/**
 * Full-desk checks on top of the saved job book.
 * Quote accept becomes a job. Ryan lines stay out of the margin after approval.
 * Mail draft is not sent. A refresh on the same process still has the rows.
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

const PASSWORD = 'ProveFull-only!'
const EMAIL = 'full-desk@treunroc.com'
const PORT = Number(process.env.PROVE_FULL_PORT || 18790)
const BASE = `http://127.0.0.1:${PORT}`
const tmp = mkdtempSync(join(tmpdir(), 'tr-full-'))
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
  users: [{ email: EMAIL, name: 'Full Desk', role: 'OFFICE', tenantId: 'treunroc', salt, hash }],
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

async function cleanup() {
  if (!child.killed) child.kill('SIGTERM')
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

  const open = await fetchJson('/api/desk')
  assert(open.res.status === 401, 'desk stays behind sign-in')
  const openMail = await fetchJson('/api/mail', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  assert(openMail.res.status === 401, 'mail stays behind sign-in')
  const openBot = await fetchJson('/api/tr-bot/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'hello' }) })
  assert(openBot.res.status === 401, 'TR Bot messages stay behind sign-in')

  const login = await fetchJson('/api/staff-auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  const token = login.body?.token
  assert(login.res.status === 200 && token, 'staff login')

  const quote = await fetchJson('/api/quotes', auth(token, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Iford fire reinstatement',
      client: 'Iford',
      siteAddress: 'Iford lane',
      description: 'Reinstatement',
      net: '25000',
    }),
  }))
  const quoteId = quote.body?.quote?.id
  assert(quote.res.status === 200 && quote.body.quote.number === 'Q-0001', 'create quote')

  const edited = await fetchJson(`/api/quotes/${quoteId}`, auth(token, {
    method: 'PATCH',
    body: JSON.stringify({ net: '26000', title: 'Iford fire reinstatement' }),
  }))
  assert(edited.body.quote.net === '£26,000.00', 'edit quote net')

  const drafted = await fetchJson(`/api/quotes/${quoteId}/draft`, auth(token, { method: 'POST', body: '{}' }))
  assert(drafted.body.notSent === true && String(drafted.body.draft).includes('not sent'), 'quote send is a draft and not sent')
  assert(!String(drafted.body.draft).includes('mailto:'), 'quote draft has no mailto')

  const accepted = await fetchJson(`/api/quotes/${quoteId}/accept`, auth(token, { method: 'POST', body: '{}' }))
  const wonId = accepted.body?.job?.id
  assert(accepted.body.job.name === 'Iford fire reinstatement' && accepted.body.job.status === 'quoted', 'accepted quote becomes a job')
  assert(accepted.body.job.contractSum === '£26,000.00', 'won job keeps the quote net')

  const tender = await fetchJson('/api/tenders', auth(token, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Hexham tender',
      client: 'Weird Fish',
      status: 'open',
      dueDate: '20/11/2026',
      quoteId,
      jobId: wonId,
    }),
  }))
  assert(tender.res.status === 200 && tender.body.tender.quoteNumber === 'Q-0001', 'tender links the quote')
  const movedTender = await fetchJson(`/api/tenders/${tender.body.tender.id}`, auth(token, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'won' }),
  }))
  assert(movedTender.body.tender.status === 'won' && movedTender.body.tender.jobId === wonId, 'tender status and job link held')

  const job = await fetchJson('/api/jobs', auth(token, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Hexham fit-out',
      client: 'Weird Fish',
      siteAddress: 'Hexham town centre',
      status: 'live',
      contractSum: '100000',
      startDate: '06/10/2026',
      notes: 'Access from the rear yard.',
    }),
  }))
  const jobId = job.body.job.id
  assert(job.body.job.startDate === '2026-10-06' && job.body.job.notes.includes('rear yard'), 'job stores a start date and notes')

  await fetchJson(`/api/jobs/${jobId}/variations`, auth(token, {
    method: 'POST',
    body: JSON.stringify({ amount: '10000', approved: true, description: 'Extra rooms' }),
  }))
  await fetchJson(`/api/jobs/${jobId}/costs`, auth(token, {
    method: 'POST',
    body: JSON.stringify({ amount: '40000', description: 'Labour' }),
  }))
  const ryan = await fetchJson(`/api/jobs/${jobId}/costs`, auth(token, {
    method: 'POST',
    body: JSON.stringify({ amount: '5000', mark: 'Ryan', description: 'Review me' }),
  }))
  const ryanLine = ryan.body.costs.find((row) => row.mark === 'Ryan' && row.jobId === jobId)
  assert(ryanLine && ryanLine.approval === 'pending' && ryanLine.review === true, 'Ryan line waits in approvals')
  const before = ryan.body.jobs.find((row) => row.id === jobId).money
  assert(before.margin === '£70,000.00' && before.marginPercent === '63.6', 'pending Ryan line is outside the margin')

  const approved = await fetchJson('/api/approvals', auth(token, {
    method: 'POST',
    body: JSON.stringify({ kind: 'cost', id: ryanLine.id }),
  }))
  const after = approved.body.jobs.find((row) => row.id === jobId).money
  const held = approved.body.costs.find((row) => row.id === ryanLine.id)
  assert(after.margin === '£70,000.00' && held.approval === 'in-review' && held.review === true, 'approve into review does not allocate')

  const bill = await fetchJson('/api/supplier-bills', auth(token, {
    method: 'POST',
    body: JSON.stringify({ supplier: 'North timber', net: '50', mark: 'Kacey' }),
  }))
  assert(bill.body.bill.approval === 'pending' && bill.body.bill.review === true, 'Kacey bill waits and is not a client invoice')

  const thread = await fetchJson('/api/mail', auth(token, {
    method: 'POST',
    body: JSON.stringify({ subject: 'Site access', from: 'agent@example.com', body: 'Gate code is on the board.', jobId }),
  }))
  const mailId = thread.body.thread.id
  assert(thread.body.thread.read === false, 'logged mail starts unread')
  const marked = await fetchJson(`/api/mail/${mailId}/read`, auth(token, { method: 'POST', body: JSON.stringify({ read: true }) }))
  assert(marked.body.thread.read === true, 'mail can be marked read')
  const reply = await fetchJson(`/api/mail/${mailId}/draft`, auth(token, {
    method: 'POST',
    body: JSON.stringify({ text: 'Thanks, we have it.' }),
  }))
  assert(reply.body.notSent === true && reply.body.thread.replies[0].status === 'draft', 'mail reply is a draft and not sent')

  const worker = await fetchJson('/api/workers', auth(token, {
    method: 'POST',
    body: JSON.stringify({ name: 'Sam Carter', trade: 'Joiner', phone: '07700900123', tax: 'CIS', ticketExpiry: '01/01/2020' }),
  }))
  const workerId = worker.body.worker.id
  assert(worker.body.worker.tax === 'CIS' && worker.body.worker.ticketExpired === true, 'worker keeps CIS and the ticket flag')
  const hours = await fetchJson(`/api/jobs/${jobId}/hours`, auth(token, {
    method: 'POST',
    body: JSON.stringify({ workerId, hours: '7.5', date: '06/10/2026', note: 'First fix' }),
  }))
  assert(hours.body.hours.hours === '7.5' && hours.body.hours.jobId === jobId, 'hours save on the job')

  const note = await fetchJson(`/api/jobs/${jobId}/site-notes`, auth(token, {
    method: 'POST',
    body: JSON.stringify({ text: 'Scaffold stays until Friday.', author: 'Full Desk' }),
  }))
  assert(note.body.note.text.includes('Scaffold'), 'site note saves on the job')

  const fileBody = Buffer.from('rear yard sketch').toString('base64')
  const file = await fetchJson(`/api/jobs/${jobId}/files`, auth(token, {
    method: 'POST',
    body: JSON.stringify({ name: 'rear-yard.txt', note: 'Sketch', dataBase64: fileBody }),
  }))
  assert(file.res.status === 200 && file.body.file.name === 'rear-yard.txt', 'job document saves')
  const downloaded = await fetch(`${BASE}/api/files/${file.body.file.id}`, { headers: { authorization: `Bearer ${token}` } })
  const bytes = Buffer.from(await downloaded.arrayBuffer())
  assert(downloaded.status === 200 && bytes.toString() === 'rear yard sketch', 'job document downloads behind sign-in')
  const publicFile = await fetch(`${BASE}/api/files/${file.body.file.id}`)
  assert(publicFile.status === 401, 'job document is not public')

  const inv = await fetchJson(`/api/jobs/${jobId}/invoices`, auth(token, { method: 'POST', body: '{}' }))
  const issued = await fetchJson(`/api/invoices/${inv.body.invoice.id}/issue`, auth(token, { method: 'POST', body: '{}' }))
  const beforeGross = issued.body.invoice.grossPence
  const beforeNet = issued.body.invoice.netPence
  const credit = await fetchJson(`/api/invoices/${inv.body.invoice.id}/credit`, auth(token, { method: 'POST', body: '{}' }))
  assert(credit.res.status === 200 && credit.body.creditNote.number === 'CN-0001', 'credit note CN-0001 is created')
  assert(credit.body.creditNote.grossPence === beforeGross && credit.body.creditNote.netPence === beforeNet, 'credit note copies the invoice totals')
  const againCredit = await fetchJson(`/api/invoices/${inv.body.invoice.id}/credit`, auth(token, { method: 'POST', body: '{}' }))
  assert(againCredit.body.creditNote.id === credit.body.creditNote.id, 'a second credit opens the same note')
  const lockedBook = await fetchJson('/api/desk', auth(token))
  const lockedInv = lockedBook.body.invoices.find((row) => row.id === inv.body.invoice.id)
  const lockedJob = lockedBook.body.jobs.find((row) => row.id === jobId)
  assert(lockedInv.status === 'issued' && lockedInv.grossPence === beforeGross && lockedInv.netPence === beforeNet, 'issued invoice totals stay locked')
  assert(lockedJob.money.marginPence === 7000000, 'credit note does not change the live margin')

  const again = await fetchJson('/api/desk', auth(token))
  const live = again.body.jobs.find((row) => row.id === jobId)
  const financeMargin = again.body.jobs.filter((row) => row.status === 'live').reduce((sum, row) => sum + row.money.marginPence, 0)
  assert(live.money.marginPence === financeMargin, 'finance total matches the live job')
  assert(again.body.jobs.some((row) => row.startDate === '2026-10-06'), 'dated job is still there for the calendar')
  assert(again.body.mail.some((row) => row.subject === 'Site access' && row.read === true), 'mail survives a second read')
  assert(again.body.files.some((row) => row.name === 'rear-yard.txt'), 'file list survives a second read')
  assert(again.body.hours.some((row) => row.jobId === jobId), 'hours survive a second read')
  assert(again.body.siteNotes.some((row) => row.jobId === jobId), 'site note survives a second read')
  assert(again.body.quotes.some((row) => row.status === 'accepted' && row.jobId === wonId), 'accepted quote still points at the job')

  const bot = await fetchJson('/api/tr-bot/messages', auth(token, {
    method: 'POST',
    body: JSON.stringify({ text: 'Need the Iford job on the board.', staffName: 'Full Desk' }),
  }))
  assert(bot.res.status === 200 && bot.body.threadId && bot.body.messages.some((row) => row.role === 'staff'), 'TR Bot stores the handoff')
  const botAgain = await fetchJson(`/api/tr-bot/messages?threadId=${bot.body.threadId}`, auth(token))
  assert(botAgain.body.messages.length === 1, 'handoff is still on the relay after a second read')
} catch (err) {
  fail(`exception: ${err?.message || err}`)
  if (log) console.log(log.slice(0, 800))
}

await cleanup()
console.log(`--- prove-full-desk: ${passed} PASS, ${failed} FAIL ---`)
process.exit(failed === 0 ? 0 : 1)
