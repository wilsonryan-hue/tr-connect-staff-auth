/**
 * Mailbox read for the staff desk. One path: Microsoft Graph when the host
 * sets GRAPH_MAILBOX and credentials, or a fixture file for checks.
 * Replies are not sent from here.
 */
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

export const MAILBOX_OFF = 'Mailbox not connected — set GRAPH_… on the host'
const MAILBOX_UNREADABLE = 'Mailbox is set but could not be read. Logged messages are still here.'

let tokenCache = { key: '', token: '', until: 0 }

export function mailboxConfig() {
  const fixture = String(process.env.GRAPH_MAIL_FIXTURE || '').trim()
  const mailbox = String(process.env.GRAPH_MAILBOX || '').trim()
  if (fixture) return { mode: 'fixture', mailbox: mailbox || 'fixture', fixture }
  const tenant = String(process.env.GRAPH_TENANT_ID || '').trim()
  const clientId = String(process.env.GRAPH_CLIENT_ID || '').trim()
  const secret = String(process.env.GRAPH_CLIENT_SECRET || '').trim()
  const refresh = String(process.env.GRAPH_REFRESH_TOKEN || '').trim()
  if (mailbox && clientId && secret && (refresh || tenant)) {
    return { mode: 'graph', mailbox, tenant, clientId, secret, refresh }
  }
  return { mode: 'off', mailbox: '' }
}

function offStatus() {
  return { connected: false, mode: 'off', banner: MAILBOX_OFF, changed: false }
}

function classifyJob(book, tenantId, text) {
  const hay = String(text || '').toLowerCase()
  let best = null
  for (const job of book.jobs || []) {
    if (job.tenantId !== tenantId) continue
    const name = String(job.name || '').trim()
    if (name.length < 3) continue
    if (!hay.includes(name.toLowerCase())) continue
    if (!best || name.length > best.name.length) best = job
  }
  return best
}

function applyClass(thread, book, tenantId) {
  if (thread.jobId) return
  const job = classifyJob(book, tenantId, `${thread.subject || ''} ${thread.body || ''}`)
  if (job) thread.jobId = job.id
}

function readFixture(cfg) {
  let raw
  try {
    raw = JSON.parse(readFileSync(cfg.fixture, 'utf8'))
  } catch {
    throw new Error(MAILBOX_UNREADABLE)
  }
  if (!Array.isArray(raw)) throw new Error(MAILBOX_UNREADABLE)
  return raw.map((row) => ({
    id: String(row.id || '').trim(),
    subject: String(row.subject || '').trim() || 'No subject',
    from: String(row.from || '').trim() || 'Unknown',
    body: String(row.body || row.bodyPreview || '').trim(),
    received: String(row.received || row.receivedDateTime || '').trim(),
    isRead: Boolean(row.isRead),
  })).filter((row) => row.id)
}

async function graphToken(cfg) {
  const key = `${cfg.tenant}|${cfg.clientId}|${cfg.refresh ? 'refresh' : 'app'}|${cfg.mailbox}`
  const now = Date.now()
  if (tokenCache.key === key && tokenCache.token && tokenCache.until > now + 15000) return tokenCache.token
  const body = new URLSearchParams()
  body.set('client_id', cfg.clientId)
  body.set('client_secret', cfg.secret)
  const tenant = cfg.tenant || 'common'
  if (cfg.refresh) {
    body.set('grant_type', 'refresh_token')
    body.set('refresh_token', cfg.refresh)
    body.set('scope', 'https://graph.microsoft.com/Mail.Read offline_access')
  } else {
    body.set('grant_type', 'client_credentials')
    body.set('scope', 'https://graph.microsoft.com/.default')
  }
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(MAILBOX_UNREADABLE)
  const json = await res.json()
  if (!json.access_token) throw new Error(MAILBOX_UNREADABLE)
  tokenCache = {
    key,
    token: json.access_token,
    until: now + (Number(json.expires_in) || 300) * 1000,
  }
  return json.access_token
}

async function readGraph(cfg) {
  const token = await graphToken(cfg)
  const url = new URL(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cfg.mailbox)}/messages`)
  url.searchParams.set('$top', '25')
  url.searchParams.set('$select', 'id,subject,from,receivedDateTime,bodyPreview,isRead')
  url.searchParams.set('$orderby', 'receivedDateTime desc')
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(MAILBOX_UNREADABLE)
  const json = await res.json()
  const rows = Array.isArray(json.value) ? json.value : []
  return rows.map((row) => ({
    id: String(row.id || '').trim(),
    subject: String(row.subject || '').trim() || 'No subject',
    from: String(row.from?.emailAddress?.address || row.from?.emailAddress?.name || '').trim() || 'Unknown',
    body: String(row.bodyPreview || '').trim(),
    received: String(row.receivedDateTime || '').trim(),
    isRead: Boolean(row.isRead),
  })).filter((row) => row.id)
}

function upsertMessages(book, tenantId, messages) {
  let changed = false
  for (const msg of messages) {
    let thread = book.mail.find((row) => row.tenantId === tenantId && row.graphId === msg.id)
    if (!thread) {
      thread = {
        id: `mail_${randomBytes(8).toString('hex')}`,
        tenantId,
        subject: msg.subject,
        from: msg.from,
        body: msg.body,
        at: msg.received || new Date().toISOString(),
        received: msg.received || new Date().toISOString(),
        read: msg.isRead,
        jobId: '',
        graphId: msg.id,
        replies: [],
      }
      applyClass(thread, book, tenantId)
      book.mail.push(thread)
      changed = true
      continue
    }
    if (thread.subject !== msg.subject || thread.from !== msg.from || thread.body !== msg.body || thread.received !== (msg.received || thread.received)) {
      thread.subject = msg.subject
      thread.from = msg.from
      thread.body = msg.body
      thread.received = msg.received || thread.received
      changed = true
    }
    if (msg.isRead && !thread.read) {
      thread.read = true
      changed = true
    }
    const before = thread.jobId
    applyClass(thread, book, tenantId)
    if (thread.jobId !== before) changed = true
  }
  return changed
}

export async function syncMailbox(book, tenantId) {
  const cfg = mailboxConfig()
  if (cfg.mode === 'off') return offStatus()
  try {
    const messages = cfg.mode === 'fixture' ? readFixture(cfg) : await readGraph(cfg)
    const changed = upsertMessages(book, tenantId, messages)
    return { connected: true, mode: cfg.mode, banner: '', changed }
  } catch {
    return { connected: true, mode: cfg.mode, banner: MAILBOX_UNREADABLE, changed: false }
  }
}

export async function markMailboxRead(graphId, read) {
  const cfg = mailboxConfig()
  if (cfg.mode !== 'graph' || !graphId) return cfg.mode === 'fixture'
  try {
    const token = await graphToken(cfg)
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cfg.mailbox)}/messages/${encodeURIComponent(graphId)}`,
      {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ isRead: Boolean(read) }),
        signal: AbortSignal.timeout(10000),
      },
    )
    return res.ok
  } catch {
    return false
  }
}
