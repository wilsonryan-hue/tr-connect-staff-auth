#!/usr/bin/env node
/**
 * Finger checks for the full staff desk. Screenshots land in qa/full-desk-2026-10-05.
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

const PASSWORD = 'ProveFull-browser!'
const EMAIL = 'full-browser@treunroc.com'
const PORT = Number(process.env.PROVE_FULL_BROWSER_PORT || 18791)
const BASE = `http://127.0.0.1:${PORT}`
const tmp = join(tmpdir(), `tr-full-browser-${process.pid}`)
mkdirSync(tmp, { recursive: true })
const usersFile = join(tmp, 'users.json')
let shotDir = join(REPO, 'qa', 'full-desk-2026-10-05')
try {
  mkdirSync(shotDir, { recursive: true })
} catch {
  shotDir = '/tmp/tr-prove-shots'
  mkdirSync(shotDir, { recursive: true })
}
writeFileSync(join(tmp, 'rear-yard.txt'), 'rear yard sketch')

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
  const side = await page.locator('#sidebar').boundingBox()
  if (!side || side.width < 180) throw new Error(`sidebar missing at 1100px: ${JSON.stringify(side)}`)
  if ((await nav(page, 'Home').getAttribute('aria-current')) !== 'page') throw new Error('Home is not the active nav item')
  const navText = await page.locator('#sidebar').evaluate((node) => node.textContent || '')
  for (const label of ['Desk', 'Money', 'Site']) {
    if (!navText.includes(label)) throw new Error(`nav missing ${label}`)
  }
  await shot(page, '01-home')

  await nav(page, 'Jobs').click()
  await screen(page, 'jobs')
  await page.getByText('No jobs yet.').waitFor()
  await page.getByRole('button', { name: 'Add job' }).first().click()
  await page.getByLabel('Job name').fill('Hexham fit-out')
  await page.getByLabel('Client').fill('Weird Fish')
  await page.getByLabel('Site address').fill('Hexham town centre')
  await page.getByLabel('Contract sum').fill('100000')
  await page.getByLabel('Status').selectOption('live')
  await page.getByLabel('Start date').fill('06/10/2026')
  await page.getByLabel('Notes').fill('Access from the rear yard.')
  await page.getByRole('button', { name: 'Save job' }).click()
  await screen(page, 'job')
  await page.getByText('Access from the rear yard.').waitFor()
  await page.reload()
  await page.getByText('Access from the rear yard.').waitFor()
  await page.locator('[data-status="live"]').waitFor()
  await shot(page, '02-job-file')

  await page.getByLabel('Variation amount').fill('10000')
  await page.getByLabel('Approved').check()
  await page.getByRole('button', { name: 'Add variation' }).click()
  await page.getByText('£10,000.00').first().waitFor()
  await page.getByLabel('Cost amount').fill('40000')
  await page.getByRole('button', { name: 'Add cost' }).click()
  await page.locator('[data-margin]').getByText('£70,000.00').waitFor()
  await page.getByLabel('Cost amount').fill('5000')
  await page.getByLabel('Cost mark').selectOption('Ryan')
  await page.getByRole('button', { name: 'Add cost' }).click()
  await page.locator('[data-review]').getByText('£5,000.00').waitFor()
  const margin = await page.locator('[data-margin]').innerText()
  if (!margin.includes('£70,000.00') || !margin.includes('63.6')) throw new Error(`margin was ${margin}`)

  await nav(page, 'Jobs').click()
  await screen(page, 'jobs')
  await page.locator('[data-board]').waitFor()
  await page.getByRole('link', { name: 'Hexham fit-out' }).waitFor()
  await shot(page, '03-jobs-board')
  await page.reload()
  await page.getByRole('link', { name: 'Hexham fit-out' }).waitFor()

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
  const quoteDraft = await page.locator('[data-draft]').inputValue()
  if (!quoteDraft.includes('QUOTE DRAFT') || !quoteDraft.includes('not sent')) throw new Error('quote draft missing')
  await shot(page, '04-quote-not-sent')
  await page.getByRole('button', { name: 'Accept' }).click()
  await screen(page, 'job')
  await page.getByText('Iford fire reinstatement').first().waitFor()
  if ((await page.locator('[data-status]').first().innerText()) !== 'Quoted') throw new Error('accepted quote did not open a quoted job')

  await nav(page, 'Quick BD').click()
  await screen(page, 'tenders')
  await page.getByRole('button', { name: 'Add tender' }).first().click()
  await page.getByLabel('Tender title').fill('Hexham tender')
  await page.getByLabel('Client').fill('Weird Fish')
  await page.getByLabel('Due date').fill('20/11/2026')
  await page.getByLabel('Job').selectOption({ label: 'Hexham fit-out' })
  await page.getByRole('button', { name: 'Save tender' }).click()
  await screen(page, 'tender')
  await page.getByRole('link', { name: 'Hexham fit-out' }).waitFor()
  await shot(page, '05-tender')

  await nav(page, 'Approvals').click()
  await screen(page, 'approvals')
  await page.getByRole('button', { name: 'Approve into review' }).click()
  await page.getByText('No lines are in review allocation.').waitFor({ state: 'detached' })
  await page.locator('[data-allocation]').getByText('£5,000.00').waitFor()
  if (await page.getByRole('button', { name: /allocat/i }).count()) throw new Error('allocation button is on the desk')
  await shot(page, '06-approvals')
  await nav(page, 'Jobs').click()
  await page.getByRole('link', { name: 'Hexham fit-out' }).click()
  const still = await page.locator('[data-margin]').innerText()
  if (!still.includes('£70,000.00')) throw new Error(`approval moved the margin: ${still}`)

  await nav(page, 'Mail').click()
  await screen(page, 'mail')
  await page.getByRole('button', { name: 'Log a message' }).first().click()
  await page.getByLabel('Subject').fill('Site access')
  await page.getByLabel('From').fill('agent@example.com')
  await page.getByLabel('Message').fill('Gate code is on the board.')
  await page.getByRole('button', { name: 'Save message' }).click()
  await screen(page, 'mail-thread')
  await page.getByRole('button', { name: 'Mark read' }).click()
  await page.getByText('Read', { exact: true }).waitFor()
  await page.getByLabel('Reply').fill('Thanks, we have it.')
  await page.getByRole('button', { name: 'Save draft reply' }).click()
  await page.locator('[data-send-result]').getByText('not sent', { exact: true }).waitFor()
  await shot(page, '07-mail')

  await nav(page, 'Finance').click()
  await screen(page, 'statements')
  const finance = await page.locator('[data-screen="statements"]').innerText()
  if (!finance.includes('Hexham fit-out') || !finance.includes('£70,000.00')) throw new Error(`finance did not match the job: ${finance}`)
  if (!finance.includes('£5,000.00') || !finance.includes('Not in the margin.')) throw new Error('review pile missing on finance')
  await shot(page, '08-finance')

  await nav(page, 'Jobs').click()
  await page.getByRole('link', { name: 'Hexham fit-out' }).click()
  await page.getByRole('button', { name: 'Create invoice' }).click()
  await page.waitForSelector('[data-invoice-number="INV-0001"]')
  await page.getByRole('link', { name: 'Print view' }).click()
  await screen(page, 'print')
  const printText = await page.locator('[data-screen="print"]').innerText()
  for (const need of ['Treun Roc Contracts Ltd', 'Hexham town centre', 'Total']) {
    if (!printText.includes(need)) throw new Error(`print missing ${need}`)
  }
  await shot(page, '09-print')
  await page.getByRole('link', { name: 'Back to invoice' }).click()
  await page.getByRole('button', { name: 'Mark issued' }).click()
  await page.getByText('This invoice is issued. Credit it to change the lines.').waitFor()
  await page.getByRole('button', { name: 'Credit' }).click()
  await page.waitForSelector('[data-screen="credit"]')
  await page.getByText('CN-0001').waitFor()
  const creditText = await page.locator('[data-screen="credit"]').innerText()
  if (!creditText.includes('£120,000.00')) throw new Error(`credit note missing the invoice gross: ${creditText}`)
  if (!creditText.includes('unchanged')) throw new Error('credit note does not say the invoice stays unchanged')
  await page.getByRole('link', { name: 'Print view' }).click()
  await screen(page, 'credit-print')
  const creditPrint = await page.locator('[data-screen="credit-print"]').innerText()
  for (const need of ['Treun Roc Contracts Ltd', 'CREDIT NOTE', 'CN-0001', 'Hexham town centre', 'Total']) {
    if (!creditPrint.includes(need)) throw new Error(`credit print missing ${need}`)
  }
  await shot(page, '10-credit-note')

  await nav(page, 'Live Monitor').click()
  await screen(page, 'monitor')
  await page.locator('[data-on-site-job]').getByText('Hexham fit-out').waitFor()
  await shot(page, '11-monitor')

  await nav(page, 'Workers').click()
  await screen(page, 'workers')
  if (await page.locator('input[type="file"]').count()) throw new Error('passport file input is on workers')
  await page.getByLabel('Name').fill('Sam Carter')
  await page.getByLabel('Trade').fill('Joiner')
  await page.getByLabel('Phone').fill('07700900123')
  await page.getByLabel('CIS or PAYE').selectOption('CIS')
  await page.getByLabel('Ticket expiry').fill('01/01/2020')
  await page.getByRole('button', { name: 'Add worker' }).click()
  await page.getByRole('heading', { name: 'Sam Carter' }).waitFor()
  await page.getByText('Ticket expired').waitFor()
  await page.reload()
  await page.getByText('Ticket expired').waitFor()
  await shot(page, '12-worker')

  await nav(page, 'Jobs').click()
  await page.getByRole('link', { name: 'Hexham fit-out' }).click()
  await page.getByLabel('Worker').selectOption({ label: 'Sam Carter' })
  await page.getByRole('button', { name: 'Attach worker' }).click()
  await page.locator('[data-ticket-flag]').waitFor()
  await page.getByLabel('Hours for').selectOption({ label: 'Sam Carter' })
  await page.locator('#hours-qty').fill('7.5')
  await page.getByRole('button', { name: 'Add hours' }).click()
  await page.getByText('7.5h').waitFor()
  await page.getByLabel('Site note').fill('Scaffold stays until Friday.')
  await page.getByRole('button', { name: 'Add site note' }).click()
  await page.getByText('Scaffold stays until Friday.').waitFor()
  await page.setInputFiles('#job-file', join(tmp, 'rear-yard.txt'))
  await page.getByRole('button', { name: 'Add document' }).click()
  await page.getByText('rear-yard.txt').waitFor()
  await shot(page, '13-job-hours-file')

  await nav(page, 'Site').click()
  await screen(page, 'site')
  await page.getByText('Scaffold stays until Friday.').waitFor()
  await shot(page, '14-site')

  await nav(page, 'Calendar').click()
  await screen(page, 'calendar')
  await page.getByText('06/10/2026').waitFor()
  await page.getByRole('link', { name: 'Hexham fit-out' }).waitFor()
  await shot(page, '15-calendar')

  await nav(page, 'Company files').click()
  await screen(page, 'files')
  await page.getByText('rear-yard.txt').waitFor()
  await shot(page, '16-files')

  await page.getByRole('button', { name: 'TR Bot' }).click()
  await page.getByLabel('Note').fill('Need the Iford job on the board.')
  await page.getByRole('button', { name: 'Hand off' }).click()
  await page.locator('[data-bot-state]').getByText('Handed off').waitFor()
  await shot(page, '17-bot-handed-off')

  await nav(page, 'Home').click()
  await screen(page, 'home')
  const home = await page.locator('[data-screen="home"]').innerText()
  if (!home.includes('Hexham fit-out') || !home.includes('£70,000.00')) throw new Error(`home pulse missing live job: ${home}`)
  if (!home.includes('Needs you') || !home.includes('On site')) throw new Error('home is not the ops hub')
  await page.reload()
  await page.getByRole('link', { name: 'Hexham fit-out' }).waitFor()
  await page.locator('[data-home-margin]').getByText('£70,000.00').waitFor()
  await shot(page, '18-home-after-refresh')

  await page.setViewportSize({ width: 390, height: 844 })
  await shot(page, '19-home-mobile')
  const narrow = await page.locator('#sidebar').boundingBox()
  if (narrow && narrow.height > 40 && await page.locator('#sidebar').evaluate((node) => getComputedStyle(node).display !== 'none')) {
    throw new Error('sidebar stayed open on a phone width')
  }

  console.log('FULL BROWSER PASS')
} catch (err) {
  console.error(`FULL BROWSER FAIL: ${err?.message || err}`)
  if (log) console.error(log.slice(-800))
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  if (!child.killed) child.kill('SIGTERM')
}
