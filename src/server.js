#!/usr/bin/env node
/**
 * Portable reference: GET/POST /api/staff-auth + GET /health|/api/health
 * Prep / local only. Deploy later to Origin or a paid host Ryan chooses.
 * No guest password-create. No public named staff list.
 * Pages SPA must stay CLOSED until a live /api host exists — do not push/publish SPA.
 */
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  loadUsers,
  verifyPassword,
  createSession,
  getSession,
  isLocked,
  recordFailure,
  clearFailures,
  rateLimitStatus,
  usersPath,
  RATE,
} from './store.js'
import { mailboxConfig } from './mail-sync.js'
import {
  appendStaffMessage,
  appendAssistantMessage,
  getThreadMessages,
  storePath as trBotStorePath,
} from './tr-bot-store.js'
import { handleDesk } from './desk-http.js'
import { handlePortal } from './portal-http.js'
import { deskPath } from './desk-store.js'

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const PUBLIC_FILES = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/desk.js': { file: 'desk.js', type: 'text/javascript; charset=utf-8' },
  '/desk.css': { file: 'desk.css', type: 'text/css; charset=utf-8' },
  '/manifest.webmanifest': { file: 'manifest.webmanifest', type: 'application/manifest+json; charset=utf-8' },
  '/icon-192.png': { file: 'icon-192.png', type: 'image/png' },
  '/icon-512.png': { file: 'icon-512.png', type: 'image/png' },
  '/apple-touch-icon.png': { file: 'apple-touch-icon.png', type: 'image/png' },
  '/tr-mark.svg': { file: 'tr-mark.svg', type: 'image/svg+xml' },
  '/install': { file: 'install.html', type: 'text/html; charset=utf-8' },
  '/install.html': { file: 'install.html', type: 'text/html; charset=utf-8' },
  '/portal': { file: 'portal.html', type: 'text/html; charset=utf-8' },
  '/portal.html': { file: 'portal.html', type: 'text/html; charset=utf-8' },
  '/portal.js': { file: 'portal.js', type: 'text/javascript; charset=utf-8' },
}

const PORT = Number(process.env.PORT || 8787)
const HOST = process.env.HOST || '127.0.0.1'
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*'
const TR_BOT_WEBHOOK_URL = (process.env.TR_BOT_WEBHOOK_URL || '').trim()
const TR_BOT_REPLY_SECRET = process.env.TR_BOT_REPLY_SECRET || 'tr-desk-local'

function fireTrBotWebhook(event) {
  if (!TR_BOT_WEBHOOK_URL) return
  // Fire-and-forget — never fail the chat response on webhook errors
  fetch(TR_BOT_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
  }).catch(() => {})
}


/** Comma-separated allow-list, or * for any (prep default). Set CORS_ORIGIN to SPA origin(s) on a real host. */
function allowedOrigins() {
  if (CORS_ORIGIN.trim() === '*') return '*'
  return CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean)
}

function corsHeaders(req) {
  const allowed = allowedOrigins()
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : ''
  const headers = {
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-max-age': '86400',
    'access-control-expose-headers':
      'retry-after, x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset',
  }
  if (allowed === '*') {
    headers['access-control-allow-origin'] = '*'
  } else if (origin && allowed.includes(origin)) {
    headers['access-control-allow-origin'] = origin
    headers['vary'] = 'Origin'
  } else if (origin) {
    // Origin present but not allow-listed: omit ACAO (browser blocks); still Vary.
    headers['vary'] = 'Origin'
  }
  return headers
}

function securityHeaders() {
  return {
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
  }
}

/**
 * Clearer rate-limit headers for clients and reverse proxies.
 * @param {{ limit: number, remaining: number, resetAt: number, retryAfterSec: number, locked: boolean }} status
 * @param {{ includeRetryAfter?: boolean }} [opts]
 */
function rateLimitHeaders(status, opts = {}) {
  const headers = {
    'x-ratelimit-limit': String(status.limit),
    'x-ratelimit-remaining': String(status.remaining),
    'x-ratelimit-reset': String(status.resetAt),
  }
  if (opts.includeRetryAfter || status.locked) {
    headers['retry-after'] = String(
      Math.max(1, status.retryAfterSec || Math.ceil(RATE.FAIL_WINDOW_MS / 1000)),
    )
  }
  return headers
}

function readJsonBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    const MAX = maxBytes
    req.on('data', (c) => {
      size += c.length
      if (size > MAX) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        reject(new Error('invalid json'))
      }
    })
    req.on('error', reject)
  })
}

function send(res, req, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    ...securityHeaders(),
    ...corsHeaders(req),
    ...extraHeaders,
  })
  res.end(payload)
}

function sendRaw(res, req, status, buf, type, filename) {
  const safe = String(filename || 'document').replace(/["\r\n]/g, '')
  res.writeHead(status, {
    'content-type': type || 'application/octet-stream',
    'content-length': buf.length,
    'content-disposition': `attachment; filename="${safe}"`,
    ...securityHeaders(),
    ...corsHeaders(req),
  })
  res.end(buf)
}

function clientIp(req) {
  const xf = req.headers['x-forwarded-for']
  if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim()
  return req.socket.remoteAddress || 'unknown'
}

function bearer(req) {
  const h = req.headers.authorization
  if (!h || typeof h !== 'string') return null
  const m = /^Bearer\s+(\S+)$/i.exec(h)
  return m ? m[1] : null
}

function pathOnly(url) {
  return (url || '').split('?')[0]
}

function servePublic(req, res, path) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false
  let decoded = path
  try {
    decoded = decodeURIComponent(path)
  } catch {
    return false
  }
  if (decoded.includes('..')) return false
  const hit = PUBLIC_FILES[decoded]
  if (!hit) return false
  const full = join(PUBLIC_DIR, hit.file)
  if (!existsSync(full)) {
    send(res, req, 404, { error: 'The desk page is not on this server.' })
    return true
  }
  const buf = readFileSync(full)
  res.writeHead(req.method === 'HEAD' ? 200 : 200, {
    'content-type': hit.type,
    'content-length': buf.length,
    ...securityHeaders(),
    ...corsHeaders(req),
  })
  res.end(req.method === 'HEAD' ? undefined : buf)
  return true
}

const server = createServer(async (req, res) => {
  const path = pathOnly(req.url)

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      ...securityHeaders(),
      ...corsHeaders(req),
    })
    res.end()
    return
  }

  if (path === '/health' || path === '/api/health') {
    if (req.method === 'GET' || req.method === 'HEAD') {
      // Liveness only — no users, no roster, no secrets
      send(res, req, 200, {
        ok: true,
        service: 'staff-auth',
        prep: true,
      })
      return
    }
    send(res, req, 405, { error: 'Method not allowed' })
    return
  }

  // --- TR Bot desk chat (staff session; the reply route stays on its secret) ---
  if (path === '/api/tr-bot/messages') {
    const botSession = bearer(req) ? getSession(bearer(req)) : null
    if (!botSession) {
      send(res, req, 401, { error: 'Sign in to use the desk.' })
      return
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      const q = new URL(req.url || '/', 'http://local').searchParams
      const threadId = q.get('threadId') || ''
      const out = getThreadMessages(threadId)
      send(res, req, 200, out)
      return
    }
    if (req.method === 'POST') {
      let body
      try {
        body = await readJsonBody(req)
      } catch {
        send(res, req, 400, { error: 'Invalid JSON body.' })
        return
      }
      const text = String(body.text ?? '').trim()
      if (!text) {
        send(res, req, 400, { error: 'text is required.' })
        return
      }
      try {
        const out = appendStaffMessage({
          threadId: body.threadId,
          staffName: body.staffName,
          staffEmail: body.staffEmail,
          text,
        })
        fireTrBotWebhook({
          type: 'tr-bot.message',
          threadId: out.threadId,
          text,
          staffName: out.message.staffName || null,
          staffEmail: out.message.staffEmail || null,
          message: out.message,
          agentHint: { name: 'TR Bot', id: '4756316' },
          channelHint: {
            name: 'TR Desk Relay',
            id: '8512072a-171f-448c-bff6-99f6f91af023',
          },
        })
        send(res, req, 200, { threadId: out.threadId, messages: out.messages })
      } catch (err) {
        send(res, req, 400, { error: err?.message || 'Could not save message.' })
      }
      return
    }
    send(res, req, 405, { error: 'Method not allowed' })
    return
  }

  if (path === '/api/tr-bot/reply') {
    if (req.method === 'POST') {
      let body
      try {
        body = await readJsonBody(req)
      } catch {
        send(res, req, 400, { error: 'Invalid JSON body.' })
        return
      }
      const secret = String(body.secret ?? '')
      if (secret !== TR_BOT_REPLY_SECRET) {
        send(res, req, 401, { error: 'Unauthorized.' })
        return
      }
      const threadId = String(body.threadId ?? '').trim()
      const text = String(body.text ?? '').trim()
      if (!threadId || !text) {
        send(res, req, 400, { error: 'threadId and text are required.' })
        return
      }
      try {
        const out = appendAssistantMessage({ threadId, text })
        send(res, req, 200, { threadId: out.threadId, messages: out.messages })
      } catch (err) {
        send(res, req, 400, { error: err?.message || 'Could not save reply.' })
      }
      return
    }
    send(res, req, 405, { error: 'Method not allowed' })
    return
  }

  if (servePublic(req, res, path)) return

  if (handlePortal(req, res, { send })) return

  if (await handleDesk(req, res, { send, sendRaw, readJsonBody })) return

  if (path !== '/api/staff-auth') {
    send(res, req, 404, { error: 'Not found' })
    return
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    const token = bearer(req)
    if (token) {
      const session = getSession(token)
      if (!session) {
        send(res, req, 401, { error: 'Session expired or unknown.' })
        return
      }
      send(res, req, 200, {
        email: session.email,
        name: session.name,
        role: session.role,
        tenantId: session.tenantId || 'treunroc',
      })
      return
    }
    // Unauthenticated: empty book only — never leak roster, emails, roles, or hashes
    send(res, req, 200, { v: 1, book: {} })
    return
  }

  if (req.method === 'POST') {
    let body
    try {
      body = await readJsonBody(req)
    } catch {
      send(res, req, 400, { error: 'Invalid JSON body.' })
      return
    }

    const email = String(body.email ?? '')
      .trim()
      .toLowerCase()
    const password = String(body.password ?? '')
    const ip = clientIp(req)

    if (!email || !email.includes('@')) {
      send(res, req, 400, { error: 'Email is required.' })
      return
    }
    if (password.length < 8) {
      send(res, req, 400, { error: 'Password needs at least 8 characters.' })
      return
    }

    if (isLocked(email, ip)) {
      const rl = rateLimitStatus(email, ip)
      send(
        res,
        req,
        429,
        {
          error: 'Too many attempts. Wait 15 minutes, then try again.',
          locked: true,
        },
        rateLimitHeaders(rl, { includeRetryAfter: true }),
      )
      return
    }

    const { users } = loadUsers()
    const user = users.find((u) => u.email === email)
    if (!user || !verifyPassword(password, user)) {
      recordFailure(email, ip)
      const rl = rateLimitStatus(email, ip)
      if (rl.locked) {
        send(
          res,
          req,
          429,
          {
            error: 'Too many attempts. Wait 15 minutes, then try again.',
            locked: true,
          },
          rateLimitHeaders(rl, { includeRetryAfter: true }),
        )
        return
      }
      send(
        res,
        req,
        401,
        { error: 'Email or password not recognised.' },
        rateLimitHeaders(rl),
      )
      return
    }

    clearFailures(email, ip)
    const token = createSession(user)
    const rlOk = rateLimitStatus(email, ip)
    send(
      res,
      req,
      200,
      {
        token,
        email: user.email,
        name: user.name,
        role: user.role,
        tenantId: user.tenantId || 'treunroc',
      },
      rateLimitHeaders(rlOk),
    )
    return
  }

  send(res, req, 405, { error: 'Method not allowed' })
})

server.listen(PORT, HOST, () => {
  const corsDesc =
    allowedOrigins() === '*'
      ? '* (any — tighten CORS_ORIGIN for real host)'
      : allowedOrigins().join(', ')
  console.log(
    `[staff-auth] desk http://${HOST}:${PORT}/  data ${deskPath()}`,
  )
  console.log(`[staff-auth] mailbox: ${mailboxConfig().mode}`)
  console.log(`[staff-auth] listening on http://${HOST}:${PORT}/api/staff-auth`)
  console.log(`[staff-auth] health: http://${HOST}:${PORT}/health (also /api/health)`)
  console.log(`[staff-auth] users file: ${usersPath()} (gitignored; copy from users.json.example)`)
  console.log(
    `[staff-auth] rate limit: ${RATE.FAIL_MAX} failures / ${RATE.FAIL_WINDOW_MS / 60000} min (headers: Retry-After, X-RateLimit-*)`,
  )
  console.log(`[staff-auth] CORS_ORIGIN: ${corsDesc}`)
  console.log(`[staff-auth] TR Bot threads: ${trBotStorePath()}`)
  console.log(
    `[staff-auth] TR Bot: POST/GET /api/tr-bot/messages · POST /api/tr-bot/reply (secret env TR_BOT_REPLY_SECRET)`,
  )
  console.log(
    `[staff-auth] TR Bot webhook: ${TR_BOT_WEBHOOK_URL ? 'set' : 'unset (TR_BOT_WEBHOOK_URL)'}`,
  )
  console.log(
    '[staff-auth] DOOR: Pages SPA stays CLOSED until /api is live — no push / no publish from prep',
  )
})
