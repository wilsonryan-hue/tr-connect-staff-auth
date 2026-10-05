#!/usr/bin/env node
/**
 * Finger checks for the finished staff desk.
 * Screenshots land in qa/complete-desk-2026-10-05.
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

const PASSWORD = 'ProveComplete-browser!'
const EMAIL = 'complete-browser@treunroc.com'
const PORT = Number(process.env.PROVE_COMPLETE_BROWSER_PORT || 18793)
const BASE = `http://127.0.0.1:${PORT}`
const tmp = join(tmpdir(), `tr-complete-browser-${process.pid}`)
mkdirSync(tmp, { recursive: true })
const usersFile = join(tmp, 'users.json')
const shotDir = join(REPO, 'qa', 'complete-desk-2026-10-05')
mkdirSync(shotDir, { recursive: true })
writeFileSync(join(tmp, 'site-note.txt'), 'site sketch')

const { salt, hash } = store.hashPassword(PASSWORD)
writeFileSync(usersFile, JSON.stringify({
  users: [{ email: EMAIL, name: 'Alex Office', role: 'OFFICE', tenantId: 'treunroc', salt, hash }],
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

function nav(page, name) {
  return page.getByRole('navigation').getByRole('link', { name, exact: true })
}

async function shot(page, name) {
  await page.evaluate(() => document.getAnimations().forEach((anim) => anim.finish()))
  await page.screenshot({ path: join(shotDir, `${name}.png`), fullPage: true })
  console.log(`SHOT: ${name}.png`)
}

async function screen(page, name) {
  await page.waitForSelector(`[data-screen="${name}"]`)
  const kids = await page.locator('#app').evaluate((node) => node.childElementCount)
  if (!kids) throw new Error(`#app was empty on ${name}`)
  const text = await page.locator(`[data-screen="${name}"]`).innerText()
  if (!text.trim()) throw new Error(`${name} rendered blank`)
}

let browser
try {
  let up = false
  for (let i = 0; i < 40 && !up; i += 1) {
    try {
      up = (await fetch(`${BASE}/health`)).status === 200
    } catch { /* retry */ }
    if (!up) await sleep(100)
  }
  if (!up) throw new Error(`server did not start: ${log.slice(0, 400)}`)

  browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
  page.setDefaultTimeout(15000)
  page.on('pageerror', (err) => { throw new Error(`PAGEERROR: ${err.message}`) })

  await page.goto(`${BASE}/`)
  await page.getByLabel('Work email').fill(EMAIL)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Enter desk' }).click()
  await screen(page, 'home')
  const navText = await page.locator('#sidebar').evaluate((node) => node.textContent || '')
  for (const label of ['Home', 'Jobs', 'Quotes', 'Quick BD', 'Approvals', 'Mail', 'Finance', 'Report', 'Invoices', 'Suppliers', 'Materials', 'Live Monitor', 'Calendar', 'Workers', 'Company files']) {
    if (!navText.includes(label)) throw new Error(`nav missing ${label}`)
  }
  await shot(page, '01-home')

  await nav(page, 'Report').click()
  await screen(page, 'report')
  const emptyReport = await page.locator('[data-screen="report"]').innerText()
  if (!emptyReport.includes('No live jobs yet.')) throw new Error(`report empty state: ${emptyReport}`)
  if (emptyReport.includes('£0')) throw new Error('empty report shows a zero')
  await shot(page, '02-report-empty')

  await nav(page, 'Jobs').click()
  await screen(page, 'jobs')
  await page.getByRole('button', { name: 'Add job' }).first().click()
  await page.getByLabel('Job name').fill('Hexham fit-out')
  await page.getByLabel('Client').fill('Weird Fish')
  await page.getByLabel('Site address').fill('Hexham town centre')
  await page.getByLabel('Contract sum').fill('100000')
  await page.getByLabel('Status').selectOption('live')
  await page.getByLabel('Start date').fill('06/10/2026')
  await page.getByRole('button', { name: 'Save job' }).click()
  await screen(page, 'job')
  await shot(page, '03-job')

  await nav(page, 'Jobs').click()
  await page.getByRole('button', { name: 'Add job' }).first().click()
  await page.getByLabel('Job name').fill('Quoted shed')
  await page.getByLabel('Client').fill('Shed Co')
  await page.getByLabel('Site address').fill('Yard')
  await page.getByLabel('Contract sum').fill('5000')
  await page.getByLabel('Status').selectOption('quoted')
  await page.getByRole('button', { name: 'Save job' }).click()
  await screen(page, 'job')

  await nav(page, 'Jobs').click()
  await screen(page, 'jobs')
  await page.getByRole('link', { name: 'Hexham fit-out' }).waitFor()
  await shot(page, '04-jobs')

  await nav(page, 'Quotes').click()
  await screen(page, 'quotes')
  await page.getByRole('button', { name: 'Add quote' }).first().click()
  await page.getByLabel('Quote title').fill('Iford fire reinstatement')
  await page.getByLabel('Client').fill('Iford')
  await page.getByLabel('Site address').fill('Iford lane')
  await page.getByLabel('Net').fill('26000')
  await page.getByRole('button', { name: 'Save quote' }).click()
  await screen(page, 'quote')
  await page.getByRole('button', { name: 'Send' }).click()
  await page.locator('[data-send-result]').getByText('not sent', { exact: true }).waitFor()
  await shot(page, '05-quotes')

  await nav(page, 'Quick BD').click()
  await screen(page, 'tenders')
  await page.getByRole('button', { name: 'Add tender' }).first().click()
  await page.getByLabel('Tender title').fill('Hexham tender')
  await page.getByLabel('Client').fill('Weird Fish')
  await page.getByLabel('Due date').fill('20/11/2026')
  await page.getByLabel('Job').selectOption({ label: 'Hexham fit-out' })
  await page.getByRole('button', { name: 'Save tender' }).click()
  await screen(page, 'tender')
  await shot(page, '06-tenders')

  await nav(page, 'Approvals').click()
  await screen(page, 'approvals')
  await shot(page, '07-approvals')

  await nav(page, 'Mail').click()
  await screen(page, 'mail')
  await page.getByRole('button', { name: 'Log a message' }).first().click()
  await page.getByLabel('Subject').fill('Site access')
  await page.getByLabel('From').fill('agent@example.com')
  await page.getByLabel('Message').fill('Gate code is on the board.')
  await page.getByRole('button', { name: 'Save message' }).click()
  await screen(page, 'mail-thread')
  await page.getByLabel('Reply').fill('Thanks, we have it.')
  await page.getByRole('button', { name: 'Save draft reply' }).click()
  await page.locator('[data-send-result]').getByText('not sent', { exact: true }).waitFor()
  await shot(page, '08-mail')

  await nav(page, 'Finance').click()
  await screen(page, 'statements')
  const finance = await page.locator('[data-screen="statements"]').innerText()
  if (!finance.includes('£100,000.00')) throw new Error(`finance missing the live margin: ${finance}`)
  if (!finance.includes('No credit notes yet.')) throw new Error('finance credit list missing')
  await shot(page, '09-finance')

  await nav(page, 'Site').click()
  await screen(page, 'site')
  await page.getByLabel('Site note').fill('Scaffold stays until Friday.')
  await page.getByRole('button', { name: 'Add site note' }).click()
  await page.getByText('Scaffold stays until Friday.').waitFor()
  await shot(page, '10-site')

  await nav(page, 'Live Monitor').click()
  await screen(page, 'monitor')
  await page.getByText('Hexham fit-out').waitFor()
  const monitor = await page.locator('[data-screen="monitor"]').innerText()
  if (monitor.includes('Quoted shed')) throw new Error('monitor listed a quoted job')
  await shot(page, '11-monitor')

  await nav(page, 'Calendar').click()
  await screen(page, 'calendar')
  await page.getByText('06/10/2026').waitFor()
  await shot(page, '12-calendar')

  await nav(page, 'Monday').click()
  await screen(page, 'monday')
  const monday = await page.locator('[data-total-margin]').innerText()
  if (!monday.includes('£100,000.00')) throw new Error(`monday total ${monday}`)
  await shot(page, '13-monday')

  await nav(page, 'Report').click()
  await screen(page, 'report')
  const report = await page.locator('[data-screen="report"]').innerText()
  if (!report.includes('Hexham fit-out') || !report.includes('£100,000.00')) throw new Error(`report did not match the job: ${report}`)
  if (report.includes('Quoted shed')) throw new Error('report included a quoted job')
  const reportTotal = await page.locator('[data-report-total]').innerText()
  if (reportTotal !== monday) throw new Error(`report ${reportTotal} did not match Monday ${monday}`)
  await shot(page, '14-report')

  await nav(page, 'Jobs').click()
  await page.getByRole('link', { name: 'Hexham fit-out' }).click()
  await page.getByRole('button', { name: 'Create invoice' }).click()
  await page.waitForSelector('[data-invoice-number="INV-0001"]')
  await page.getByRole('button', { name: 'Mark issued' }).click()
  await page.getByText('This invoice is issued. Credit it to change the lines.').waitFor()
  await page.getByRole('button', { name: 'Send' }).click()
  await page.locator('[data-send-result]').getByText('not sent', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Credit' }).click()
  await screen(page, 'credit')
  await page.getByText('CN-0001').waitFor()
  const creditText = await page.locator('[data-screen="credit"]').innerText()
  if (!creditText.includes('£120,000.00') || !creditText.includes('unchanged')) throw new Error(`credit note ${creditText}`)
  if (creditText.includes('Credit refused')) throw new Error('credit still refuses')
  await shot(page, '15-credit-note')
  await page.getByRole('link', { name: 'Print view' }).click()
  await screen(page, 'credit-print')
  const printed = await page.locator('[data-screen="credit-print"]').innerText()
  for (const need of ['Treun Roc Contracts Ltd', 'CREDIT NOTE', 'CN-0001', 'Hexham town centre', 'Total']) {
    if (!printed.includes(need)) throw new Error(`credit print missing ${need}`)
  }
  await shot(page, '16-credit-print')

  await nav(page, 'Finance').click()
  await screen(page, 'statements')
  const financeAfter = await page.locator('[data-finance-total]').innerText()
  if (!financeAfter.includes('£100,000.00')) throw new Error(`credit note moved finance: ${financeAfter}`)
  await page.getByRole('link', { name: 'CN-0001' }).waitFor()

  await nav(page, 'Suppliers').click()
  await screen(page, 'suppliers')
  await page.getByLabel('Supplier name').fill('Jewson')
  await page.getByLabel('Supplier phone').fill('01923 000000')
  await page.getByRole('button', { name: 'Add supplier' }).click()
  await page.getByRole('heading', { name: 'Jewson' }).waitFor()
  await page.getByLabel('Bill net').fill('80')
  await page.getByRole('button', { name: 'Add bill' }).click()
  await page.getByText('£96.00').waitFor()
  await shot(page, '17-suppliers')

  await nav(page, 'Supplier bills').click()
  await screen(page, 'bills')
  await page.getByText('Jewson').waitFor()
  await shot(page, '18-supplier-bills')

  await nav(page, 'Materials').click()
  await screen(page, 'materials')
  await page.getByLabel('Material name').fill('Softwood')
  await page.getByLabel('Unit').fill('m')
  await page.getByLabel('Catalogue price').fill('12.50')
  await page.getByLabel('Stock quantity').fill('40')
  await page.getByRole('button', { name: 'Add material' }).click()
  await page.getByRole('cell', { name: 'Softwood' }).waitFor()
  await page.getByLabel('Order supplier').fill('North timber')
  await page.getByLabel('Order job').selectOption({ label: 'Hexham fit-out' })
  await page.getByLabel('Order material').selectOption({ label: 'Softwood' })
  await page.getByLabel('Order quantity').fill('2')
  await page.getByRole('button', { name: 'Add purchase order' }).click()
  await page.getByText('PO-0001').waitFor()
  await page.getByRole('link', { name: 'Hexham fit-out' }).waitFor()
  await shot(page, '19-materials')
  await page.reload()
  await screen(page, 'materials')
  await page.getByRole('cell', { name: 'Softwood' }).waitFor()
  await page.getByText('PO-0001').waitFor()
  await page.locator('[data-stock]').getByText('40', { exact: true }).waitFor()
  await shot(page, '20-materials-refresh')

  await nav(page, 'Jobs').click()
  await page.getByRole('link', { name: 'Hexham fit-out' }).click()
  const still = await page.locator('[data-margin]').innerText()
  if (!still.includes('£100,000.00')) throw new Error(`purchase order moved the margin: ${still}`)
  await page.getByText('PO-0001').waitFor()

  await nav(page, 'Workers').click()
  await screen(page, 'workers')
  await page.getByLabel('Name').fill('Sam Carter')
  await page.getByLabel('Trade').fill('Joiner')
  await page.getByLabel('CIS or PAYE').selectOption('CIS')
  await page.getByRole('button', { name: 'Add worker' }).click()
  await page.getByRole('heading', { name: 'Sam Carter' }).waitFor()
  await shot(page, '21-workers')

  await nav(page, 'Jobs').click()
  await page.getByRole('link', { name: 'Hexham fit-out' }).click()
  await page.setInputFiles('#job-file', join(tmp, 'site-note.txt'))
  await page.getByRole('button', { name: 'Add document' }).click()
  await page.getByText('site-note.txt').waitFor()
  await nav(page, 'Company files').click()
  await screen(page, 'files')
  await page.getByText('site-note.txt').waitFor()
  await shot(page, '22-files')

  await nav(page, 'Client view').click()
  await screen(page, 'client')
  await shot(page, '23-client')

  await page.getByRole('button', { name: 'TR Bot' }).click()
  await page.getByLabel('Note').fill('Need the Iford job on the board.')
  await page.getByRole('button', { name: 'Hand off' }).click()
  await page.getByText('Handed off').waitFor()
  await shot(page, '24-bot')

  await nav(page, 'Invoices').click()
  await page.getByRole('link', { name: 'INV-0001' }).click()
  await page.getByRole('button', { name: 'Credit' }).click()
  await screen(page, 'credit')
  await page.getByText('CN-0001').waitFor()
  await page.reload()
  await page.getByText('CN-0001').waitFor()
  await shot(page, '25-credit-refresh')

  await nav(page, 'Home').click()
  await screen(page, 'home')
  await shot(page, '26-home-after')
  console.log('COMPLETE BROWSER PASS')
} catch (err) {
  console.error(err?.message || err)
  if (log) console.error(log.slice(0, 800))
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  if (!child.killed) child.kill('SIGTERM')
}
