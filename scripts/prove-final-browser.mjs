#!/usr/bin/env node
/**
 * Finger checks for supplier links, Quick BD, and mailbox mode.
 * Screenshots land in qa/final-links-2026-10-05.
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

const PASSWORD = 'ProveFinal-browser!'
const EMAIL = 'final-browser@treunroc.com'
const PORT = Number(process.env.PROVE_FINAL_BROWSER_PORT || 18795)
const BASE = `http://127.0.0.1:${PORT}`
const tmp = join(tmpdir(), `tr-final-browser-${process.pid}`)
mkdirSync(tmp, { recursive: true })
const usersFile = join(tmp, 'users.json')
let shotDir = join(REPO, 'qa', 'final-links-2026-10-05')
try {
  mkdirSync(shotDir, { recursive: true })
} catch {
  shotDir = '/tmp/tr-prove-shots'
  mkdirSync(shotDir, { recursive: true })
}
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

const { salt, hash } = store.hashPassword(PASSWORD)
writeFileSync(usersFile, JSON.stringify({
  users: [{ email: EMAIL, name: 'Alex Office', role: 'OFFICE', tenantId: 'treunroc', salt, hash }],
}, null, 2))

function serverEnv(extra = {}) {
  return {
    ...process.env,
    PORT: String(PORT),
    HOST: '127.0.0.1',
    STAFF_AUTH_USERS: usersFile,
    DATA_DIR: tmp,
    SESSIONS_PATH: join(tmp, 'sessions.json'),
    DESK_STORE_PATH: join(tmp, 'desk.json'),
    TR_BOT_THREADS_PATH: join(tmp, 'tr-bot-threads.json'),
    CORS_ORIGIN: '*',
    ...extra,
  }
}

function startServer(extra) {
  const child = spawn(process.execPath, [join(ROOT, 'src/server.js')], {
    cwd: ROOT,
    env: serverEnv(extra),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  child.stdout.on('data', (d) => { log += d })
  child.stderr.on('data', (d) => { log += d })
  child.buffer = () => log
  return child
}

async function waitUp(child) {
  let up = false
  for (let i = 0; i < 40 && !up; i += 1) {
    try {
      up = (await fetch(`${BASE}/health`)).status === 200
    } catch { /* retry */ }
    if (!up) await sleep(100)
  }
  if (!up) throw new Error(`server did not start: ${child.buffer().slice(0, 400)}`)
}

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
  const text = await page.locator(`[data-screen="${name}"]`).innerText()
  if (!text.trim()) throw new Error(`${name} rendered blank`)
}

let child = startServer()
let browser
try {
  await waitUp(child)
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

  await nav(page, 'Jobs').click()
  await page.getByRole('button', { name: 'Add job' }).first().click()
  await page.getByLabel('Job name').fill('Hexham fit-out')
  await page.getByLabel('Client').fill('Weird Fish')
  await page.getByLabel('Site address').fill('Hexham town centre')
  await page.getByLabel('Contract sum').fill('100000')
  await page.getByLabel('Status').selectOption('live')
  await page.getByRole('button', { name: 'Save job' }).click()
  await screen(page, 'job')

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
  await page.locator('[data-po]').getByRole('link', { name: 'North timber' }).click()
  await screen(page, 'supplier')
  await page.getByRole('heading', { name: 'North timber' }).waitFor()
  await page.getByRole('link', { name: 'PO-0001' }).waitFor()
  await page.getByRole('link', { name: 'Hexham fit-out' }).waitFor()
  await shot(page, '01-supplier-from-po')

  await nav(page, 'Suppliers').click()
  await screen(page, 'suppliers')
  await page.getByRole('link', { name: 'North timber' }).click()
  await screen(page, 'supplier')
  await page.getByLabel('Bill date').fill('05/10/2026')
  await page.getByLabel('Bill reference').fill('NT-1')
  await page.getByLabel('Bill net').fill('10')
  await page.getByRole('button', { name: 'Add bill' }).click()
  await page.getByText('05/10/2026').waitFor()
  await page.getByText('NT-1').waitFor()
  await page.getByText('£12.00').waitFor()
  await page.reload()
  await screen(page, 'supplier')
  const supplierText = await page.locator('[data-screen="supplier"]').innerText()
  for (const need of ['North timber', '05/10/2026', 'NT-1', '£12.00', 'PO-0001']) {
    if (!supplierText.includes(need)) throw new Error(`supplier detail missing ${need}`)
  }
  await shot(page, '02-supplier-detail-refresh')

  await nav(page, 'Jobs').click()
  await page.getByRole('link', { name: 'Hexham fit-out' }).click()
  await page.locator('[data-job-po]').getByRole('link', { name: 'North timber' }).waitFor()
  await page.locator('[data-job-po]').getByRole('link', { name: 'PO-0001' }).click()
  await screen(page, 'materials')
  await page.locator('[data-po-focus="1"]').waitFor()
  await page.locator('[data-po-focus="1"]').getByRole('link', { name: 'Hexham fit-out' }).waitFor()
  await page.locator('[data-po-focus="1"]').getByRole('link', { name: 'North timber' }).waitFor()
  await shot(page, '03-materials-po-links')

  await page.goto(`${BASE}/#/suppliers/missing-supplier`)
  await screen(page, 'supplier')
  await page.getByText('That supplier is not on the desk.').waitFor()

  await nav(page, 'Quotes').click()
  await page.getByRole('button', { name: 'Add quote' }).first().click()
  await page.getByLabel('Quote title').fill('Hexham gate quote')
  await page.getByLabel('Client').fill('Weird Fish')
  await page.getByLabel('Site address').fill('Hexham town centre')
  await page.getByLabel('Net').fill('4000')
  await page.getByRole('button', { name: 'Save quote' }).click()
  await screen(page, 'quote')

  await nav(page, 'Quick BD').click()
  await screen(page, 'tenders')
  await page.getByText('not an external bid portal').waitFor()
  await page.getByRole('button', { name: 'Add tender' }).first().click()
  await page.getByLabel('Tender title').fill('Gate tender')
  await page.getByLabel('Client').fill('Weird Fish')
  await page.getByLabel('Due date').fill('20/11/2026')
  await page.getByLabel('Note').fill('Bring the key.')
  await page.getByLabel('Quote').selectOption({ label: 'Q-0001' })
  await page.getByRole('button', { name: 'Save tender' }).click()
  await screen(page, 'tender')
  await page.getByRole('button', { name: 'Create job' }).click()
  await page.getByRole('link', { name: 'Gate tender' }).waitFor()
  await page.getByRole('link', { name: 'Q-0001' }).waitFor()
  await page.reload()
  await screen(page, 'tender')
  if ((await page.getByLabel('Tender title').inputValue()) !== 'Gate tender') throw new Error('tender title did not survive refresh')
  if ((await page.getByLabel('Client').inputValue()) !== 'Weird Fish') throw new Error('tender client did not survive refresh')
  if ((await page.getByLabel('Status').inputValue()) !== 'won') throw new Error('tender status did not survive refresh')
  if ((await page.getByLabel('Due date').inputValue()) !== '20/11/2026') throw new Error('tender due date did not survive refresh')
  if (!(await page.getByLabel('Note').inputValue()).includes('Bring the key.')) throw new Error('tender note did not survive refresh')
  await page.getByRole('link', { name: 'Gate tender' }).click()
  await screen(page, 'job')
  await page.locator('[data-status="quoted"]').waitFor()
  await page.locator('[data-job-tenders]').getByRole('link', { name: 'Gate tender' }).click()
  await screen(page, 'tender')
  await page.getByRole('link', { name: 'Q-0001' }).click()
  await screen(page, 'quote')
  await page.locator('[data-quote-tenders]').getByRole('link', { name: 'Gate tender' }).waitFor()
  await shot(page, '04-tender-won-links')

  await nav(page, 'Quick BD').click()
  await page.getByRole('button', { name: 'Add tender' }).first().click()
  await page.getByLabel('Tender title').fill('Yard lost')
  await page.getByLabel('Client').fill('Shed Co')
  await page.getByLabel('Status').selectOption('lost')
  await page.getByLabel('Due date').fill('01/12/2026')
  await page.getByLabel('Note').fill('Not this time.')
  await page.getByLabel('Job').selectOption({ label: 'Gate tender' })
  await page.getByRole('button', { name: 'Save tender' }).click()
  await screen(page, 'tender')
  await page.getByText('Lost. The quote and job links stay on this tender.').waitFor()
  await page.reload()
  await page.getByRole('link', { name: 'Gate tender' }).waitFor()
  await page.getByText('Lost. The quote and job links stay on this tender.').waitFor()
  await shot(page, '05-tender-lost')

  await nav(page, 'Mail').click()
  await screen(page, 'mail')
  await page.getByText('Mailbox not connected — set GRAPH_… on the host').waitFor()
  await page.getByRole('button', { name: 'Log a message' }).first().click()
  await page.getByLabel('Subject').fill('Manual gate note')
  await page.getByLabel('From').fill('agent@example.com')
  await page.getByLabel('Message').fill('Logged by staff.')
  await page.getByRole('button', { name: 'Save message' }).click()
  await screen(page, 'mail-thread')
  await page.getByLabel('Reply').fill('Thanks, we have it.')
  await page.getByRole('button', { name: 'Save draft reply' }).click()
  await page.locator('[data-send-result]').getByText('not sent', { exact: true }).waitFor()
  await nav(page, 'Mail').click()
  await page.getByText('Mailbox not connected — set GRAPH_… on the host').waitFor()
  await page.getByRole('link', { name: 'Manual gate note' }).waitFor()
  await shot(page, '06-mail-disconnected')

  await new Promise((resolve) => {
    child.once('exit', resolve)
    child.kill('SIGTERM')
  })
  await sleep(200)
  child = startServer({
    GRAPH_MAIL_FIXTURE: fixtureFile,
    GRAPH_MAILBOX: 'office@treunroccontracts.com',
  })
  await waitUp(child)
  await page.reload()
  await screen(page, 'mail')
  const inbox = page.locator('[data-mail]', { hasText: 'Hexham fit-out delivery' })
  await inbox.getByRole('link', { name: 'Hexham fit-out delivery', exact: true }).waitFor()
  await inbox.getByText('yard@example.com').waitFor()
  await inbox.getByRole('link', { name: 'Hexham fit-out', exact: true }).waitFor()
  const mailText = await page.locator('[data-screen="mail"]').innerText()
  if (mailText.includes('Mailbox not connected')) throw new Error('fixture mail still shows the disconnected banner')
  if (!mailText.includes('Manual gate note')) throw new Error('manual log disappeared when the mailbox connected')
  await page.reload()
  await page.getByRole('link', { name: 'Hexham fit-out delivery', exact: true }).waitFor()
  await shot(page, '07-mail-fixture')
  console.log('FINAL BROWSER PASS')
} catch (err) {
  console.error(err?.message || err)
  if (child) console.error(child.buffer().slice(0, 800))
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  if (child && !child.killed) child.kill('SIGTERM')
}
