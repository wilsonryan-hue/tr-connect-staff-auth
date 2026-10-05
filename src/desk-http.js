/**
 * Desk routes. Every row is behind the staff session.
 * Send is not a route: the page copies a draft and never calls out.
 */
import { getSession, revokeSession } from './store.js'
import {
  acceptQuote,
  addCost,
  addHours,
  addJobFile,
  addSiteNote,
  addSupplierBill,
  addVariation,
  approveIntoReview,
  assignWorker,
  clientView,
  createCreditNote,
  createInvoice,
  createJob,
  createMail,
  createMaterial,
  createPurchaseOrder,
  createQuote,
  createSupplier,
  createTender,
  createWorker,
  draftMailReply,
  draftQuote,
  getStaffView,
  issueInvoice,
  markMail,
  readJobFile,
  updateInvoice,
  updateJob,
  updateMaterial,
  updateQuote,
  updateTender,
  updateWorker,
  winTender,
} from './desk-store.js'

function bearer(req) {
  const h = req.headers.authorization
  if (!h || typeof h !== 'string') return null
  const m = /^Bearer\s+(\S+)$/i.exec(h)
  return m ? m[1] : null
}

function sessionOf(req) {
  const token = bearer(req)
  if (!token) return null
  return getSession(token)
}

/**
 * @returns {Promise<boolean>} true when the path belongs to the desk
 */
export async function handleDesk(req, res, ctx) {
  const path = (req.url || '').split('?')[0]
  if (!isDeskPath(path)) return false

  const session = sessionOf(req)
  if (path === '/api/session/logout') {
    if (req.method === 'POST') {
      const token = bearer(req)
      if (token) revokeSession(token)
      ctx.send(res, req, 200, { ok: true })
      return true
    }
    ctx.send(res, req, 405, { error: 'Method not allowed.' })
    return true
  }

  if (!session) {
    ctx.send(res, req, 401, { error: 'Sign in to use the desk.' })
    return true
  }

  const tenantId = session.tenantId || 'treunroc'
  const bits = path.split('/').filter(Boolean)

  try {
    const body = async () => {
      if (req.method === 'GET' || req.method === 'HEAD') return {}
      return ctx.readJsonBody(req, 256 * 1024)
    }

    if (path === '/api/desk' && (req.method === 'GET' || req.method === 'HEAD')) {
      ctx.send(res, req, 200, await getStaffView(tenantId))
      return true
    }

    if (path === '/api/client-view' && (req.method === 'GET' || req.method === 'HEAD')) {
      const q = new URL(req.url || '/', 'http://local').searchParams
      ctx.send(res, req, 200, await clientView(tenantId, q.get('client') || ''))
      return true
    }

    if (path === '/api/jobs' && req.method === 'POST') {
      ctx.send(res, req, 200, { job: await createJob(tenantId, await body()) })
      return true
    }

    if (bits[0] === 'api' && bits[1] === 'jobs' && bits[2] && !bits[3] && req.method === 'PATCH') {
      ctx.send(res, req, 200, { job: await updateJob(tenantId, bits[2], await body()) })
      return true
    }

    if (bits[0] === 'api' && bits[1] === 'jobs' && bits[2] && bits[3] === 'costs' && req.method === 'POST') {
      ctx.send(res, req, 200, await addCost(tenantId, bits[2], await body()))
      return true
    }

    if (bits[0] === 'api' && bits[1] === 'jobs' && bits[2] && bits[3] === 'variations' && req.method === 'POST') {
      ctx.send(res, req, 200, await addVariation(tenantId, bits[2], await body()))
      return true
    }

    if (bits[0] === 'api' && bits[1] === 'jobs' && bits[2] && bits[3] === 'invoices' && req.method === 'POST') {
      ctx.send(res, req, 200, { invoice: await createInvoice(tenantId, bits[2], await body()) })
      return true
    }

    if (bits[0] === 'api' && bits[1] === 'jobs' && bits[2] && bits[3] === 'workers' && req.method === 'POST') {
      const input = await body()
      ctx.send(res, req, 200, await assignWorker(tenantId, bits[2], String(input.workerId || '')))
      return true
    }

    if (bits[0] === 'api' && bits[1] === 'invoices' && bits[2] && !bits[3] && req.method === 'PATCH') {
      ctx.send(res, req, 200, { invoice: await updateInvoice(tenantId, bits[2], await body()) })
      return true
    }

    if (bits[0] === 'api' && bits[1] === 'invoices' && bits[2] && bits[3] === 'issue' && req.method === 'POST') {
      ctx.send(res, req, 200, { invoice: await issueInvoice(tenantId, bits[2]) })
      return true
    }

    if (bits[0] === 'api' && bits[1] === 'invoices' && bits[2] && bits[3] === 'credit' && req.method === 'POST') {
      ctx.send(res, req, 200, { creditNote: await createCreditNote(tenantId, bits[2]) })
      return true
    }

    if (bits[0] === 'api' && bits[1] === 'jobs' && bits[2] && bits[3] === 'hours' && req.method === 'POST') {
      ctx.send(res, req, 200, { hours: await addHours(tenantId, bits[2], await body()) })
      return true
    }

    if (bits[0] === 'api' && bits[1] === 'jobs' && bits[2] && bits[3] === 'site-notes' && req.method === 'POST') {
      const input = await body()
      input.author = input.author || session.name || ''
      ctx.send(res, req, 200, { note: await addSiteNote(tenantId, bits[2], input) })
      return true
    }

    if (bits[0] === 'api' && bits[1] === 'jobs' && bits[2] && bits[3] === 'files' && req.method === 'POST') {
      ctx.send(res, req, 200, { file: await addJobFile(tenantId, bits[2], await ctx.readJsonBody(req, 2 * 1024 * 1024)) })
      return true
    }

    if (bits[0] === 'api' && bits[1] === 'files' && bits[2] && !bits[3] && (req.method === 'GET' || req.method === 'HEAD')) {
      const file = await readJobFile(tenantId, bits[2])
      if (req.method === 'HEAD') {
        ctx.sendRaw(res, req, 200, Buffer.alloc(0), file.type, file.name)
      } else {
        ctx.sendRaw(res, req, 200, file.buf, file.type, file.name)
      }
      return true
    }

    if (path === '/api/quotes' && req.method === 'POST') {
      ctx.send(res, req, 200, { quote: await createQuote(tenantId, await body()) })
      return true
    }

    if (bits[0] === 'api' && bits[1] === 'quotes' && bits[2] && bits[3] === 'draft' && req.method === 'POST') {
      ctx.send(res, req, 200, await draftQuote(tenantId, bits[2]))
      return true
    }

    if (bits[0] === 'api' && bits[1] === 'quotes' && bits[2] && bits[3] === 'accept' && req.method === 'POST') {
      ctx.send(res, req, 200, await acceptQuote(tenantId, bits[2]))
      return true
    }

    if (bits[0] === 'api' && bits[1] === 'quotes' && bits[2] && !bits[3] && req.method === 'PATCH') {
      ctx.send(res, req, 200, { quote: await updateQuote(tenantId, bits[2], await body()) })
      return true
    }

    if (path === '/api/tenders' && req.method === 'POST') {
      ctx.send(res, req, 200, { tender: await createTender(tenantId, await body()) })
      return true
    }

    if (bits[0] === 'api' && bits[1] === 'tenders' && bits[2] && bits[3] === 'win' && req.method === 'POST') {
      ctx.send(res, req, 200, await winTender(tenantId, bits[2]))
      return true
    }

    if (bits[0] === 'api' && bits[1] === 'tenders' && bits[2] && !bits[3] && req.method === 'PATCH') {
      ctx.send(res, req, 200, { tender: await updateTender(tenantId, bits[2], await body()) })
      return true
    }

    if (path === '/api/mail' && req.method === 'POST') {
      ctx.send(res, req, 200, { thread: await createMail(tenantId, await body()) })
      return true
    }

    if (bits[0] === 'api' && bits[1] === 'mail' && bits[2] && bits[3] === 'read' && req.method === 'POST') {
      const input = await body()
      ctx.send(res, req, 200, { thread: await markMail(tenantId, bits[2], input.read !== false) })
      return true
    }

    if (bits[0] === 'api' && bits[1] === 'mail' && bits[2] && bits[3] === 'draft' && req.method === 'POST') {
      const input = await body()
      ctx.send(res, req, 200, await draftMailReply(tenantId, bits[2], input.text))
      return true
    }

    if (path === '/api/approvals' && req.method === 'POST') {
      const input = await body()
      ctx.send(res, req, 200, await approveIntoReview(tenantId, String(input.kind || ''), String(input.id || '')))
      return true
    }

    if (path === '/api/supplier-bills' && req.method === 'POST') {
      ctx.send(res, req, 200, { bill: await addSupplierBill(tenantId, await body()) })
      return true
    }

    if (path === '/api/suppliers' && req.method === 'POST') {
      ctx.send(res, req, 200, { supplier: await createSupplier(tenantId, await body()) })
      return true
    }

    if (path === '/api/materials' && req.method === 'POST') {
      ctx.send(res, req, 200, { material: await createMaterial(tenantId, await body()) })
      return true
    }

    if (bits[0] === 'api' && bits[1] === 'materials' && bits[2] && !bits[3] && req.method === 'PATCH') {
      ctx.send(res, req, 200, { material: await updateMaterial(tenantId, bits[2], await body()) })
      return true
    }

    if (path === '/api/purchase-orders' && req.method === 'POST') {
      ctx.send(res, req, 200, { purchaseOrder: await createPurchaseOrder(tenantId, await body()) })
      return true
    }

    if (path === '/api/workers' && req.method === 'POST') {
      ctx.send(res, req, 200, { worker: await createWorker(tenantId, await body()) })
      return true
    }

    if (bits[0] === 'api' && bits[1] === 'workers' && bits[2] && !bits[3] && req.method === 'PATCH') {
      ctx.send(res, req, 200, { worker: await updateWorker(tenantId, bits[2], await body()) })
      return true
    }

    ctx.send(res, req, 404, { error: 'That page is not on the desk.' })
  } catch (err) {
    const status = Number(err?.status) || 500
    const error = status >= 500
      ? err?.status
        ? err.message
        : 'Could not save that. Try again.'
      : err.message || 'Could not save that. Try again.'
    if (status >= 500) console.error('[staff-auth] desk:', err?.message || err)
    ctx.send(res, req, status, { error })
  }
  return true
}

function isDeskPath(path) {
  return (
    path === '/api/desk' ||
    path === '/api/client-view' ||
    path === '/api/session/logout' ||
    path === '/api/jobs' ||
    path.startsWith('/api/jobs/') ||
    path.startsWith('/api/invoices/') ||
    path === '/api/supplier-bills' ||
    path === '/api/suppliers' ||
    path === '/api/materials' ||
    path.startsWith('/api/materials/') ||
    path === '/api/purchase-orders' ||
    path === '/api/workers' ||
    path.startsWith('/api/workers/') ||
    path === '/api/quotes' ||
    path.startsWith('/api/quotes/') ||
    path === '/api/tenders' ||
    path.startsWith('/api/tenders/') ||
    path === '/api/mail' ||
    path.startsWith('/api/mail/') ||
    path === '/api/approvals' ||
    path.startsWith('/api/files/')
  )
}
