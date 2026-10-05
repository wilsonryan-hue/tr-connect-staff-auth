/**
 * Client portal stubs. Same Node server as the staff desk.
 * These routes never read the job book. A client login is not created here.
 */
import { getSession } from './store.js'

const ALLOWED_KEYS = ['blocked', 'gate', 'staffPreview', 'portal', 'jobs', 'invoices', 'error']

function bearer(req) {
  const h = req.headers.authorization
  if (!h || typeof h !== 'string') return null
  const m = /^Bearer\s+(\S+)$/i.exec(h)
  return m ? m[1] : null
}

function stubBody(session) {
  const staff = Boolean(session)
  const body = {
    blocked: true,
    gate: staff ? 'staff' : 'unsigned',
    staffPreview: false,
    portal: 'stub',
    jobs: [],
    invoices: [],
    error: staff
      ? 'The client portal is not open. Use Client view on the desk. That screen stays a staff preview.'
      : "Sign in to see this client's jobs.",
  }
  for (const key of Object.keys(body)) {
    if (!ALLOWED_KEYS.includes(key)) delete body[key]
  }
  return body
}

/**
 * @returns {boolean} true when the path is /api/portal or /api/portal/*
 */
export function handlePortal(req, res, ctx) {
  const path = (req.url || '').split('?')[0]
  if (path !== '/api/portal' && !path.startsWith('/api/portal/')) return false

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    ctx.send(res, req, 405, {
      blocked: true,
      gate: 'closed',
      staffPreview: false,
      portal: 'stub',
      jobs: [],
      invoices: [],
      error: 'Client sign-in is not on this server.',
    })
    return true
  }

  const token = bearer(req)
  const session = token ? getSession(token) : null
  const body = stubBody(session)
  ctx.send(res, req, session ? 403 : 401, body)
  return true
}
