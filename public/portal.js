const SESSION_KEY = 'tr.desk.session'

const root = document.querySelector('[data-screen="portal"]')
const message = document.querySelector('[data-portal-message]')

function showBlocked(text) {
  if (root) root.dataset.blocked = '1'
  if (message) message.textContent = text || 'This page is blocked. The client portal is not open.'
}

function staffToken() {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return ''
    const saved = JSON.parse(raw)
    return typeof saved.token === 'string' ? saved.token : ''
  } catch {
    return ''
  }
}

async function loadPortal() {
  const headers = { accept: 'application/json' }
  const token = staffToken()
  if (token) headers.authorization = `Bearer ${token}`
  try {
    const res = await fetch('/api/portal', { headers })
    const body = await res.json()
    if (!body || body.blocked !== true) {
      showBlocked('This page is blocked. The client portal is not open.')
      return
    }
    showBlocked(body.error)
  } catch {
    showBlocked('This page is blocked. The client portal is not open.')
  }
}

loadPortal()
