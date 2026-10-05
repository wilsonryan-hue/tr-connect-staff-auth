#!/usr/bin/env node
/**
 * Desk checks: job survives a second read, margin 100000+10000-40000,
 * Ryan line stays out, invoice locks, client view has no cost, worker flag.
 * Uses a throwaway users file and DATA_DIR. Does not send mail.
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

const PASSWORD = 'ProveDesk-only!'
const EMAIL = 'desk-prove@treunroc.com'
const PORT = Number(process.env.PROVE_DESK_PORT || 18788)
const BASE = `http://127.0.0.1:${PORT}`
const tmp = mkdtempSync(join(tmpdir(), 'tr-desk-'))
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
  users: [{ email: EMAIL, name: 'Desk Prove', role: 'OFFICE', tenantId: 'treunroc', salt, hash }],
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
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(extra.headers || {}) },
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
  assert(up, `health on ${BASE}`)
  if (!up) throw new Error(log.slice(0, 400))

  const home = await fetch(`${BASE}/`)
  const html = await home.text()
  assert(home.status === 200 && html.includes('Treun Roc Connect'), 'GET / is the desk')
  assert(!/SAMPLE/i.test(html), 'desk HTML has no SAMPLE list')

  const unauth = await fetchJson('/api/desk')
  assert(unauth.res.status === 401, 'desk requires sign-in')
  const unauthClient = await fetchJson('/api/client-view?client=Weird%20Fish')
  assert(unauthClient.res.status === 401, 'client view blocked without sign-in')
  assert(!JSON.stringify(unauthClient.body).includes('Hexham'), 'blocked client body has no job')

  const login = await fetchJson('/api/staff-auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  const token = login.body?.token
  assert(login.res.status === 200 && token, 'staff login')

  const login2 = await fetchJson('/api/staff-auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  const token2 = login2.body?.token

  const blank = await fetchJson('/api/jobs', auth(token, {
    method: 'POST',
    body: JSON.stringify({ name: '  ', client: 'Weird Fish', siteAddress: 'Hexham town centre', contractSum: '100000' }),
  }))
  assert(blank.res.status === 400 && blank.body?.error === 'Enter a job name.', 'blank name is a sentence')

  const created = await fetchJson('/api/jobs', auth(token, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Hexham fit-out',
      client: 'Weird Fish',
      siteAddress: 'Hexham town centre',
      status: 'quoted',
      contractSum: '100000',
      vatTreatment: 'standard',
    }),
  }))
  const jobId = created.body?.job?.id
  assert(created.res.status === 200 && created.body.job.name === 'Hexham fit-out', 'create Hexham fit-out')

  const again = await fetchJson('/api/desk', auth(token))
  const hex = again.body.jobs.find((j) => j.id === jobId)
  assert(hex && hex.name === 'Hexham fit-out' && hex.contractSum === '£100,000.00', 'job still there on second read')
  assert(again.body.jobs.length === 1, 'no second list of jobs')

  const otherDevice = await fetchJson('/api/desk', auth(token2))
  assert(otherDevice.body.jobs.some((j) => j.name === 'Hexham fit-out'), 'second sign-in sees the job')

  const moved = await fetchJson(`/api/jobs/${jobId}`, auth(token, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'live' }),
  }))
  assert(moved.body.job.status === 'live', 'status moves to live')
  const held = await fetchJson('/api/desk', auth(token))
  assert(held.body.jobs.find((j) => j.id === jobId).status === 'live', 'status held')

  await fetchJson(`/api/jobs/${jobId}/variations`, auth(token, {
    method: 'POST',
    body: JSON.stringify({ amount: '10000', approved: true, description: 'Extra rooms' }),
  }))
  await fetchJson(`/api/jobs/${jobId}/costs`, auth(token, {
    method: 'POST',
    body: JSON.stringify({ amount: '40000', description: 'Labour' }),
  }))
  const margined = await fetchJson('/api/desk', auth(token))
  const money = margined.body.jobs.find((j) => j.id === jobId).money
  assert(money.margin === '£70,000.00' && money.marginPercent === '63.6', `margin ${money.margin} ${money.marginPercent}`)
  assert(money.formula === 'Live margin = contract sum + approved variations - costs', 'formula labelled')
  assert(money.costs === '£40,000.00', 'costs exclude nothing yet')

  const blankCost = await fetchJson(`/api/jobs/${jobId}/costs`, auth(token, {
    method: 'POST',
    body: JSON.stringify({ amount: '   ', description: 'Missing' }),
  }))
  assert(blankCost.res.status === 400 && blankCost.body.error === 'Enter a cost amount.', 'blank cost rejected')

  await fetchJson(`/api/jobs/${jobId}/costs`, auth(token, {
    method: 'POST',
    body: JSON.stringify({ amount: '5000', mark: 'Ryan', description: 'Review me' }),
  }))
  const afterRyan = await fetchJson('/api/desk', auth(token))
  const jobAfter = afterRyan.body.jobs.find((j) => j.id === jobId)
  const ryan = afterRyan.body.costs.find((c) => c.jobId === jobId && c.mark === 'Ryan')
  assert(jobAfter.money.margin === '£70,000.00' && jobAfter.money.marginPercent === '63.6', 'Ryan line does not change the margin')
  assert(ryan && ryan.review === true && ryan.amount === '£5,000.00', 'Ryan line is in the book as review')

  await fetchJson('/api/jobs', auth(token, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Other yard',
      client: 'Other Client',
      siteAddress: 'Cirencester',
      status: 'quoted',
      contractSum: '1000',
    }),
  }))

  const draft = await fetchJson(`/api/jobs/${jobId}/invoices`, auth(token, { method: 'POST', body: '{}' }))
  const inv = draft.body.invoice
  assert(inv && inv.number === 'INV-0001' && inv.gross === '£120,000.00' && inv.vatLabel === 'VAT 20%', 'invoice from the job')
  assert(inv.siteAddress === 'Hexham town centre' && inv.jobName === 'Hexham fit-out', 'invoice carries the job')

  const bill = await fetchJson('/api/supplier-bills', auth(token, {
    method: 'POST',
    body: JSON.stringify({ supplier: 'North timber', net: '50', reference: 'NT-1' }),
  }))
  assert(bill.res.status === 200 && bill.body.bill.supplier === 'North timber', 'supplier bill saved')
  const mixed = await fetchJson('/api/desk', auth(token))
  assert(!mixed.body.invoices.some((row) => row.number.startsWith('BILL')), 'supplier bills are not invoices')
  assert(mixed.body.supplierBills.some((row) => row.supplier === 'North timber'), 'supplier bill list is separate')

  const clientDraft = await fetchJson('/api/client-view?client=Weird%20Fish', auth(token))
  assert(clientDraft.body.staffPreview === true, 'client payload is a staff preview')
  assert(clientDraft.body.invoices.length === 0, 'draft invoice is hidden from the client')
  assert(!JSON.stringify(clientDraft.body).toLowerCase().includes('margin'), 'client payload has no margin')
  assert(!JSON.stringify(clientDraft.body).toLowerCase().includes('ryan'), 'client payload has no Ryan line')
  assert(!clientDraft.body.jobs.some((j) => j.name === 'Other yard'), 'other client is absent')

  const issued = await fetchJson(`/api/invoices/${inv.id}/issue`, auth(token, { method: 'POST', body: '{}' }))
  assert(issued.body.invoice.issued === true, 'invoice issued')
  const edit = await fetchJson(`/api/invoices/${inv.id}`, auth(token, {
    method: 'PATCH',
    body: JSON.stringify({ lines: [{ description: 'Changed', net: '1' }] }),
  }))
  assert(edit.res.status === 409 && edit.body.error === 'This invoice is issued. Credit it to change the lines.', 'issued invoice locks')

  const client = await fetchJson('/api/client-view?client=Weird%20Fish', auth(token))
  assert(client.body.jobs.length === 1 && client.body.jobs[0].status === 'live', 'client sees their live job')
  assert(client.body.invoices.length === 1 && client.body.invoices[0].number === 'INV-0001', 'client sees the issued invoice')
  assert(!Object.prototype.hasOwnProperty.call(client.body.jobs[0], 'contractSum'), 'client job has no contract sum')

  const live = mixed.body.jobs.filter((j) => j.status === 'live')
  const mondayMargin = live.reduce((sum, j) => sum + j.money.marginPence, 0)
  assert(live.length === 1 && live[0].name === 'Hexham fit-out', 'monday source is live jobs only')
  assert(mondayMargin === jobAfter.money.marginPence, 'monday total matches the job margin')

  const y = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const [yy, mm, dd] = y.split('-').map(Number)
  const prev = new Date(Date.UTC(yy, mm - 1, dd))
  prev.setUTCDate(prev.getUTCDate() - 1)
  const expiry = `${String(prev.getUTCDate()).padStart(2, '0')}/${String(prev.getUTCMonth() + 1).padStart(2, '0')}/${prev.getUTCFullYear()}`
  const worker = await fetchJson('/api/workers', auth(token, {
    method: 'POST',
    body: JSON.stringify({ name: 'Sam Carter', trade: 'Joiner', phone: '07700900123', tax: 'CIS', ticketExpiry: expiry }),
  }))
  assert(worker.body.worker.ticketExpired === true, 'expired ticket flags')
  const workerId = worker.body.worker.id
  await fetchJson(`/api/jobs/${jobId}/workers`, auth(token, { method: 'POST', body: JSON.stringify({ workerId }) }))
  const linked = await fetchJson('/api/desk', auth(token))
  const onJob = linked.body.jobs.find((j) => j.id === jobId).workers.find((w) => w.id === workerId)
  const onWorker = linked.body.workers.find((w) => w.id === workerId)
  assert(onJob && onJob.ticketExpired, 'job lists the worker and the flag')
  assert(onWorker.jobs.some((j) => j.id === jobId), 'worker lists the job')

  const image = await fetchJson('/api/workers', auth(token, {
    method: 'POST',
    body: JSON.stringify({ name: 'Pat', tax: 'PAYE', note: 'data:image/png;base64,aaaa' }),
  }))
  assert(image.res.status === 400 && image.body.error === 'Do not store passport images.', 'passport image rejected')
} catch (err) {
  fail(`exception: ${err?.message || err}`)
  if (log) console.log(log.slice(0, 500))
}

await cleanup()
console.log(`--- prove-desk: ${passed} PASS, ${failed} FAIL ---`)
process.exit(failed === 0 ? 0 : 1)
