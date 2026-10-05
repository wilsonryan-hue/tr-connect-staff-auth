#!/usr/bin/env node
/**
 * P0 prove: staff-auth empty unauth book, wrong-pw 401+rate headers,
 * correct login → token → Bearer user; no roster/emails/hashes leaked.
 * Starts a throwaway users.json under /tmp and kills the server on exit.
 */
import { spawn } from 'node:child_process'
import { writeFileSync, unlinkSync, existsSync, mkdtempSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// Dynamic import of store (ESM) — hashPassword only; server gets its own STAFF_AUTH_USERS
const store = await import(pathToFileURL(join(ROOT, 'src/store.js')).href)

const PASSWORD = process.env.PROVE_PASSWORD || 'ProvePass-P0-only!'
const EMAIL = 'prove@treunroc.com'
const PORT = Number(process.env.PROVE_PORT || 18787)
const HOST = '127.0.0.1'
const BASE = `http://${HOST}:${PORT}`

let failed = 0
let passed = 0
let child = null
let usersFile = null
const tmpDir = mkdtempSync(join(tmpdir(), 'tr-staff-auth-prove-'))

function pass(msg) {
  passed += 1
  console.log(`PASS: ${msg}`)
}
function fail(msg) {
  failed += 1
  console.log(`FAIL: ${msg}`)
}

async function cleanup() {
  if (child && !child.killed) {
    try {
      child.kill('SIGTERM')
      await sleep(200)
      if (!child.killed) child.kill('SIGKILL')
    } catch {
      /* ignore */
    }
  }
  if (usersFile && existsSync(usersFile)) {
    try {
      unlinkSync(usersFile)
    } catch {
      /* ignore */
    }
  }
}

process.on('exit', () => {
  if (child && !child.killed) {
    try {
      child.kill('SIGKILL')
    } catch {
      /* ignore */
    }
  }
})
process.on('SIGINT', async () => {
  await cleanup()
  process.exit(130)
})
process.on('SIGTERM', async () => {
  await cleanup()
  process.exit(143)
})

async function fetchJson(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, opts)
  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { res, body, text }
}

function hasRosterLeak(obj) {
  if (!obj || typeof obj !== 'object') return false
  const s = JSON.stringify(obj)
  if (/\b(users|roster|staff|emails)\b/i.test(s) && Array.isArray(obj.users)) return true
  if (obj.book && typeof obj.book === 'object') {
    const keys = Object.keys(obj.book)
    if (keys.length > 0) return true
    // empty book is fine
  }
  if (typeof s === 'string' && (s.includes('@') || s.includes('"hash"') || s.includes('"salt"'))) {
    // unauth responses must not contain emails or hashes
    if (s.includes(EMAIL) || /"hash"\s*:/.test(s) || /"salt"\s*:/.test(s)) return true
  }
  return false
}

async function waitHealthy(maxMs = 8000) {
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    try {
      const { res } = await fetchJson('/health')
      if (res.status === 200) return true
    } catch {
      /* retry */
    }
    await sleep(100)
  }
  return false
}

// --- build temp users.json ---
const { salt, hash } = store.hashPassword(PASSWORD)
usersFile = join(tmpDir, 'users.json')
writeFileSync(
  usersFile,
  JSON.stringify(
    {
      users: [
        {
          email: EMAIL,
          name: 'Prove User',
          role: 'OFFICE',
          tenantId: 'treunroc',
          salt,
          hash,
        },
      ],
    },
    null,
    2,
  ),
)

child = spawn(process.execPath, [join(ROOT, 'src/server.js')], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    HOST,
    STAFF_AUTH_USERS: usersFile,
    DATA_DIR: tmpDir,
    SESSIONS_PATH: join(tmpDir, 'sessions.json'),
    DESK_STORE_PATH: join(tmpDir, 'desk.json'),
    CORS_ORIGIN: '*',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let serverLog = ''
child.stdout.on('data', (d) => {
  serverLog += d.toString()
})
child.stderr.on('data', (d) => {
  serverLog += d.toString()
})

try {
  const up = await waitHealthy()
  if (!up) {
    fail(`server did not become healthy on ${BASE} (log: ${serverLog.slice(0, 400)})`)
    await cleanup()
    process.exit(1)
  }
  pass(`GET /health → 200 on ${BASE}`)

  // Unauth GET → empty book
  {
    const { res, body, text } = await fetchJson('/api/staff-auth')
    if (res.status !== 200) fail(`unauth GET /api/staff-auth status ${res.status}`)
    else pass('GET /api/staff-auth unauth → 200')

    const empty =
      body &&
      body.v === 1 &&
      body.book &&
      typeof body.book === 'object' &&
      Object.keys(body.book).length === 0
    if (!empty) fail(`unauth book not empty: ${text.slice(0, 200)}`)
    else pass('unauth book is {v:1,book:{}}')

    if (hasRosterLeak(body) || text.includes(EMAIL) || /"hash"/.test(text) || /"salt"/.test(text)) {
      fail('unauth response leaked email/hash/roster')
    } else {
      pass('unauth book never lists emails/hashes')
    }

    const rosterFields = ['users', 'roster', 'staff', 'emails']
    const leakedField = rosterFields.find((k) => body && Object.prototype.hasOwnProperty.call(body, k))
    if (leakedField) fail(`unauth response has roster field: ${leakedField}`)
    else pass('no roster fields on unauth GET')
  }

  // Wrong password → 401 + rate headers
  {
    const { res, body } = await fetchJson('/api/staff-auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: 'WrongPass-XXXX-9999!' }),
    })
    if (res.status !== 401) fail(`wrong pw status ${res.status} (want 401)`)
    else pass('POST wrong password → 401')

    const limit = res.headers.get('x-ratelimit-limit')
    const remaining = res.headers.get('x-ratelimit-remaining')
    const reset = res.headers.get('x-ratelimit-reset')
    if (!limit || remaining == null || !reset) {
      fail(`missing rate headers limit=${limit} remaining=${remaining} reset=${reset}`)
    } else {
      pass(`rate headers present (limit=${limit} remaining=${remaining} reset=${reset})`)
    }
    if (body && (body.token || body.hash || body.salt)) fail('wrong-pw body leaked token/hash')
    else pass('wrong-pw body has no token/hash')
  }

  // Correct password → token
  let token = null
  {
    const { res, body, text } = await fetchJson('/api/staff-auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    })
    if (res.status !== 200) fail(`correct pw status ${res.status}: ${text.slice(0, 200)}`)
    else pass('POST correct password → 200')

    if (!body || typeof body.token !== 'string' || body.token.length < 16) {
      fail(`missing/opaque token: ${text.slice(0, 200)}`)
    } else {
      token = body.token
      pass('POST correct → opaque token')
    }
    if (body && body.email !== EMAIL) fail(`token response email mismatch: ${body && body.email}`)
    else if (body) pass(`token response email=${body.email}`)
    if (!body || body.tenantId !== 'treunroc') fail(`token response tenantId missing/wrong: ${body && body.tenantId}`)
    else pass(`token response tenantId=${body.tenantId}`)
  }

  // Bearer GET → user
  if (token) {
    const { res, body, text } = await fetchJson('/api/staff-auth', {
      headers: { authorization: `Bearer ${token}` },
    })
    if (res.status !== 200) fail(`Bearer GET status ${res.status}`)
    else pass('GET Bearer → 200')

    if (!body || body.email !== EMAIL) fail(`Bearer user mismatch: ${text.slice(0, 200)}`)
    else pass(`GET Bearer → user ${body.email}`)

    if (!body || body.tenantId !== 'treunroc') fail(`Bearer tenantId missing/wrong: ${body && body.tenantId}`)
    else pass(`GET Bearer → tenantId=${body.tenantId}`)

    if (body.hash || body.salt || body.book) fail('Bearer response leaked hash/salt/book')
    else pass('Bearer response has no hash/salt/book')
  } else {
    fail('skipped Bearer prove (no token)')
  }

  // Final unauth still empty (no side-effect roster)
  {
    const { res, body, text } = await fetchJson('/api/staff-auth')
    const empty =
      res.status === 200 &&
      body &&
      body.v === 1 &&
      body.book &&
      Object.keys(body.book).length === 0 &&
      !text.includes(EMAIL)
    if (!empty) fail('post-login unauth book not clean')
    else pass('post-login unauth book still empty (no email leak)')
  }
} catch (e) {
  fail(`exception: ${e && e.message ? e.message : e}`)
}

await cleanup()

console.log(`--- prove-p0: ${passed} PASS, ${failed} FAIL ---`)
process.exit(failed === 0 ? 0 : 1)
