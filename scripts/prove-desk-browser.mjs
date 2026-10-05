#!/usr/bin/env node
/**
 * Finger checks in Chrome: create Hexham fit-out, refresh, margin, invoice,
 * Monday, client view, worker flag, and the three screen states.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright-core'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const REPO = join(ROOT, '..', '..')
const store = await import(pathToFileURL(join(ROOT, 'src/store.js')).href)

const PASSWORD = 'ProveDesk-browser!'
const EMAIL = 'desk-browser@treunroc.com'
const PORT = Number(process.env.PROVE_BROWSER_PORT || 18789)
const BASE = `http://127.0.0.1:${PORT}`
const tmp = join(tmpdir(), `tr-desk-browser-${process.pid}`)
mkdirSync(tmp, { recursive: true })
const usersFile = join(tmp, 'users.json')
let shotDir = join(REPO, 'qa', 'desk-2026-10-05')
const artifactDir = '/opt/cursor/artifacts/qa'
try {
  mkdirSync(shotDir, { recursive: true })
} catch {
  shotDir = artifactDir
}
mkdirSync(artifactDir, { recursive: true })

const { salt, hash } = store.hashPassword(PASSWORD)
writeFileSync(usersFile, JSON.stringify({
  users: [{ email: EMAIL, name: 'Desk Browser', role: 'OFFICE', tenantId: 'treunroc', salt, hash }],
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

function ukYesterday() {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
  const [y, m, d] = today.split('-').map(Number)
  const prev = new Date(Date.UTC(y, m - 1, d))
  prev.setUTCDate(prev.getUTCDate() - 1)
  return `${String(prev.getUTCDate()).padStart(2, '0')}/${String(prev.getUTCMonth() + 1).padStart(2, '0')}/${prev.getUTCFullYear()}`
}

function nav(page, name) {
  return page.getByRole('navigation').getByRole('link', { name, exact: true })
}

async function shot(page, name) {
  const file = `${name}.png`
  await page.evaluate(() => document.getAnimations().forEach((anim) => anim.finish()))
  await page.screenshot({ path: join(shotDir, file), fullPage: true })
  await page.screenshot({ path: join(artifactDir, file), fullPage: true })
  console.log(`SHOT: ${file}`)
}

let browser
try {
  let up = false
  for (let i = 0; i < 40 && !up; i += 1) {
    try {
      const res = await fetch(`${BASE}/health`)
      up = res.status === 200
    } catch { /* retry */ }
    if (!up) await sleep(100)
  }
  if (!up) throw new Error(`server did not start: ${log.slice(0, 400)}`)

  browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  page.setDefaultTimeout(15000)
  page.on('pageerror', (err) => console.log(`PAGEERROR: ${err.message}`))

  await page.goto(`${BASE}/#/client`)
  await page.waitForSelector('[data-screen="blocked"]')
  if (!(await page.locator('[data-blocked]').innerText()).includes("Sign in to see this client's jobs.")) {
    throw new Error('client route was not blocked')
  }
  if ((await page.content()).includes('Hexham')) throw new Error('blocked page showed a job')
  await shot(page, '16-client-blocked')

  await page.goto(`${BASE}/`)
  await page.getByLabel('Work email').fill(EMAIL)
  await page.getByLabel('Password').fill(PASSWORD)
  let release
  const gate = new Promise((resolve) => { release = resolve })
  await page.route('**/api/desk', async (route) => {
    await gate
    await route.continue()
  })
  await page.getByRole('button', { name: 'Enter desk' }).click()
  await page.waitForSelector('[data-screen="loading"]')
  await shot(page, '01-loading')
  release()
  await page.waitForSelector('[data-screen="home"]')
  await page.unroute('**/api/desk')
  await nav(page, 'Jobs').click()
  await page.waitForSelector('[data-screen="jobs"]')
  if ((await page.locator('[data-screen="jobs"]').innerText()).includes('SAMPLE')) {
    throw new Error('SAMPLE list on the jobs screen')
  }
  await page.getByText('No jobs yet.').waitFor()
  await shot(page, '02-jobs-empty')

  await nav(page, 'Money due').click()
  await page.getByText('No live jobs yet.').waitFor()
  if ((await page.locator('[data-screen="monday"]').innerText()).includes('£0')) {
    throw new Error('empty Monday showed a zero')
  }
  await shot(page, '03-monday-empty')

  await nav(page, 'Invoices').click()
  await page.getByText('No invoices yet.').waitFor()
  await shot(page, '04-invoices-empty')

  await nav(page, 'Workers').click()
  await page.getByText('No workers yet.').waitFor()
  if (await page.locator('input[type="file"]').count()) throw new Error('passport file input is on the desk')
  await shot(page, '05-workers-empty')

  await nav(page, 'Supplier bills').click()
  await page.getByText('No supplier bills yet.').waitFor()
  await shot(page, '06-bills-empty')

  await nav(page, 'Jobs').click()
  await page.getByRole('button', { name: 'Add job' }).first().click()
  await page.getByRole('button', { name: 'Save job' }).click()
  await page.getByText('Enter a job name.').waitFor()
  await shot(page, '07-blank-name')

  await page.getByLabel('Job name').fill('Hexham fit-out')
  await page.getByLabel('Client').fill('Weird Fish')
  await page.getByLabel('Site address').fill('Hexham town centre')
  await page.getByLabel('Contract sum').fill('100000')
  await page.getByRole('button', { name: 'Save job' }).click()
  await page.waitForSelector('[data-screen="job"]')
  await nav(page, 'Jobs').click()
  await page.getByRole('link', { name: 'Hexham fit-out' }).waitFor()
  await page.reload()
  await page.getByRole('link', { name: 'Hexham fit-out' }).waitFor()
  await shot(page, '08-hexham-after-refresh')
  await page.getByRole('link', { name: 'Hexham fit-out' }).click()
  await page.waitForSelector('[data-status="quoted"]')

  await page.getByLabel('Status').selectOption('live')
  await page.getByRole('button', { name: 'Save job' }).click()
  await page.waitForSelector('[data-status="live"]')
  await page.reload()
  await page.waitForSelector('[data-status="live"]')
  await shot(page, '09-status-live-after-refresh')

  await page.getByLabel('Variation amount').fill('10000')
  await page.getByLabel('Approved').check()
  await page.getByRole('button', { name: 'Add variation' }).click()
  await page.getByText('£10,000.00').first().waitFor()
  await page.getByLabel('Cost amount').fill('40000')
  await page.getByRole('button', { name: 'Add cost' }).click()
  await page.locator('[data-margin]').getByText('£70,000.00').waitFor()
  const marginText = await page.locator('[data-margin]').innerText()
  if (!marginText.includes('£70,000.00') || !marginText.includes('63.6')) {
    throw new Error(`margin text was ${marginText}`)
  }
  const formula = await page.locator('[data-formula]').innerText()
  if (formula !== 'Live margin = contract sum + approved variations - costs') {
    throw new Error(`formula was ${formula}`)
  }
  if (!(await page.locator('[data-costs]').innerText()).includes('£40,000.00')) {
    throw new Error('costs figure was wrong')
  }
  await shot(page, '10-margin')

  await page.getByLabel('Cost amount').fill('')
  await page.getByRole('button', { name: 'Add cost' }).click()
  await page.getByText('Enter a cost amount.').waitFor()
  await shot(page, '11-blank-cost')

  const before = await page.locator('[data-margin]').innerText()
  await page.getByLabel('Cost amount').fill('5000')
  await page.getByLabel('Cost mark').selectOption('Ryan')
  await page.getByRole('button', { name: 'Add cost' }).click()
  await page.locator('[data-review]').getByText('Ryan').waitFor()
  const after = await page.locator('[data-margin]').innerText()
  if (before !== after) throw new Error(`Ryan line moved the margin from ${before} to ${after}`)
  if (!(await page.locator('[data-review]').innerText()).includes('£5,000.00')) {
    throw new Error('review pile missing the Ryan amount')
  }
  await shot(page, '12-ryan-review')

  await page.setViewportSize({ width: 390, height: 844 })
  await shot(page, '13-job-mobile')
  await page.setViewportSize({ width: 1280, height: 800 })

  await page.getByRole('button', { name: 'Create invoice' }).click()
  await page.waitForSelector('[data-invoice-number="INV-0001"]')
  await page.reload()
  await page.waitForSelector('[data-invoice-number="INV-0001"]')
  if (!(await page.locator('[data-gross]').innerText()).includes('£120,000.00')) {
    throw new Error('gross was not 20% VAT on the contract sum')
  }
  await shot(page, '14-invoice')

  await page.getByRole('link', { name: 'Print view' }).click()
  await page.waitForSelector('[data-screen="print"]')
  const printText = await page.locator('[data-screen="print"]').innerText()
  for (const need of ['Treun Roc Contracts Ltd', 'Hexham town centre', 'Works', 'Total']) {
    if (!printText.includes(need)) throw new Error(`print view missing ${need}`)
  }
  await shot(page, '15-print')

  await page.getByRole('link', { name: 'Back to invoice' }).click()
  await page.getByRole('button', { name: 'Mark issued' }).click()
  await page.getByText('This invoice is issued. Credit it to change the lines.').waitFor()
  if (await page.getByRole('button', { name: 'Save invoice' }).count()) {
    throw new Error('issued invoice still has a save button')
  }
  await shot(page, '16-issued-lock')

  const apiHits = []
  const onReq = (req) => { if (req.url().includes('/api/')) apiHits.push(req.url()) }
  page.on('request', onReq)
  await page.getByRole('button', { name: 'Send' }).click()
  await page.locator('[data-send-result]').getByText('not sent', { exact: true }).waitFor()
  await sleep(300)
  page.off('request', onReq)
  if (apiHits.length) throw new Error(`Send called the network: ${apiHits.join(', ')}`)
  const draft = await page.locator('[data-draft]').inputValue()
  if (!draft.includes('INV-0001') || !draft.includes('Hexham fit-out')) throw new Error('draft was not copied onto the page')
  await shot(page, '17-not-sent')

  await nav(page, 'Supplier bills').click()
  await page.getByLabel('Supplier').fill('North timber')
  await page.getByLabel('Net').fill('50')
  await page.getByRole('button', { name: 'Add supplier bill' }).click()
  await page.getByText('North timber').waitFor()
  await shot(page, '18-supplier-bill')
  await nav(page, 'Invoices').click()
  if ((await page.locator('[data-screen="invoices"]').innerText()).includes('North timber')) {
    throw new Error('supplier bill appeared on the client invoice list')
  }

  await nav(page, 'Jobs').click()
  await page.getByRole('button', { name: 'Add job' }).click()
  await page.getByLabel('Job name').fill('Other yard')
  await page.getByLabel('Client').fill('Other Client')
  await page.getByLabel('Site address').fill('Cirencester')
  await page.getByLabel('Contract sum').fill('1000')
  await page.getByRole('button', { name: 'Save job' }).click()
  await page.waitForSelector('[data-screen="job"]')

  await nav(page, 'Money due').click()
  await page.locator('[data-monday-row]').waitFor()
  const monday = await page.locator('[data-screen="monday"]').innerText()
  if (!monday.includes('Hexham fit-out') || monday.includes('Other yard')) {
    throw new Error(`Monday rows wrong: ${monday}`)
  }
  const row = await page.locator('[data-row-margin]').innerText()
  const total = await page.locator('[data-total-margin]').innerText()
  if (row !== total || !total.includes('70,000.00')) throw new Error(`Monday total ${total} row ${row}`)
  if (monday.includes('5,000')) throw new Error('Monday included the Ryan line')
  await shot(page, '19-monday')

  await page.getByRole('button', { name: 'Sign out' }).click()
  await page.waitForSelector('[data-screen="login"]')
  await page.goto(`${BASE}/#/client`)
  await page.waitForSelector('[data-screen="blocked"]')
  if ((await page.content()).includes('Hexham')) throw new Error('signed-out client view showed a job')

  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByLabel('Work email').fill(EMAIL)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Enter desk' }).click()
  await page.waitForSelector('[data-screen="home"]')
  await nav(page, 'Client view').click()
  await page.getByText('STAFF PREVIEW').waitFor()
  await page.getByLabel('Client').fill('Weird Fish')
  await page.getByRole('button', { name: 'Show client' }).click()
  await page.locator('[data-client-result]').waitFor()
  const clientText = await page.locator('main').innerText()
  if (!clientText.includes('Hexham fit-out')) throw new Error('client view missing the job')
  if (clientText.includes('Other Client') || clientText.includes('Other yard')) {
    throw new Error('client view showed another client')
  }
  if (/\bcosts?\b/i.test(clientText) || /\bmargin\b/i.test(clientText) || /\bRyan/.test(clientText)) {
    throw new Error(`client view leaked money language: ${clientText}`)
  }
  if (!clientText.includes('INV-0001') || !clientText.includes('Live')) {
    throw new Error('client view missing the job or issued invoice')
  }
  await shot(page, '20-client-preview')

  await nav(page, 'Workers').click()
  await page.getByLabel('Name').fill('Sam Carter')
  await page.getByLabel('Trade').fill('Joiner')
  await page.getByLabel('Phone').fill('07700900123')
  await page.getByLabel('CIS or PAYE').selectOption('CIS')
  await page.getByLabel('Ticket expiry').fill(ukYesterday())
  await page.getByRole('button', { name: 'Add worker' }).click()
  await page.getByRole('heading', { name: 'Sam Carter' }).waitFor()
  await page.reload()
  await page.getByRole('heading', { name: 'Sam Carter' }).waitFor()
  await page.getByText('Ticket expired').waitFor()
  await nav(page, 'Jobs').click()
  await page.getByRole('link', { name: 'Hexham fit-out' }).click()
  await page.getByLabel('Worker').selectOption({ label: 'Sam Carter' })
  await page.getByRole('button', { name: 'Attach worker' }).click()
  await page.locator('[data-ticket-flag]').waitFor()
  await page.reload()
  await page.locator('[data-ticket-flag]').getByText('Ticket expired').waitFor()
  await shot(page, '21-worker-flag-after-refresh')

  await page.route('**/api/desk', (route) => route.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'Could not load the desk. Check the connection and try again.' }),
  }))
  await nav(page, 'Money due').click()
  await page.getByText('Could not load the desk. Check the connection and try again.').waitFor()
  if (!(await page.locator('[data-screen="monday"]').innerText()).includes('Hexham fit-out')) {
    throw new Error('failed load dropped the last good rows')
  }
  await shot(page, '22-failed')
  await page.unroute('**/api/desk')

  const page2 = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page2.goto(`${BASE}/`)
  await page2.getByLabel('Work email').fill(EMAIL)
  await page2.getByLabel('Password').fill(PASSWORD)
  await page2.getByRole('button', { name: 'Enter desk' }).click()
  await page2.getByRole('link', { name: 'Hexham fit-out' }).waitFor()
  await shot(page2, '23-second-device')
  await page2.close()

  console.log('BROWSER PASS')
} catch (err) {
  console.error(`BROWSER FAIL: ${err?.message || err}`)
  if (log) console.error(log.slice(-800))
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  if (!child.killed) child.kill('SIGTERM')
}
