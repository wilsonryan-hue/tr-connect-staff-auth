#!/usr/bin/env node
/**
 * Finger check: phone install page and the gated client portal stub.
 * Screenshots land in qa/pwa-portal-2026-10-05.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright-core'
import { raster } from './render-tr-mark.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const REPO = join(ROOT, '..', '..')
const store = await import(pathToFileURL(join(ROOT, 'src/store.js')).href)

const PASSWORD = 'ProvePhone-portal!'
const EMAIL = 'phone-portal@treunroc.com'
const PORT = Number(process.env.PROVE_PHONE_PORT || 18796)
const BASE = `http://127.0.0.1:${PORT}`
const tmp = join(tmpdir(), `tr-phone-portal-${process.pid}`)
mkdirSync(tmp, { recursive: true })
const usersFile = join(tmp, 'users.json')
const shotDir = join(REPO, 'qa', 'pwa-portal-2026-10-05')
mkdirSync(shotDir, { recursive: true })

const { salt, hash } = store.hashPassword(PASSWORD)
writeFileSync(usersFile, JSON.stringify({
  users: [{ email: EMAIL, name: 'Alex Office', role: 'OFFICE', tenantId: 'treunroc', salt, hash }],
}, null, 2))

const failures = []
function pass(msg) { console.log(`PASS ${msg}`) }
function fail(msg) { failures.push(msg); console.error(`FAIL ${msg}`) }

function pngSize(buf) {
  if (buf.length < 24 || buf[0] !== 0x89 || buf.toString('ascii', 1, 4) !== 'PNG') return null
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

function sha(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

const FORBIDDEN = /\b(cost|margin|marginpence|ryan2?|kacey|review allocation|contractsum|netpence)\b/i

function assertSafeStub(label, status, body, expect) {
  if (status !== expect.status) fail(`${label} status ${status}, expected ${expect.status}`)
  else pass(`${label} status ${status}`)
  if (!body || body.blocked !== true) fail(`${label} is not blocked`)
  if (body.gate !== expect.gate) fail(`${label} gate ${body?.gate}`)
  if (body.staffPreview !== false) fail(`${label} staffPreview is not false`)
  if (!Array.isArray(body.jobs) || body.jobs.length !== 0) fail(`${label} jobs are not empty`)
  if (!Array.isArray(body.invoices) || body.invoices.length !== 0) fail(`${label} invoices are not empty`)
  const keys = Object.keys(body).sort().join(',')
  if (keys !== 'blocked,error,gate,invoices,jobs,portal,staffPreview') fail(`${label} keys ${keys}`)
  const values = JSON.stringify({
    error: body.error,
    jobs: body.jobs,
    invoices: body.invoices,
    portal: body.portal,
    gate: body.gate,
  })
  if (FORBIDDEN.test(values)) fail(`${label} leaked private money copy`)
}

function startServer() {
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

async function shot(page, name) {
  await page.evaluate(() => document.getAnimations().forEach((anim) => anim.finish()))
  await page.screenshot({ path: join(shotDir, `${name}.png`), fullPage: true })
  console.log(`SHOT: ${name}.png`)
}

const pagesDoor = readFileSync(join(REPO, 'index.html'), 'utf8')
if (!pagesDoor.includes('noindex,nofollow')) fail('public Pages index lost noindex')
else pass('public Pages index still noindex')
if (pagesDoor.includes('/api/portal') || pagesDoor.includes('STAFF PREVIEW')) {
  fail('public Pages index gained portal or staff preview copy')
} else pass('public Pages index has no portal copy')

const live = readFileSync(join(REPO, 'live.json'), 'utf8')
if (live.includes('portal') || live.includes('icon-192')) fail('live.json was opened with phone or portal paths')
else pass('live.json has no phone or portal paths')

const child = startServer()
let browser
try {
  await waitUp(child)

  const manifestRes = await fetch(`${BASE}/manifest.webmanifest`)
  const manifestType = manifestRes.headers.get('content-type') || ''
  if (manifestRes.status !== 200) fail(`manifest status ${manifestRes.status}`)
  else if (!manifestType.includes('application/manifest+json')) fail(`manifest type ${manifestType}`)
  else pass('manifest served as application/manifest+json')
  const manifest = await manifestRes.json()
  if (manifest.name !== 'Treun Roc Connect') fail(`manifest name ${manifest.name}`)
  else pass('manifest name Treun Roc Connect')
  if (manifest.short_name !== 'TR Connect') fail(`manifest short_name ${manifest.short_name}`)
  else pass('manifest short name TR Connect')
  if (manifest.theme_color !== '#0c0b09' || manifest.background_color !== '#0c0b09') {
    fail(`theme ${manifest.theme_color} background ${manifest.background_color}`)
  } else pass('theme and background #0c0b09')
  const sizes = (manifest.icons || []).map((icon) => icon.sizes).sort().join(',')
  if (sizes !== '192x192,512x512') fail(`icon sizes ${sizes}`)
  else pass('manifest icons 192 and 512')

  for (const [file, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
    const res = await fetch(`${BASE}/${file}`)
    const buf = Buffer.from(await res.arrayBuffer())
    const dim = pngSize(buf)
    if (res.status !== 200 || res.headers.get('content-type') !== 'image/png') fail(`${file} not a png`)
    else if (!dim || dim.width !== size || dim.height !== size) fail(`${file} size ${dim && dim.width}`)
    else if (sha(buf) !== sha(raster(size))) fail(`${file} is not the TR mark`)
    else pass(`${file} ${size} from the TR mark`)
  }

  const desk = await fetch(`${BASE}/`)
  const deskHtml = await desk.text()
  if (!deskHtml.includes('rel="manifest" href="/manifest.webmanifest"')) fail('desk is missing the manifest link')
  else pass('desk links the manifest')
  if (!deskHtml.includes('rel="apple-touch-icon" href="/apple-touch-icon.png"')) fail('desk is missing the apple touch icon')
  else pass('desk links the apple touch icon')
  if (!deskHtml.includes('content="#0c0b09"')) fail('desk theme colour is not #0c0b09')
  else pass('desk theme colour #0c0b09')

  const installRes = await fetch(`${BASE}/install`)
  const installHtml = await installRes.text()
  if (installRes.status !== 200) fail(`install status ${installRes.status}`)
  if (!installHtml.includes('Add to Home Screen')) fail('install page misses Add to Home Screen')
  else pass('install page says Add to Home Screen')
  if (!installHtml.includes('data-install="safari"') || !installHtml.includes('Safari on iPhone or iPad')) {
    fail('install page misses Safari steps')
  } else pass('install page has Safari steps')
  if (!installHtml.includes('data-install="chrome"') || !installHtml.includes('Add to Home screen')) {
    fail('install page misses Chrome steps')
  } else pass('install page has Chrome steps')
  if (installHtml.includes('margin') || installHtml.includes('Ryan')) fail('install page has private money copy')
  else pass('install page has no money copy')

  const portalPaths = ['/api/portal', '/api/portal/jobs', '/api/portal/invoices', '/api/portal/me', '/api/portal/anything']
  for (const path of portalPaths) {
    const res = await fetch(`${BASE}${path}`)
    const body = await res.json()
    assertSafeStub(`unsigned ${path}`, res.status, body, { status: 401, gate: 'unsigned' })
  }
  const posted = await fetch(`${BASE}/api/portal`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  const postedBody = await posted.json()
  if (posted.status !== 405 || postedBody.error !== 'Client sign-in is not on this server.') {
    fail(`POST /api/portal ${posted.status} ${postedBody.error}`)
  } else pass('POST /api/portal refuses a client login')

  browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const desktop = await browser.newPage({ viewport: { width: 1100, height: 800 } })
  desktop.setDefaultTimeout(15000)
  desktop.on('pageerror', (err) => { throw new Error(`PAGEERROR: ${err.message}`) })

  await desktop.goto(`${BASE}/install`)
  await desktop.waitForSelector('[data-screen="install"]')
  const installText = await desktop.locator('[data-screen="install"]').innerText()
  if (!installText.includes('Add to Home Screen') || !installText.includes('Safari') || !installText.includes('Chrome')) {
    fail('install screen text is missing Safari or Chrome')
  } else pass('install screen shows Safari and Chrome')
  await shot(desktop, '01-install-desktop')

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } })
  phone.setDefaultTimeout(15000)
  phone.on('pageerror', (err) => { throw new Error(`PAGEERROR: ${err.message}`) })
  await phone.goto(`${BASE}/install`)
  await phone.waitForSelector('[data-install="safari"]')
  await shot(phone, '02-install-phone')

  await phone.goto(`${BASE}/portal`)
  await phone.waitForSelector('[data-screen="portal"][data-blocked="1"]')
  await phone.waitForFunction(() => {
    const el = document.querySelector('[data-portal-message]')
    return el && el.textContent.includes("Sign in to see this client's jobs.")
  })
  const portalText = await phone.locator('[data-screen="portal"]').innerText()
  if (/\bmargin\b|\bcost\b|\bRyan2\b|\bKacey\b|\bRyan\b/i.test(portalText)) fail('portal shell shows private money words')
  else pass('portal shell is blocked for an unsigned visitor')
  await shot(phone, '03-portal-blocked')

  await desktop.goto(`${BASE}/`)
  await desktop.getByLabel('Work email').fill(EMAIL)
  await desktop.getByLabel('Password').fill(PASSWORD)
  await desktop.getByRole('button', { name: 'Enter desk' }).click()
  await desktop.waitForSelector('[data-screen="home"]')
  await shot(desktop, '04-home-after-sign-in')
  await desktop.getByRole('navigation').getByRole('link', { name: 'Client view', exact: true }).click()
  await desktop.waitForSelector('[data-screen="client"]')
  const preview = await desktop.locator('[data-preview="STAFF PREVIEW"]').innerText()
  if (preview !== 'STAFF PREVIEW') fail(`client screen preview ${preview}`)
  else pass('staff #/client says STAFF PREVIEW')
  await shot(desktop, '05-client-staff-preview')

  const me = await desktop.evaluate(() => JSON.parse(localStorage.getItem('tr.desk.session') || '{}'))
  const staffRes = await fetch(`${BASE}/api/portal/jobs`, { headers: { authorization: `Bearer ${me.token}` } })
  const staffBody = await staffRes.json()
  assertSafeStub('staff /api/portal/jobs', staffRes.status, staffBody, { status: 403, gate: 'staff' })

  await desktop.goto(`${BASE}/portal`)
  await desktop.waitForFunction(() => {
    const el = document.querySelector('[data-portal-message]')
    return el && el.textContent.includes('Use Client view on the desk')
  })
  await shot(desktop, '06-portal-staff-gate')
  pass('staff opening /portal stays on the stub')
} finally {
  if (browser) await browser.close()
  child.kill()
}

if (failures.length) {
  console.error(`\n${failures.length} failed`)
  process.exit(1)
}
console.log('\nphone and portal checks passed')
