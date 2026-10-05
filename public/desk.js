const SESSION_KEY = 'tr.desk.session'

const state = {
  token: null,
  me: null,
  book: null,
  loading: false,
  failed: false,
  loadError: '',
  authError: '',
  clientView: null,
  clientQuery: '',
  editFor: null,
  editLines: [],
  menuOpen: false,
  botOpen: false,
  botThread: '',
  botMessages: [],
  botStatus: '',
  quoteNoticeFor: '',
  quoteNotice: '',
  quoteDraft: '',
  mailNoticeFor: '',
  mailNotice: '',
}

function h(tag, props, ...kids) {
  const n = document.createElement(tag)
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null) continue
      if (k === 'class') n.className = String(v)
      else if (k === 'text') n.textContent = String(v)
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v)
      else if (k === 'value') n.value = String(v)
      else if (k === 'checked' || k === 'selected' || k === 'disabled') n[k] = Boolean(v)
      else if (v === false) continue
      else n.setAttribute(k, v === true ? '' : String(v))
    }
  }
  for (const kid of kids.flat(2)) {
    if (kid == null || kid === false) continue
    n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)))
  }
  return n
}

function formatPounds(pence) {
  const n = Number(pence) || 0
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  const pounds = Math.floor(abs / 100)
  const rem = abs % 100
  const grouped = String(pounds).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${sign}£${grouped}.${String(rem).padStart(2, '0')}`
}

function value(id) {
  const n = document.getElementById(id)
  return n ? n.value : ''
}

function parseRoute() {
  const raw = (location.hash || '#/').replace(/^#/, '') || '/'
  const [path, query] = raw.split('?')
  return {
    bits: path.split('/').filter(Boolean),
    query: new URLSearchParams(query || ''),
  }
}

function go(hash) {
  state.menuOpen = false
  if (location.hash === hash) draw()
  else location.hash = hash
}

function readSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null')
  } catch {
    return null
  }
}

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) }
  if (opts.body != null) headers['content-type'] = 'application/json'
  if (state.token) headers.authorization = `Bearer ${state.token}`
  let res
  try {
    res = await fetch(path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body != null ? JSON.stringify(opts.body) : undefined,
    })
  } catch {
    const err = new Error('Could not load the desk. Check the connection and try again.')
    err.status = 0
    throw err
  }
  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }
  if (!res.ok) {
    const err = new Error(
      (body && body.error) || 'Could not load the desk. Check the connection and try again.',
    )
    err.status = res.status
    throw err
  }
  return body
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY)
  state.token = null
  state.me = null
  state.book = null
  state.clientView = null
  state.failed = false
  state.loadError = ''
}

async function loadBook() {
  const first = !state.book
  if (first) {
    state.loading = true
    draw()
  }
  try {
    state.book = await api('/api/desk')
    state.loadError = ''
    state.failed = false
  } catch (err) {
    if (err.status === 401) {
      clearSession()
    } else {
      state.failed = true
      state.loadError = err.message || 'Could not load the desk. Check the connection and try again.'
    }
  } finally {
    state.loading = false
    draw()
  }
}

function field(label, input) {
  return h('label', { class: 'field' }, h('span', null, label), input)
}

function options(values, current) {
  return values.map(([val, label]) =>
    h('option', { value: val, selected: val === current }, label),
  )
}

function routeKey(bits) {
  const top = bits[0] || 'home'
  if (top === 'login') return 'home'
  return top
}

function navLinks(key, items) {
  return items.map(([hash, label, id]) =>
    h('a', { href: hash, 'aria-current': key === id ? 'page' : null }, label),
  )
}

function shell(...nodes) {
  const { bits } = parseRoute()
  const key = routeKey(bits)
  const group = (label, items) =>
    h('div', { class: 'nav-group' }, h('p', { class: 'nav-label' }, label), ...navLinks(key, items))
  return h(
    'div',
    { class: 'desk sheet' },
    h(
      'aside',
      { class: state.menuOpen ? 'sidebar open' : 'sidebar', id: 'sidebar' },
      h('p', { class: 'nav-label' }, 'Treun Roc'),
      h(
        'nav',
        { 'aria-label': 'Sections' },
        group('Desk', [
          ['#/', 'Home', 'home'],
          ['#/jobs', 'Jobs', 'jobs'],
          ['#/quotes', 'Quotes', 'quotes'],
          ['#/tenders', 'Quick BD', 'tenders'],
          ['#/approvals', 'Approvals', 'approvals'],
          ['#/mail', 'Mail', 'mail'],
        ]),
        group('Money', [
          ['#/statements', 'Finance', 'statements'],
          ['#/monday', 'Monday', 'monday'],
          ['#/report', 'Report', 'report'],
          ['#/invoices', 'Invoices', 'invoices'],
          ['#/bills', 'Supplier bills', 'bills'],
          ['#/suppliers', 'Suppliers', 'suppliers'],
          ['#/materials', 'Materials', 'materials'],
          ['#/client', 'Client view', 'client'],
        ]),
        group('Site', [
          ['#/monitor', 'Live Monitor', 'monitor'],
          ['#/workers', 'Workers', 'workers'],
          ['#/site', 'Site', 'site'],
          ['#/calendar', 'Calendar', 'calendar'],
          ['#/files', 'Company files', 'files'],
        ]),
      ),
    ),
    h(
      'div',
      { class: 'maincol' },
      h(
        'header',
        { class: 'top' },
        h('div', null, h('h1', null, 'Treun Roc Connect'), h('p', null, 'Staff desk')),
        h(
          'div',
          { class: 'row' },
          h('button', { type: 'button', class: 'ghost menu-btn', onClick: toggleMenu }, 'Menu'),
          h('button', { type: 'button', class: 'ghost', onClick: toggleBot }, 'TR Bot'),
          h('button', { type: 'button', class: 'ghost', onClick: signOut }, 'Sign out'),
        ),
      ),
      botPanel(),
      state.loadError
        ? h(
            'div',
            { class: 'card err', 'data-error': 'load' },
            h('p', { role: 'alert' }, state.loadError),
            h('button', { type: 'button', class: 'ghost', onClick: () => loadBook() }, 'Try again'),
          )
        : null,
      ...nodes,
    ),
    h(
      'div',
      { class: 'bottombar' },
      h('button', { type: 'button', onClick: () => go('#/') }, 'Home'),
      h('button', { type: 'button', onClick: () => go('#/jobs') }, 'Jobs'),
      h('button', { type: 'button', onClick: () => go('#/mail') }, 'Mail'),
      h('button', { type: 'button', onClick: () => go('#/statements') }, 'Finance'),
    ),
  )
}

function toggleMenu() {
  state.menuOpen = !state.menuOpen
  draw()
}

function toggleBot() {
  state.botOpen = !state.botOpen
  if (state.botOpen && state.botThread) loadBot().then(draw)
  else draw()
}

function botPanel() {
  if (!state.botOpen) return null
  return h(
    'form',
    { class: 'card bot-panel noprint', onSubmit: handoff },
    h('h2', null, 'TR Bot'),
    h('p', { class: 'muted' }, 'Hand a note to the desk relay. Nothing is emailed.'),
    (state.botMessages || []).map((msg) =>
      h('p', null, `${msg.role === 'assistant' ? 'TR Bot' : 'You'}: ${msg.text}`),
    ),
    field('Note', h('textarea', { id: 'bot-text' })),
    h('p', { id: 'bot-error', class: 'err', role: 'alert' }),
    h('p', { 'data-bot-state': '1' }, state.botStatus || ''),
    h('button', { type: 'submit' }, 'Hand off'),
  )
}

async function loadBot() {
  if (!state.botThread) return
  try {
    const out = await api(`/api/tr-bot/messages?threadId=${encodeURIComponent(state.botThread)}`)
    state.botMessages = out.messages || []
  } catch {
    /* the desk still works if the relay is quiet */
  }
}

async function handoff(ev) {
  ev.preventDefault()
  const err = document.getElementById('bot-error')
  const text = value('bot-text').trim()
  if (!text) {
    err.textContent = 'Enter a note.'
    return
  }
  try {
    const out = await api('/api/tr-bot/messages', {
      method: 'POST',
      body: {
        threadId: state.botThread || undefined,
        staffName: state.me?.name || '',
        staffEmail: state.me?.email || '',
        text,
      },
    })
    state.botThread = out.threadId
    state.botMessages = out.messages || []
    state.botStatus = 'Handed off'
    state.botOpen = true
    try { sessionStorage.setItem('tr.bot.thread', out.threadId) } catch { /* ignore */ }
    draw()
  } catch (e) {
    err.textContent = e.message
  }
}

async function signOut() {
  try {
    await api('/api/session/logout', { method: 'POST', body: {} })
  } catch {
    /* leave the desk either way */
  }
  clearSession()
  location.hash = '#/login'
  draw()
}

function screenLoading() {
  return h(
    'main',
    { 'data-screen': 'loading', class: 'card' },
    h('div', { class: 'shape w40' }),
    h('div', { class: 'shape' }),
    h('div', { class: 'shape' }),
    h('div', { class: 'shape w60' }),
    h('div', { class: 'shape tall' }),
  )
}

function screenFailed() {
  return h(
    'main',
    { 'data-screen': 'failed', class: 'card' },
    h('p', { role: 'alert', 'data-error': 'load' }, state.loadError || 'Could not load the desk. Check the connection and try again.'),
    h('button', { type: 'button', onClick: () => loadBook() }, 'Try again'),
  )
}

function screenLogin() {
  return h(
    'main',
    { class: 'wrap sheet', 'data-screen': 'login' },
    h(
      'form',
      { class: 'card', onSubmit: onLogin },
      h('h1', null, 'Treun Roc Connect'),
      h('p', { class: 'muted' }, 'Staff sign in'),
      h('p', null, h('a', { href: '/install' }, 'Add to Home Screen')),
      field('Work email', h('input', { id: 'email', type: 'email', autocomplete: 'username', required: true })),
      field('Password', h('input', { id: 'password', type: 'password', autocomplete: 'current-password', required: true })),
      h('p', { id: 'form-error', class: 'err', role: 'alert', 'data-error': 'login' }, state.authError || ''),
      h('button', { id: 'login-btn', type: 'submit' }, 'Enter desk'),
    ),
  )
}

async function onLogin(ev) {
  ev.preventDefault()
  const err = document.getElementById('form-error')
  const btn = document.getElementById('login-btn')
  err.textContent = ''
  const email = value('email').trim()
  const password = value('password')
  if (!email.includes('@')) {
    err.textContent = 'Enter your work email.'
    return
  }
  if (password.length < 8) {
    err.textContent = 'Password needs at least 8 characters.'
    return
  }
  btn.disabled = true
  btn.textContent = 'Signing in…'
  try {
    const body = await api('/api/staff-auth', { method: 'POST', body: { email, password } })
    state.token = body.token
    state.me = { token: body.token, email: body.email, name: body.name, role: body.role }
    state.authError = ''
    localStorage.setItem(SESSION_KEY, JSON.stringify(state.me))
    await loadBook()
    if (!state.me) return
    if (!location.hash || location.hash === '#/' || location.hash === '#/login') {
      if (location.hash !== '#/') location.hash = '#/'
      else draw()
    }
  } catch (e) {
    err.textContent = e.message
    btn.disabled = false
    btn.textContent = 'Enter desk'
  }
}

function screenBlocked() {
  return h(
    'main',
    { class: 'wrap sheet', 'data-screen': 'blocked' },
    h('div', { class: 'card' },
      h('h1', null, 'Client view'),
      h('p', { 'data-blocked': '1' }, "Sign in to see this client's jobs."),
      h('button', { type: 'button', onClick: () => { location.hash = '#/login' } }, 'Staff sign in'),
    ),
  )
}

function empty(sentence, label, hash) {
  return h(
    'div',
    { 'data-empty': '1' },
    h('p', null, sentence),
    h('button', { type: 'button', onClick: () => { location.hash = hash } }, label),
  )
}

function screenJobs() {
  const all = state.book?.jobs || []
  const asked = parseRoute().query.get('status') || ''
  const statuses = ['quoted', 'live', 'snagging', 'done']
  const active = statuses.includes(asked) ? asked : ''
  const jobs = active ? all.filter((job) => job.status === active) : all
  const chip = (status, label) =>
    h('button', {
      type: 'button',
      class: status === active ? '' : 'ghost',
      'aria-pressed': status === active ? 'true' : 'false',
      onClick: () => { location.hash = status ? `#/jobs?status=${status}` : '#/jobs' },
    }, label)
  const card = (job) =>
    h(
      'div',
      { class: 'card', 'data-job-card': job.id },
      h('a', { href: `#/jobs/${job.id}` }, job.name),
      h('p', { class: 'muted' }, `${job.client} · ${job.siteAddress}`),
      h('p', { 'data-status': job.status }, job.status),
      h('p', null, job.contractSum),
    )
  let board
  if (!all.length) board = empty('No jobs yet.', 'Add job', '#/jobs/new')
  else if (active) {
    board = jobs.length
      ? h('div', null, jobs.map(card))
      : h('p', { 'data-empty': '1' }, 'No jobs in this status.')
  } else {
    board = h(
      'div',
      { class: 'board', 'data-board': '1' },
      statuses.map((status) =>
        h(
          'section',
          { class: 'card' },
          h('h3', null, status),
          ...all.filter((job) => job.status === status).map(card),
          all.some((job) => job.status === status) ? null : h('p', { class: 'muted' }, 'None.'),
        ),
      ),
    )
  }
  return h(
    'main',
    { 'data-screen': 'jobs' },
    h('div', { class: 'row noprint' }, h('h2', null, 'Jobs'), h('button', { type: 'button', onClick: () => { location.hash = '#/jobs/new' } }, 'Add job')),
    h('div', { class: 'row noprint' }, chip('', 'All'), ...statuses.map((status) => chip(status, status))),
    board,
  )
}

function jobForm(job) {
  const status = h('select', { id: 'job-status' }, options(
    [['quoted', 'quoted'], ['live', 'live'], ['snagging', 'snagging'], ['done', 'done']],
    job?.status || 'quoted',
  ))
  status.value = job?.status || 'quoted'
  const vat = h('select', { id: 'job-vat' }, options(
    [['standard', '20%'], ['zero', '0% zero-rate'], ['reverse', 'reverse charge']],
    job?.vatTreatment || 'standard',
  ))
  vat.value = job?.vatTreatment || 'standard'
  return h(
    'form',
    { class: 'card', onSubmit: (ev) => saveJob(ev, job?.id || null) },
    h('h2', null, job ? job.name : 'New job'),
    field('Job name', h('input', { id: 'job-name', value: job?.name || '', autocomplete: 'off' })),
    field('Client', h('input', { id: 'job-client', value: job?.client || '', autocomplete: 'off' })),
    field('Site address', h('input', { id: 'job-site', value: job?.siteAddress || '', autocomplete: 'off' })),
    field('Status', status),
    field('Contract sum', h('input', { id: 'job-sum', inputmode: 'decimal', value: job ? (job.contractSumPence / 100).toFixed(2) : '', autocomplete: 'off' })),
    field('VAT', vat),
    field('Start date', h('input', { id: 'job-start', placeholder: 'dd/mm/yyyy', value: job?.startDateDisplay || '', autocomplete: 'off' })),
    field('Notes', h('textarea', { id: 'job-notes' }, job?.notes || '')),
    h('p', { id: 'form-error', class: 'err', role: 'alert', 'data-error': 'form' }),
    h('button', { id: 'save-job', type: 'submit' }, 'Save job'),
  )
}

async function saveJob(ev, existingId) {
  ev.preventDefault()
  const err = document.getElementById('form-error')
  const btn = document.getElementById('save-job')
  err.textContent = ''
  const payload = {
    name: value('job-name'),
    client: value('job-client'),
    siteAddress: value('job-site'),
    status: value('job-status'),
    contractSum: value('job-sum'),
    vatTreatment: value('job-vat'),
    startDate: value('job-start'),
    notes: value('job-notes'),
  }
  if (!payload.name.trim()) {
    err.textContent = 'Enter a job name.'
    return
  }
  btn.disabled = true
  btn.textContent = 'Saving…'
  try {
    const out = existingId
      ? await api(`/api/jobs/${existingId}`, { method: 'PATCH', body: payload })
      : await api('/api/jobs', { method: 'POST', body: payload })
    await loadBook()
    const next = `#/jobs/${out.job.id}`
    if (location.hash !== next) location.hash = next
  } catch (e) {
    err.textContent = e.message
    btn.disabled = false
    btn.textContent = 'Save job'
  }
}

function screenJob(id) {
  const job = (state.book?.jobs || []).find((row) => row.id === id)
  if (!job) {
    return h('main', { 'data-screen': 'job' }, h('p', null, 'That job is not on the desk.'), h('button', { type: 'button', onClick: () => { location.hash = '#/jobs' } }, 'Jobs'))
  }
  const variations = (state.book.variations || []).filter((row) => row.jobId === id)
  const costs = (state.book.costs || []).filter((row) => row.jobId === id)
  const review = [...variations, ...costs].filter((row) => row.review)
  const inMarginCosts = costs.filter((row) => !row.review)
  const approved = variations.filter((row) => row.approved && !row.review)
  const noted = variations.filter((row) => !row.approved && !row.review)
  const others = (state.book.workers || []).filter((w) => !job.workers.some((on) => on.id === w.id))
  const pct = job.money.marginPercent ? ` (${job.money.marginPercent}%)` : ''
  return h(
    'main',
    { 'data-screen': 'job' },
    h('p', { class: 'muted' }, h('a', { href: '#/jobs' }, 'Jobs')),
    h('p', { 'data-status': job.status }, job.status),
    jobForm(job),
    h(
      'section',
      { class: 'card', 'data-margin-block': '1' },
      h('h2', null, 'Live margin'),
      h('p', { class: 'formula', 'data-formula': '1' }, job.money.formula),
      h('p', null, `Contract sum ${job.money.contractSum}`),
      h('p', null, `Approved variations ${job.money.approvedVariations}`),
      h('p', { 'data-costs': '1' }, `Costs ${job.money.costs}`),
      h('p', { class: 'money', 'data-margin': '1' }, `Live margin ${job.money.margin}${pct}`),
    ),
    h(
      'div',
      { class: 'split' },
      h(
        'form',
        { class: 'card', onSubmit: (ev) => addVariation(ev, id) },
        h('h2', null, 'Variation'),
        field('Variation description', h('input', { id: 'var-desc', autocomplete: 'off' })),
        field('Variation amount', h('input', { id: 'var-amount', inputmode: 'decimal', autocomplete: 'off' })),
        h('label', { class: 'check' }, h('input', { id: 'var-approved', type: 'checkbox' }), 'Approved'),
        field('Variation mark', h('select', { id: 'var-mark' }, options([['', 'None'], ['Ryan', 'Ryan'], ['Ryan2', 'Ryan2'], ['Kacey', 'Kacey']], ''))),
        h('button', { type: 'submit' }, 'Add variation'),
      ),
      h(
        'form',
        { class: 'card', onSubmit: (ev) => addCost(ev, id) },
        h('h2', null, 'Cost'),
        field('Cost description', h('input', { id: 'cost-desc', autocomplete: 'off' })),
        field('Cost amount', h('input', { id: 'cost-amount', inputmode: 'decimal', autocomplete: 'off' })),
        field('Cost mark', h('select', { id: 'cost-mark' }, options([['', 'None'], ['Ryan', 'Ryan'], ['Ryan2', 'Ryan2'], ['Kacey', 'Kacey']], ''))),
        h('button', { type: 'submit' }, 'Add cost'),
      ),
    ),
    h('p', { id: 'line-error', class: 'err', role: 'alert', 'data-error': 'line' }),
    listCard('Approved variations', approved),
    listCard('Costs in the margin', inMarginCosts),
    noted.length ? listCard('Noted, not in the margin', noted) : null,
    h(
      'section',
      { class: 'card', 'data-review': '1' },
      h('h2', null, 'Review pile'),
      review.length
        ? h('ul', null, review.map((row) => h('li', { 'data-review-line': row.mark }, `${row.description} ${row.mark} ${row.amount}`)))
        : h('p', null, 'No lines in the review pile.'),
      h('p', { class: 'muted' }, 'Not in the margin.'),
    ),
    h(
      'section',
      { class: 'card' },
      h('h2', null, 'Workers on this job'),
      job.workers.length
        ? h(
            'ul',
            null,
            job.workers.map((w) =>
              h(
                'li',
                null,
                h('a', { href: `#/workers/${w.id}` }, w.name),
                w.trade ? ` ${w.trade}` : '',
                ` ${w.tax}`,
                w.ticketExpired ? h('span', { class: 'flag', 'data-ticket-flag': '1' }, ' Ticket expired') : '',
              ),
            ),
          )
        : h('p', null, 'No workers on this job yet.'),
      others.length
        ? h(
            'form',
            { class: 'row', onSubmit: (ev) => attachWorker(ev, id) },
            field('Worker', h('select', { id: 'attach-worker' }, others.map((w) => h('option', { value: w.id }, w.name)))),
            h('button', { type: 'submit' }, 'Attach worker'),
          )
        : null,
    ),
    h('p', { class: 'noprint' }, h('button', { type: 'button', onClick: () => createInvoice(id) }, 'Create invoice')),
    hoursCard(job),
    siteNoteCard(job),
    filesCard(job),
    jobOrders(job),
    jobTenders(job),
  )
}

function jobOrders(job) {
  const rows = (state.book?.purchaseOrders || []).filter((row) => row.jobId === job.id)
  if (!rows.length) return null
  return h(
    'section',
    { class: 'card', 'data-job-orders': '1' },
    h('h2', null, 'Purchase orders'),
    h('ul', null, rows.map((po) => h('li', { 'data-job-po': po.id },
      h('a', { href: `#/materials/${po.id}` }, po.number),
      ' ',
      po.supplierId ? h('a', { href: `#/suppliers/${po.supplierId}` }, po.supplier) : po.supplier,
      ` ${po.net}`,
    ))),
  )
}

function jobTenders(job) {
  const rows = (state.book?.tenders || []).filter((row) => row.jobId === job.id)
  if (!rows.length) return null
  return h(
    'section',
    { class: 'card', 'data-job-tenders': '1' },
    h('h2', null, 'Tenders'),
    h('ul', null, rows.map((tender) => h('li', null, h('a', { href: `#/tenders/${tender.id}` }, tender.title), ` ${tender.status}`))),
  )
}

function hoursCard(job) {
  const rows = (state.book?.hours || []).filter((row) => row.jobId === job.id)
  const workers = state.book?.workers || []
  return h(
    'section',
    { class: 'card' },
    h('h2', null, 'Hours'),
    rows.length
      ? h('ul', null, rows.map((row) => h('li', null, `${row.dateDisplay} ${row.workerName} ${row.hours}h${row.note ? ` ${row.note}` : ''}`)))
      : h('p', { class: 'muted' }, 'No hours on this job yet.'),
    workers.length
      ? h(
          'form',
          { onSubmit: (ev) => saveHours(ev, job.id) },
          field('Hours for', h('select', { id: 'hours-worker' }, workers.map((w) => h('option', { value: w.id }, w.name)))),
          field('Hours date', h('input', { id: 'hours-date', placeholder: 'dd/mm/yyyy' })),
          field('Hours', h('input', { id: 'hours-qty', inputmode: 'decimal' })),
          field('Hours note', h('input', { id: 'hours-note', autocomplete: 'off' })),
          h('p', { id: 'hours-error', class: 'err', role: 'alert' }),
          h('button', { type: 'submit' }, 'Add hours'),
        )
      : h('p', null, 'Add a worker before logging hours.'),
  )
}

async function saveHours(ev, jobId) {
  ev.preventDefault()
  const err = document.getElementById('hours-error')
  err.textContent = ''
  if (!value('hours-qty').trim()) {
    err.textContent = 'Enter the hours.'
    return
  }
  try {
    await api(`/api/jobs/${jobId}/hours`, {
      method: 'POST',
      body: {
        workerId: value('hours-worker'),
        date: value('hours-date'),
        hours: value('hours-qty'),
        note: value('hours-note'),
      },
    })
    await loadBook()
  } catch (e) {
    err.textContent = e.message
  }
}

function siteNoteCard(job) {
  const rows = (state.book?.siteNotes || []).filter((row) => row.jobId === job.id)
  return h(
    'section',
    { class: 'card' },
    h('h2', null, 'Site notes'),
    rows.length
      ? h('ul', null, rows.map((row) => h('li', null, `${row.atDisplay} ${row.text}`)))
      : h('p', { class: 'muted' }, 'No site notes on this job yet.'),
    h(
      'form',
      { onSubmit: (ev) => saveSiteNote(ev, job.id) },
      field('Site note', h('textarea', { id: 'site-note' })),
      h('p', { id: 'site-error', class: 'err', role: 'alert' }),
      h('button', { type: 'submit' }, 'Add site note'),
    ),
  )
}

async function saveSiteNote(ev, jobId) {
  ev.preventDefault()
  const err = document.getElementById('site-error')
  err.textContent = ''
  if (!value('site-note').trim()) {
    err.textContent = 'Enter the site note.'
    return
  }
  try {
    await api(`/api/jobs/${jobId}/site-notes`, { method: 'POST', body: { text: value('site-note') } })
    await loadBook()
  } catch (e) {
    err.textContent = e.message
  }
}

function filesCard(job) {
  const rows = (state.book?.files || []).filter((row) => row.jobId === job.id)
  return h(
    'section',
    { class: 'card' },
    h('h2', null, 'Documents'),
    rows.length
      ? h('ul', null, rows.map((row) => h('li', null, row.name, row.note ? ` ${row.note}` : '', ' ', h('button', { type: 'button', class: 'ghost', onClick: () => downloadFile(row) }, 'Download'))))
      : h('p', { class: 'muted' }, 'No documents on this job yet.'),
    h(
      'form',
      { onSubmit: (ev) => uploadFile(ev, job.id) },
      field('Document', h('input', { id: 'job-file', type: 'file', accept: '.pdf,.png,.jpg,.jpeg,.webp,.txt,.csv' })),
      field('File note', h('input', { id: 'file-note', autocomplete: 'off' })),
      h('p', { id: 'file-error', class: 'err', role: 'alert' }),
      h('button', { type: 'submit' }, 'Add document'),
    ),
  )
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const raw = String(reader.result || '')
      const cut = raw.indexOf(',')
      resolve(cut >= 0 ? raw.slice(cut + 1) : raw)
    }
    reader.onerror = () => reject(new Error('Could not read that document.'))
    reader.readAsDataURL(file)
  })
}

async function uploadFile(ev, jobId) {
  ev.preventDefault()
  const err = document.getElementById('file-error')
  err.textContent = ''
  const input = document.getElementById('job-file')
  const file = input && input.files && input.files[0]
  if (!file) {
    err.textContent = 'Choose a document.'
    return
  }
  try {
    const dataBase64 = await fileToBase64(file)
    await api(`/api/jobs/${jobId}/files`, {
      method: 'POST',
      body: { name: file.name, note: value('file-note'), dataBase64 },
    })
    await loadBook()
  } catch (e) {
    err.textContent = e.message
  }
}

async function downloadFile(row) {
  const err = document.getElementById('file-error')
  try {
    const res = await fetch(`/api/files/${row.id}`, { headers: { authorization: `Bearer ${state.token}` } })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      throw new Error((body && body.error) || 'Could not open that document.')
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = row.name
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    if (err) err.textContent = e.message
  }
}

function listCard(title, rows) {
  return h(
    'section',
    { class: 'card' },
    h('h2', null, title),
    rows.length
      ? h('ul', null, rows.map((row) => h('li', null, `${row.description} ${row.amount}`)))
      : h('p', { class: 'muted' }, 'None.'),
  )
}

function lineError() {
  return document.getElementById('line-error') || document.getElementById('form-error')
}

async function addVariation(ev, jobId) {
  ev.preventDefault()
  const err = lineError()
  err.textContent = ''
  const amount = value('var-amount')
  if (!amount.trim()) {
    err.textContent = 'Enter a variation amount.'
    return
  }
  const btn = ev.submitter
  if (btn) {
    btn.disabled = true
    btn.textContent = 'Saving…'
  }
  try {
    await api(`/api/jobs/${jobId}/variations`, {
      method: 'POST',
      body: {
        description: value('var-desc'),
        amount,
        approved: document.getElementById('var-approved').checked,
        mark: value('var-mark'),
      },
    })
    await loadBook()
  } catch (e) {
    err.textContent = e.message
    if (btn) {
      btn.disabled = false
      btn.textContent = 'Add variation'
    }
  }
}

async function addCost(ev, jobId) {
  ev.preventDefault()
  const err = lineError()
  err.textContent = ''
  const amount = value('cost-amount')
  if (!amount.trim()) {
    err.textContent = 'Enter a cost amount.'
    return
  }
  const btn = ev.submitter
  if (btn) {
    btn.disabled = true
    btn.textContent = 'Saving…'
  }
  try {
    await api(`/api/jobs/${jobId}/costs`, {
      method: 'POST',
      body: { description: value('cost-desc'), amount, mark: value('cost-mark') },
    })
    await loadBook()
  } catch (e) {
    err.textContent = e.message
    if (btn) {
      btn.disabled = false
      btn.textContent = 'Add cost'
    }
  }
}

async function attachWorker(ev, jobId) {
  ev.preventDefault()
  const err = lineError()
  err.textContent = ''
  const workerId = value('attach-worker')
  if (!workerId) {
    err.textContent = 'Choose a worker.'
    return
  }
  try {
    await api(`/api/jobs/${jobId}/workers`, { method: 'POST', body: { workerId } })
    await loadBook()
  } catch (e) {
    err.textContent = e.message
  }
}

async function createInvoice(jobId) {
  const err = lineError()
  try {
    const out = await api(`/api/jobs/${jobId}/invoices`, { method: 'POST', body: {} })
    state.editFor = null
    await loadBook()
    location.hash = `#/invoices/${out.invoice.id}`
  } catch (e) {
    if (err) err.textContent = e.message
  }
}

function screenMonday() {
  const live = (state.book?.jobs || []).filter((job) => job.status === 'live')
  if (!live.length) {
    return h('main', { 'data-screen': 'monday' }, h('h2', null, 'Monday'), empty('No live jobs yet.', 'Add job', '#/jobs/new'))
  }
  const totals = {
    contract: live.reduce((sum, job) => sum + job.money.contractSumPence, 0),
    costs: live.reduce((sum, job) => sum + job.money.costsPence, 0),
    margin: live.reduce((sum, job) => sum + job.money.marginPence, 0),
  }
  return h(
    'main',
    { 'data-screen': 'monday' },
    h('h2', null, 'Monday'),
    h('p', { class: 'formula' }, 'Live jobs. Review pile lines are not in these totals.'),
    h(
      'table',
      null,
      h('thead', null, h('tr', null,
        h('th', null, 'Job'),
        h('th', { class: 'num' }, 'Contract sum'),
        h('th', { class: 'num' }, 'Costs'),
        h('th', { class: 'num' }, 'Margin'),
        h('th', null, 'Status'),
      )),
      h('tbody', null,
        live.map((job) => h('tr', { 'data-monday-row': job.id },
          h('td', null, h('a', { href: `#/jobs/${job.id}` }, job.name)),
          h('td', { class: 'num' }, job.money.contractSum),
          h('td', { class: 'num' }, job.money.costs),
          h('td', { class: 'num', 'data-row-margin': job.id }, job.money.margin),
          h('td', null, job.status),
        )),
        h('tr', null,
          h('th', null, 'Total'),
          h('td', { class: 'num', 'data-total-contract': '1' }, formatPounds(totals.contract)),
          h('td', { class: 'num', 'data-total-costs': '1' }, formatPounds(totals.costs)),
          h('td', { class: 'num', 'data-total-margin': '1' }, formatPounds(totals.margin)),
          h('td'),
        ),
      ),
    ),
  )
}

function screenInvoices() {
  const invoices = state.book?.invoices || []
  const jobs = state.book?.jobs || []
  return h(
    'main',
    { 'data-screen': 'invoices' },
    h('h2', null, 'Invoices'),
    invoices.length
      ? h('table', null,
          h('thead', null, h('tr', null, h('th', null, 'Number'), h('th', null, 'Date'), h('th', null, 'Job'), h('th', { class: 'num' }, 'Gross'), h('th', null, 'Status'))),
          h('tbody', null, invoices.map((inv) => h('tr', null,
            h('td', null, h('a', { href: `#/invoices/${inv.id}` }, inv.number)),
            h('td', null, inv.dateDisplay),
            h('td', null, inv.jobName),
            h('td', { class: 'num' }, inv.gross),
            h('td', null, inv.status),
          ))),
        )
      : h('div', { 'data-empty': '1' },
          h('p', null, 'No invoices yet.'),
          jobs.length
            ? h('form', { onSubmit: createFromList },
                field('Job', h('select', { id: 'invoice-job' }, jobs.map((job) => h('option', { value: job.id }, job.name)))),
                h('button', { type: 'submit' }, 'Create invoice'),
              )
            : h('button', { type: 'button', onClick: () => { location.hash = '#/jobs/new' } }, 'Add job'),
        ),
  )
}

function createFromList(ev) {
  ev.preventDefault()
  const id = value('invoice-job')
  if (id) createInvoice(id)
}

function ensureEditLines(inv) {
  if (state.editFor === inv.id) return
  state.editFor = inv.id
  state.editLines = inv.lines.map((line) => ({
    description: line.description,
    net: (line.netPence / 100).toFixed(2),
  }))
}

function screenInvoice(id) {
  const inv = (state.book?.invoices || []).find((row) => row.id === id)
  if (!inv) return h('main', { 'data-screen': 'invoice' }, h('p', null, 'That invoice is not on the desk.'))
  const locked = inv.issued
  if (!locked) ensureEditLines(inv)
  return h(
    'main',
    { 'data-screen': 'invoice' },
    h('p', null, h('a', { href: '#/invoices' }, 'Invoices'), ' · ', h('a', { href: `#/jobs/${inv.jobId}` }, inv.jobName)),
    h('h2', { 'data-invoice-number': inv.number }, inv.number),
    h('p', null, `Date ${inv.dateDisplay}`),
    h('p', null, `Job ${inv.jobName}`),
    locked
      ? h('div', null,
          h('p', { 'data-error': 'issued', role: 'alert' }, 'This invoice is issued. Credit it to change the lines.'),
          h('ul', null, inv.lines.map((line) => h('li', null, `${line.description} ${line.net}`))),
        )
      : h('form', { onSubmit: (ev) => saveInvoice(ev, inv.id) },
          field('Date', h('input', { id: 'inv-date', value: inv.dateDisplay })),
          ...state.editLines.map((line, i) => h('div', { class: 'split' },
            field('Description', h('input', { id: `line-desc-${i}`, value: line.description })),
            field('Net', h('input', { id: `line-net-${i}`, value: line.net, inputmode: 'decimal' })),
          )),
          h('p', { class: 'row' },
            h('button', { type: 'button', class: 'ghost', onClick: addLine }, 'Add line'),
            h('button', { type: 'submit' }, 'Save invoice'),
          ),
          h('p', { id: 'form-error', class: 'err', role: 'alert', 'data-error': 'form' }),
        ),
    h('p', { 'data-net': '1' }, `Net ${inv.net}`),
    h('p', { 'data-vat': '1' }, `${inv.vatLabel} ${inv.vat}`),
    h('p', { class: 'money', 'data-gross': '1' }, `Gross ${inv.gross}`),
    h('p', { class: 'row noprint' },
      h('a', { href: `#/invoices/${inv.id}/print` }, 'Print view'),
      locked ? null : h('button', { type: 'button', onClick: () => markIssued(inv.id) }, 'Mark issued'),
      locked ? h('button', { type: 'button', id: 'credit-invoice', onClick: () => askCredit(inv.id) }, 'Credit') : null,
      h('button', { type: 'button', id: 'send-invoice', onClick: () => copyDraft(inv) }, 'Send'),
    ),
    h('p', { 'data-credit-result': '1' }),
    h('p', { 'data-send-result': '1' }),
    h('textarea', { 'data-draft': '1', readonly: true, class: 'noprint' }),
  )
}

function addLine() {
  state.editLines = state.editLines.map((line, i) => ({
    description: value(`line-desc-${i}`),
    net: value(`line-net-${i}`),
  }))
  state.editLines.push({ description: '', net: '' })
  draw()
}

async function saveInvoice(ev, id) {
  ev.preventDefault()
  const err = document.getElementById('form-error')
  err.textContent = ''
  const lines = state.editLines.map((_, i) => ({
    description: value(`line-desc-${i}`),
    net: value(`line-net-${i}`),
  }))
  try {
    state.editFor = null
    await api(`/api/invoices/${id}`, { method: 'PATCH', body: { date: value('inv-date'), lines } })
    await loadBook()
  } catch (e) {
    err.textContent = e.message
  }
}

async function askCredit(id) {
  try {
    const out = await api(`/api/invoices/${id}/credit`, { method: 'POST', body: {} })
    await loadBook()
    if (out.creditNote?.id) location.hash = `#/credits/${out.creditNote.id}`
  } catch (e) {
    const node = document.querySelector('[data-credit-result]')
    if (node) node.textContent = e.message
  }
}

async function markIssued(id) {
  try {
    state.editFor = null
    await api(`/api/invoices/${id}/issue`, { method: 'POST', body: {} })
    await loadBook()
  } catch (e) {
    const err = document.getElementById('form-error')
    if (err) err.textContent = e.message
  }
}

function copyDraft(inv) {
  const company = state.book?.company || { name: 'Treun Roc Contracts Ltd', number: '', address: '' }
  const lines = inv.lines.map((line) => `${line.description}  ${line.net}`).join('\n')
  const draft = [
    'INVOICE DRAFT',
    company.name,
    company.number ? `Company number ${company.number}` : '',
    company.address,
    inv.number,
    inv.dateDisplay,
    inv.jobName,
    inv.clientName,
    inv.siteAddress,
    lines,
    `Net ${inv.net}`,
    `${inv.vatLabel} ${inv.vat}`,
    `Gross ${inv.gross}`,
  ].filter(Boolean).join('\n')
  const box = document.querySelector('[data-draft]')
  const result = document.querySelector('[data-send-result]')
  if (box) box.value = draft
  if (result) result.textContent = 'not sent'
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(draft).catch(() => {})
  }
}

function screenPrint(id) {
  const inv = (state.book?.invoices || []).find((row) => row.id === id)
  if (!inv) return h('main', { 'data-screen': 'print' }, h('p', null, 'That invoice is not on the desk.'))
  const company = state.book.company
  return h(
    'main',
    { 'data-screen': 'print', class: 'card' },
    h('h2', null, company.name),
    h('p', null, `Company number ${company.number}`),
    h('p', null, company.address),
    h('h3', null, inv.number),
    h('p', null, `Date ${inv.dateDisplay}`),
    h('p', null, `Job ${inv.jobName}`),
    h('p', null, `Client ${inv.clientName}`),
    h('p', { 'data-site': '1' }, `Site ${inv.siteAddress}`),
    h('table', null,
      h('thead', null, h('tr', null, h('th', null, 'Description'), h('th', { class: 'num' }, 'Net'))),
      h('tbody', null, inv.lines.map((line) => h('tr', null, h('td', null, line.description), h('td', { class: 'num' }, line.net)))),
    ),
    h('p', null, `Net ${inv.net}`),
    h('p', null, `${inv.vatLabel} ${inv.vat}`),
    h('p', { class: 'money', 'data-gross': '1' }, `Total ${inv.gross}`),
    h('p', { class: 'noprint row' },
      h('button', { type: 'button', onClick: () => window.print() }, 'Print'),
      h('a', { href: `#/invoices/${inv.id}` }, 'Back to invoice'),
    ),
  )
}

function screenBills() {
  const bills = state.book?.supplierBills || []
  return h(
    'main',
    { 'data-screen': 'bills' },
    h('h2', null, 'Supplier bills'),
    h('p', { class: 'muted' }, 'Bills you owe. They are not client invoices.'),
    h('form', { class: 'card', onSubmit: saveBill },
      field('Supplier', h('input', { id: 'bill-supplier', autocomplete: 'off' })),
      field('Date', h('input', { id: 'bill-date', placeholder: 'dd/mm/yyyy' })),
      field('Reference', h('input', { id: 'bill-ref', autocomplete: 'off' })),
      field('Net', h('input', { id: 'bill-net', inputmode: 'decimal', autocomplete: 'off' })),
      h('p', { id: 'form-error', class: 'err', role: 'alert', 'data-error': 'form' }),
      h('button', { type: 'submit' }, 'Add supplier bill'),
    ),
    bills.length
      ? h('table', null,
          h('thead', null, h('tr', null, h('th', null, 'Supplier'), h('th', null, 'Date'), h('th', null, 'Reference'), h('th', { class: 'num' }, 'Gross'))),
          h('tbody', null, bills.map((bill) => h('tr', { 'data-bill': bill.id },
            h('td', null, bill.supplier),
            h('td', null, bill.dateDisplay),
            h('td', null, bill.reference),
            h('td', { class: 'num' }, bill.gross),
          ))),
        )
      : h('div', { 'data-empty': '1' }, h('p', null, 'No supplier bills yet.')),
  )
}

async function saveBill(ev) {
  ev.preventDefault()
  const err = document.getElementById('form-error')
  err.textContent = ''
  if (!value('bill-supplier').trim()) {
    err.textContent = 'Enter the supplier name.'
    return
  }
  if (!value('bill-net').trim()) {
    err.textContent = 'Enter a bill amount.'
    return
  }
  try {
    await api('/api/supplier-bills', {
      method: 'POST',
      body: {
        supplier: value('bill-supplier'),
        date: value('bill-date'),
        reference: value('bill-ref'),
        net: value('bill-net'),
      },
    })
    await loadBook()
  } catch (e) {
    err.textContent = e.message
  }
}

function screenClient() {
  const view = state.clientView
  return h(
    'main',
    { 'data-screen': 'client' },
    h('p', { class: 'preview', 'data-preview': 'STAFF PREVIEW' }, 'STAFF PREVIEW'),
    h('h2', null, 'Client view'),
    h('form', { class: 'card', onSubmit: showClient },
      field('Client', h('input', { id: 'client-name', value: state.clientQuery, autocomplete: 'off' })),
      h('p', { id: 'form-error', class: 'err', role: 'alert', 'data-error': 'form' }),
      h('button', { type: 'submit' }, 'Show client'),
    ),
    view
      ? h('div', { 'data-client-result': '1' },
          h('h3', null, view.client),
          view.jobs.length
            ? h('table', null,
                h('thead', null, h('tr', null, h('th', null, 'Job'), h('th', null, 'Status'), h('th', null, 'Site'))),
                h('tbody', null, view.jobs.map((job) => h('tr', null,
                  h('td', null, job.name),
                  h('td', null, job.status),
                  h('td', null, job.siteAddress),
                ))),
              )
            : h('p', { 'data-empty': '1' }, 'No jobs for this client yet.'),
          h('h3', null, 'Issued invoices'),
          view.invoices.length
            ? h('ul', null, view.invoices.map((inv) => h('li', null, `${inv.number} ${inv.dateDisplay} ${inv.jobName} Gross ${inv.gross}`)))
            : h('p', null, 'No issued invoices yet.'),
        )
      : null,
  )
}

async function showClient(ev) {
  ev.preventDefault()
  const err = document.getElementById('form-error')
  const name = value('client-name').trim()
  state.clientQuery = name
  if (!name) {
    err.textContent = 'Enter a client name.'
    state.clientView = null
    return
  }
  try {
    state.clientView = await api(`/api/client-view?client=${encodeURIComponent(name)}`)
    draw()
  } catch (e) {
    state.clientView = null
    err.textContent = e.message
  }
}

function screenWorkers() {
  const workers = state.book?.workers || []
  return h(
    'main',
    { 'data-screen': 'workers' },
    h('h2', null, 'Workers'),
    h('form', { class: 'card', onSubmit: saveWorker },
      field('Name', h('input', { id: 'worker-name', autocomplete: 'off' })),
      field('Trade', h('input', { id: 'worker-trade', autocomplete: 'off' })),
      field('Phone', h('input', { id: 'worker-phone', autocomplete: 'off' })),
      field('CIS or PAYE', h('select', { id: 'worker-tax' }, options([['CIS', 'CIS'], ['PAYE', 'PAYE']], 'CIS'))),
      field('Ticket expiry', h('input', { id: 'worker-ticket', placeholder: 'dd/mm/yyyy' })),
      field('Note', h('input', { id: 'worker-note', autocomplete: 'off' })),
      h('p', { id: 'form-error', class: 'err', role: 'alert', 'data-error': 'form' }),
      h('button', { type: 'submit' }, 'Add worker'),
    ),
    workers.length
      ? h('ul', null, workers.map((w) => h('li', null,
          h('a', { href: `#/workers/${w.id}` }, w.name),
          w.trade ? ` ${w.trade}` : '',
          ` ${w.tax}`,
          w.ticketExpired ? h('span', { class: 'flag', 'data-ticket-flag': '1' }, ' Ticket expired') : '',
        )))
      : h('p', { 'data-empty': '1' }, 'No workers yet.'),
  )
}

async function saveWorker(ev) {
  ev.preventDefault()
  const err = document.getElementById('form-error')
  err.textContent = ''
  if (!value('worker-name').trim()) {
    err.textContent = 'Enter a worker name.'
    return
  }
  try {
    const out = await api('/api/workers', {
      method: 'POST',
      body: {
        name: value('worker-name'),
        trade: value('worker-trade'),
        phone: value('worker-phone'),
        tax: value('worker-tax'),
        ticketExpiry: value('worker-ticket'),
        note: value('worker-note'),
      },
    })
    await loadBook()
    location.hash = `#/workers/${out.worker.id}`
  } catch (e) {
    err.textContent = e.message
  }
}

function screenWorker(id) {
  const worker = (state.book?.workers || []).find((row) => row.id === id)
  if (!worker) return h('main', { 'data-screen': 'worker' }, h('p', null, 'That worker is not on the desk.'))
  return h(
    'main',
    { 'data-screen': 'worker' },
    h('p', null, h('a', { href: '#/workers' }, 'Workers')),
    h('h2', null, worker.name),
    h('p', null, worker.trade || 'Trade not set'),
    h('p', null, worker.phone || 'No phone'),
    h('p', null, worker.tax),
    h('p', null, worker.ticketExpiryDisplay ? `Ticket expiry ${worker.ticketExpiryDisplay}` : 'No ticket date'),
    worker.ticketExpired ? h('p', { class: 'flag', 'data-ticket-flag': '1' }, 'Ticket expired') : null,
    worker.note ? h('p', null, worker.note) : null,
    h('h3', null, 'Jobs'),
    worker.jobs.length
      ? h('ul', null, worker.jobs.map((job) => h('li', null, h('a', { href: `#/jobs/${job.id}` }, job.name))))
      : h('p', null, 'No jobs for this worker yet.'),
    h('h3', null, 'Hours'),
    (state.book?.hours || []).some((row) => row.workerId === worker.id)
      ? h('ul', null, (state.book.hours || []).filter((row) => row.workerId === worker.id).map((row) => h('li', null, `${row.dateDisplay} ${row.jobName} ${row.hours}h`)))
      : h('p', null, 'No hours for this worker yet.'),
  )
}

function liveJobs() {
  return (state.book?.jobs || []).filter((job) => job.status === 'live')
}

function reviewLines() {
  const book = state.book || {}
  return [...(book.variations || []), ...(book.costs || [])].filter((row) => row.review)
}

function screenHome() {
  const name = state.me?.name || 'staff'
  const book = state.book || {}
  const pending = [
    ...(book.variations || []),
    ...(book.costs || []),
    ...(book.supplierBills || []),
  ].filter((row) => row.approval === 'pending')
  const unread = (book.mail || []).filter((row) => !row.read)
  const openTenders = (book.tenders || []).filter((row) => row.status === 'open')
  const openQuotes = (book.quotes || []).filter((row) => row.status !== 'accepted')
  const waiting = [
    pending.length ? h('li', null, h('a', { href: '#/approvals' }, `${pending.length} waiting for approval`)) : null,
    unread.length ? h('li', null, h('a', { href: '#/mail' }, `${unread.length} unread mail`)) : null,
    openTenders.length ? h('li', null, h('a', { href: '#/tenders' }, `${openTenders.length} open tenders`)) : null,
    openQuotes.length ? h('li', null, h('a', { href: '#/quotes' }, `${openQuotes.length} quotes not accepted`)) : null,
  ].filter(Boolean)
  const live = liveJobs()
  const margin = live.reduce((sum, job) => sum + job.money.marginPence, 0)
  const review = reviewLines()
  const launches = [
    ['#/jobs', 'Jobs', 'Board and job file'],
    ['#/quotes', 'Quotes', 'Draft, then accept into a job'],
    ['#/tenders', 'Quick BD', 'Tenders'],
    ['#/approvals', 'Approvals', 'Review pile'],
    ['#/mail', 'Mail', 'Staff mail'],
    ['#/statements', 'Finance', 'Live margin'],
    ['#/invoices', 'Invoices', 'Client invoices'],
    ['#/bills', 'Supplier bills', 'Bills you owe'],
    ['#/suppliers', 'Suppliers', 'Who you buy from'],
    ['#/materials', 'Materials', 'Stock and purchase orders'],
    ['#/report', 'Report', 'Live jobs money'],
    ['#/monitor', 'Live Monitor', 'Jobs on site'],
    ['#/workers', 'Workers', 'CIS, PAYE, tickets'],
    ['#/site', 'Site', 'Site notes'],
    ['#/calendar', 'Calendar', 'Jobs by date'],
    ['#/files', 'Company files', 'Documents on jobs'],
    ['#/monday', 'Monday', 'Live jobs table'],
    ['#/client', 'Client view', 'Staff preview'],
  ]
  return h(
    'main',
    { 'data-screen': 'home' },
    h('h2', null, 'Home'),
    h('p', null, `Signed in as ${name}.`),
    h(
      'div',
      { class: 'split' },
      h(
        'section',
        { class: 'card', 'data-needs-you': '1' },
        h('h2', null, 'Needs you'),
        waiting.length ? h('ul', null, waiting) : h('p', null, 'Nothing is waiting.'),
      ),
      h(
        'section',
        { class: 'card', 'data-on-site': '1' },
        h('h2', null, 'On site'),
        live.length
          ? h('ul', null, live.map((job) => h('li', null, h('a', { href: `#/jobs/${job.id}` }, job.name), ` ${job.siteAddress}`)))
          : h('p', null, 'No jobs on site.'),
      ),
    ),
    h(
      'section',
      { class: 'card', 'data-money-pulse': '1' },
      h('h2', null, 'Money'),
      live.length
        ? h('p', { class: 'pulse', 'data-home-margin': '1' }, `Live margin ${formatPounds(margin)}`)
        : h('p', null, 'No live margin yet.'),
      h('p', { class: 'muted' }, 'Review pile is not in this figure.'),
      h('p', null, review.length ? `${review.length} review lines, still unallocated.` : 'No lines in the review pile.'),
    ),
    h('h2', null, 'Open'),
    h(
      'div',
      { class: 'launchers' },
      launches.map(([hash, label, hint]) =>
        h('a', { class: 'card launcher', href: hash }, h('strong', null, label), h('p', { class: 'muted' }, hint)),
      ),
    ),
  )
}

function screenQuotes() {
  const quotes = state.book?.quotes || []
  return h(
    'main',
    { 'data-screen': 'quotes' },
    h('div', { class: 'row' }, h('h2', null, 'Quotes'), h('button', { type: 'button', onClick: () => { location.hash = '#/quotes/new' } }, 'Add quote')),
    quotes.length
      ? h('table', null,
          h('thead', null, h('tr', null, h('th', null, 'Number'), h('th', null, 'Title'), h('th', null, 'Client'), h('th', null, 'Status'), h('th', { class: 'num' }, 'Net'))),
          h('tbody', null, quotes.map((quote) => h('tr', null,
            h('td', null, h('a', { href: `#/quotes/${quote.id}` }, quote.number)),
            h('td', null, quote.title),
            h('td', null, quote.client),
            h('td', null, quote.status),
            h('td', { class: 'num' }, quote.net),
          ))),
        )
      : empty('No quotes yet.', 'Add quote', '#/quotes/new'),
  )
}

function quoteForm(quote) {
  const locked = quote?.status === 'accepted'
  const vat = h('select', { id: 'quote-vat', disabled: locked }, options(
    [['standard', '20%'], ['zero', '0% zero-rate'], ['reverse', 'reverse charge']],
    quote?.vatTreatment || 'standard',
  ))
  vat.value = quote?.vatTreatment || 'standard'
  return h(
    'form',
    { class: 'card', onSubmit: (ev) => saveQuote(ev, quote?.id || null) },
    h('h2', null, quote ? quote.number : 'New quote'),
    field('Quote title', h('input', { id: 'quote-title', value: quote?.title || '', disabled: locked })),
    field('Client', h('input', { id: 'quote-client', value: quote?.client || '', disabled: locked })),
    field('Site address', h('input', { id: 'quote-site', value: quote?.siteAddress || '', disabled: locked })),
    field('Description', h('textarea', { id: 'quote-desc', disabled: locked }, quote?.description || '')),
    field('Net', h('input', { id: 'quote-net', inputmode: 'decimal', value: quote ? (quote.netPence / 100).toFixed(2) : '', disabled: locked })),
    field('VAT', vat),
    locked ? h('p', null, 'This quote is accepted. Open the job to change the work.') : null,
    h('p', { id: 'form-error', class: 'err', role: 'alert', 'data-error': 'form' }),
    locked ? null : h('button', { type: 'submit' }, 'Save quote'),
  )
}

async function saveQuote(ev, id) {
  ev.preventDefault()
  const err = document.getElementById('form-error')
  err.textContent = ''
  const payload = {
    title: value('quote-title'),
    client: value('quote-client'),
    siteAddress: value('quote-site'),
    description: value('quote-desc'),
    net: value('quote-net'),
    vatTreatment: value('quote-vat'),
  }
  if (!payload.title.trim()) {
    err.textContent = 'Enter a quote title.'
    return
  }
  try {
    const out = id
      ? await api(`/api/quotes/${id}`, { method: 'PATCH', body: payload })
      : await api('/api/quotes', { method: 'POST', body: payload })
    await loadBook()
    location.hash = `#/quotes/${out.quote.id}`
  } catch (e) {
    err.textContent = e.message
  }
}

function screenQuote(id) {
  const quote = (state.book?.quotes || []).find((row) => row.id === id)
  if (!quote) return h('main', { 'data-screen': 'quote' }, h('p', null, 'That quote is not on the desk.'))
  return h(
    'main',
    { 'data-screen': 'quote' },
    h('p', null, h('a', { href: '#/quotes' }, 'Quotes')),
    quoteForm(quote),
    h('p', null, `Net ${quote.net}`),
    h('p', null, `${quote.vatLabel} ${quote.vat}`),
    h('p', { class: 'money' }, `Gross ${quote.gross}`),
    h('p', null, quote.status),
    quote.jobId ? h('p', null, h('a', { href: `#/jobs/${quote.jobId}` }, quote.jobName || 'Open job')) : null,
    quoteTenders(quote),
    h('p', { class: 'row noprint' },
      quote.status === 'accepted' ? null : h('button', { type: 'button', onClick: () => sendQuote(quote.id) }, 'Send'),
      quote.status === 'accepted' ? null : h('button', { type: 'button', onClick: () => acceptQuote(quote.id) }, 'Accept'),
    ),
    h('p', { 'data-send-result': '1' }, state.quoteNoticeFor === quote.id ? state.quoteNotice : ''),
    h('textarea', { 'data-draft': '1', readonly: true, class: 'noprint' }, state.quoteNoticeFor === quote.id ? state.quoteDraft : ''),
  )
}

async function sendQuote(id) {
  try {
    const out = await api(`/api/quotes/${id}/draft`, { method: 'POST', body: {} })
    state.quoteNoticeFor = id
    state.quoteNotice = 'not sent'
    state.quoteDraft = out.draft || ''
    await loadBook()
  } catch (e) {
    const err = document.getElementById('form-error')
    if (err) err.textContent = e.message
  }
}

async function acceptQuote(id) {
  try {
    const out = await api(`/api/quotes/${id}/accept`, { method: 'POST', body: {} })
    await loadBook()
    location.hash = `#/jobs/${out.job.id}`
  } catch (e) {
    const err = document.getElementById('form-error')
    if (err) err.textContent = e.message
  }
}

function quoteTenders(quote) {
  const rows = (state.book?.tenders || []).filter((row) => row.quoteId === quote.id)
  if (!rows.length) return null
  return h(
    'section',
    { 'data-quote-tenders': '1' },
    h('h3', null, 'Tenders'),
    h('ul', null, rows.map((tender) => h('li', null, h('a', { href: `#/tenders/${tender.id}` }, tender.title), ` ${tender.status}`))),
  )
}

function screenTenders() {
  const tenders = state.book?.tenders || []
  return h(
    'main',
    { 'data-screen': 'tenders' },
    h('div', { class: 'row' }, h('h2', null, 'Quick BD'), h('button', { type: 'button', onClick: () => { location.hash = '#/tenders/new' } }, 'Add tender')),
    h('p', { class: 'muted' }, 'Quick BD is the tender list on this desk. It is not an external bid portal.'),
    tenders.length
      ? h('table', null,
          h('thead', null, h('tr', null, h('th', null, 'Tender'), h('th', null, 'Client'), h('th', null, 'Status'), h('th', null, 'Due'), h('th', null, 'Link'))),
          h('tbody', null, tenders.map((tender) => h('tr', null,
            h('td', null, h('a', { href: `#/tenders/${tender.id}` }, tender.title)),
            h('td', null, tender.client),
            h('td', null, tender.status),
            h('td', null, tender.dueDateDisplay || ''),
            h('td', null,
              tender.jobId ? h('a', { href: `#/jobs/${tender.jobId}` }, tender.jobName || 'Job') : null,
              tender.jobId && tender.quoteId ? ' · ' : null,
              tender.quoteId ? h('a', { href: `#/quotes/${tender.quoteId}` }, tender.quoteNumber || 'Quote') : null,
              !tender.jobId && !tender.quoteId ? 'No link yet' : null,
            ),
          ))),
        )
      : empty('No tenders yet.', 'Add tender', '#/tenders/new'),
  )
}

function tenderForm(tender) {
  const status = h('select', { id: 'tender-status' }, options(
    [['open', 'open'], ['submitted', 'submitted'], ['won', 'won'], ['lost', 'lost']],
    tender?.status || 'open',
  ))
  status.value = tender?.status || 'open'
  const quotes = state.book?.quotes || []
  const jobs = state.book?.jobs || []
  return h(
    'form',
    { class: 'card', onSubmit: (ev) => saveTender(ev, tender?.id || null) },
    h('h2', null, tender ? tender.title : 'New tender'),
    field('Tender title', h('input', { id: 'tender-title', value: tender?.title || '' })),
    field('Client', h('input', { id: 'tender-client', value: tender?.client || '' })),
    field('Status', status),
    field('Due date', h('input', { id: 'tender-due', placeholder: 'dd/mm/yyyy', value: tender?.dueDateDisplay || '' })),
    field('Note', h('textarea', { id: 'tender-note' }, tender?.note || '')),
    field('Quote', h('select', { id: 'tender-quote' }, h('option', { value: '' }, 'None'), quotes.map((quote) => h('option', { value: quote.id, selected: quote.id === tender?.quoteId }, quote.number)))),
    field('Job', h('select', { id: 'tender-job' }, h('option', { value: '' }, 'None'), jobs.map((job) => h('option', { value: job.id, selected: job.id === tender?.jobId }, job.name)))),
    h('p', { id: 'form-error', class: 'err', role: 'alert', 'data-error': 'form' }),
    h('button', { type: 'submit' }, 'Save tender'),
  )
}

async function saveTender(ev, id) {
  ev.preventDefault()
  const err = document.getElementById('form-error')
  err.textContent = ''
  const payload = {
    title: value('tender-title'),
    client: value('tender-client'),
    status: value('tender-status'),
    dueDate: value('tender-due'),
    note: value('tender-note'),
    quoteId: value('tender-quote'),
    jobId: value('tender-job'),
  }
  if (!payload.title.trim()) {
    err.textContent = 'Enter a tender title.'
    return
  }
  try {
    const out = id
      ? await api(`/api/tenders/${id}`, { method: 'PATCH', body: payload })
      : await api('/api/tenders', { method: 'POST', body: payload })
    await loadBook()
    location.hash = `#/tenders/${out.tender.id}`
  } catch (e) {
    err.textContent = e.message
  }
}

function approvalRows(which) {
  const book = state.book || {}
  const rows = []
  for (const row of book.variations || []) {
    if (row.approval === which) rows.push({ ...row, kind: 'variation', kindLabel: 'Variation' })
  }
  for (const row of book.costs || []) {
    if (row.approval === which) rows.push({ ...row, kind: 'cost', kindLabel: 'Cost' })
  }
  for (const row of book.supplierBills || []) {
    if (row.approval === which) {
      rows.push({ ...row, kind: 'bill', kindLabel: 'Supplier bill', description: row.supplier, amount: row.gross })
    }
  }
  return rows
}

function screenTender(id) {
  const tender = (state.book?.tenders || []).find((row) => row.id === id)
  if (!tender) {
    return h('main', { 'data-screen': 'tender' }, h('p', null, 'That tender is not on the desk.'), h('a', { href: '#/tenders' }, 'Quick BD'))
  }
  return h(
    'main',
    { 'data-screen': 'tender' },
    h('p', null, h('a', { href: '#/tenders' }, 'Quick BD')),
    h('p', { class: 'muted' }, 'This tender stays on the desk. Nothing is sent to a public bid portal.'),
    tenderForm(tender),
    tender.quoteId ? h('p', null, 'Quote ', h('a', { href: `#/quotes/${tender.quoteId}` }, tender.quoteNumber || 'Quote')) : h('p', null, 'No quote linked.'),
    tender.jobId ? h('p', null, 'Job ', h('a', { href: `#/jobs/${tender.jobId}` }, tender.jobName || 'Job')) : h('p', null, 'No job linked.'),
    tender.status === 'lost' ? h('p', null, 'Lost. The quote and job links stay on this tender.') : null,
    !tender.jobId && tender.status !== 'lost'
      ? h('p', { class: 'row' }, h('button', { type: 'button', onClick: () => winTender(tender.id) }, 'Create job'))
      : null,
    h('p', { id: 'win-error', class: 'err', role: 'alert' }),
  )
}

async function winTender(id) {
  const err = document.getElementById('win-error')
  if (err) err.textContent = ''
  try {
    await api(`/api/tenders/${id}/win`, { method: 'POST', body: {} })
    await loadBook()
  } catch (e) {
    if (err) err.textContent = e.message
  }
}

function approvalText(row) {
  const desc = row.description && row.description !== row.kindLabel ? `${row.kindLabel} · ${row.description}` : row.kindLabel
  return [desc, row.mark, row.amount].filter(Boolean).join(' · ')
}

function screenApprovals() {
  const pending = approvalRows('pending')
  const held = approvalRows('in-review').filter((row) => row.review)
  return h(
    'main',
    { 'data-screen': 'approvals' },
    h('h2', null, 'Approvals'),
    h('p', { class: 'muted' }, 'Ryan, Ryan2 and Kacey lines stay out of the margin.'),
    pending.length
      ? h('ul', null, pending.map((row) => h('li', { 'data-approval': row.id },
          `${approvalText(row)} `,
          h('button', { type: 'button', onClick: () => approveRow(row) }, 'Approve into review'),
        )))
      : h('p', { 'data-empty': '1' }, 'Nothing needs approval.'),
    h('section', { class: 'card', 'data-allocation': '1' },
      h('h2', null, 'Review allocation'),
      h('p', null, 'Unallocated. This desk does not allocate Ryan, Ryan2 or Kacey lines.'),
      held.length
        ? h('ul', null, held.map((row) => h('li', null, approvalText(row))))
        : h('p', null, 'No lines are in review allocation.'),
    ),
    h('p', { id: 'form-error', class: 'err', role: 'alert' }),
  )
}

async function approveRow(row) {
  const err = document.getElementById('form-error')
  try {
    await api('/api/approvals', { method: 'POST', body: { kind: row.kind, id: row.id } })
    await loadBook()
  } catch (e) {
    if (err) err.textContent = e.message
  }
}

function mailboxBanner() {
  const box = state.book?.mailbox
  if (box?.connected && !box.banner) return null
  const text = box?.banner || 'Mailbox not connected — set GRAPH_… on the host'
  return h('p', { class: 'card', 'data-mailbox-banner': '1', role: 'status' }, text)
}

function screenMail() {
  const threads = state.book?.mail || []
  const connected = Boolean(state.book?.mailbox?.connected)
  return h(
    'main',
    { 'data-screen': 'mail', 'data-mailbox': connected ? (state.book.mailbox.mode || 'on') : 'off' },
    h('div', { class: 'row' }, h('h2', null, 'Mail'), h('button', { type: 'button', onClick: () => { location.hash = '#/mail/new' } }, 'Log a message')),
    mailboxBanner(),
    h('p', { class: 'muted' }, 'Replies stay drafts and are not sent.'),
    threads.length
      ? h('ul', null, threads.map((thread) => h('li', { 'data-mail': thread.id },
          h('a', { href: `#/mail/${thread.id}` }, thread.subject),
          ` ${thread.from}`,
          thread.receivedDisplay ? ` ${thread.receivedDisplay}` : '',
          thread.jobId ? h('a', { href: `#/jobs/${thread.jobId}` }, thread.jobName || 'Job') : ' No job',
          thread.read ? ' read' : ' unread',
        )))
      : empty('No mail yet.', 'Log a message', '#/mail/new'),
  )
}

function screenMailNew() {
  const jobs = state.book?.jobs || []
  return h(
    'main',
    { 'data-screen': 'mail-new' },
    h('h2', null, 'Log a message'),
    h('form', { class: 'card', onSubmit: saveMail },
      field('Subject', h('input', { id: 'mail-subject' })),
      field('From', h('input', { id: 'mail-from' })),
      field('Message', h('textarea', { id: 'mail-body' })),
      jobs.length
        ? field('Job', h('select', { id: 'mail-job' }, h('option', { value: '' }, 'None'), jobs.map((job) => h('option', { value: job.id }, job.name))))
        : null,
      h('p', { id: 'form-error', class: 'err', role: 'alert' }),
      h('button', { type: 'submit' }, 'Save message'),
    ),
  )
}

async function saveMail(ev) {
  ev.preventDefault()
  const err = document.getElementById('form-error')
  err.textContent = ''
  try {
    const out = await api('/api/mail', {
      method: 'POST',
      body: {
        subject: value('mail-subject'),
        from: value('mail-from'),
        body: value('mail-body'),
        jobId: value('mail-job'),
      },
    })
    await loadBook()
    location.hash = `#/mail/${out.thread.id}`
  } catch (e) {
    err.textContent = e.message
  }
}

function screenThread(id) {
  const thread = (state.book?.mail || []).find((row) => row.id === id)
  if (!thread) return h('main', { 'data-screen': 'mail-thread' }, h('p', null, 'That message is not on the desk.'))
  return h(
    'main',
    { 'data-screen': 'mail-thread' },
    h('p', null, h('a', { href: '#/mail' }, 'Mail')),
    h('h2', null, thread.subject),
    h('p', null, `From ${thread.from}`),
    thread.receivedDisplay ? h('p', null, `Received ${thread.receivedDisplay}`) : null,
    h('p', null, thread.read ? 'Read' : 'Unread'),
    h('p', null, thread.body),
    thread.jobId ? h('p', null, h('a', { href: `#/jobs/${thread.jobId}` }, thread.jobName || 'Open job')) : h('p', null, 'No job'),
    h('p', { class: 'row' },
      h('button', { type: 'button', onClick: () => markThread(thread, !thread.read) }, thread.read ? 'Mark unread' : 'Mark read'),
    ),
    (thread.replies || []).map((reply) => h('p', null, `Draft: ${reply.text} — not sent`)),
    h('form', { class: 'card', onSubmit: (ev) => saveReply(ev, thread.id) },
      field('Reply', h('textarea', { id: 'mail-reply' })),
      h('p', { id: 'form-error', class: 'err', role: 'alert' }),
      h('button', { type: 'submit' }, 'Save draft reply'),
      h('p', { 'data-send-result': '1' }, state.mailNoticeFor === id ? state.mailNotice : ''),
    ),
  )
}

async function markThread(thread, read) {
  try {
    await api(`/api/mail/${thread.id}/read`, { method: 'POST', body: { read } })
    await loadBook()
  } catch (e) {
    const err = document.getElementById('form-error')
    if (err) err.textContent = e.message
  }
}

async function saveReply(ev, id) {
  ev.preventDefault()
  const err = document.getElementById('form-error')
  err.textContent = ''
  try {
    const out = await api(`/api/mail/${id}/draft`, { method: 'POST', body: { text: value('mail-reply') } })
    state.mailNoticeFor = id
    state.mailNotice = out.notSent ? 'not sent' : ''
    await loadBook()
  } catch (e) {
    err.textContent = e.message
  }
}

function screenFinance() {
  const live = liveJobs()
  const review = reviewLines()
  const reviewPence = review.reduce((sum, row) => sum + row.amountPence, 0)
  const bills = state.book?.supplierBills || []
  const billPence = bills.reduce((sum, row) => sum + row.grossPence, 0)
  const totals = {
    contract: live.reduce((sum, job) => sum + job.money.contractSumPence, 0),
    costs: live.reduce((sum, job) => sum + job.money.costsPence, 0),
    margin: live.reduce((sum, job) => sum + job.money.marginPence, 0),
  }
  return h(
    'main',
    { 'data-screen': 'statements' },
    h('h2', null, 'Finance'),
    h('p', { class: 'formula' }, 'Live margin = contract sum + approved variations − costs. Review lines are not in the total.'),
    live.length
      ? h('div', null,
          h('p', { class: 'pulse', 'data-finance-margin': '1' }, `Live margin ${formatPounds(totals.margin)}`),
          h('table', null,
            h('thead', null, h('tr', null, h('th', null, 'Job'), h('th', { class: 'num' }, 'Contract sum'), h('th', { class: 'num' }, 'Costs'), h('th', { class: 'num' }, 'Margin'), h('th', null, 'Status'))),
            h('tbody', null,
              live.map((job) => h('tr', null,
                h('td', null, h('a', { href: `#/jobs/${job.id}` }, job.name)),
                h('td', { class: 'num' }, job.money.contractSum),
                h('td', { class: 'num' }, job.money.costs),
                h('td', { class: 'num' }, job.money.margin),
                h('td', null, job.status),
              )),
              h('tr', null,
                h('th', null, 'Total'),
                h('td', { class: 'num' }, formatPounds(totals.contract)),
                h('td', { class: 'num' }, formatPounds(totals.costs)),
                h('td', { class: 'num', 'data-finance-total': '1' }, formatPounds(totals.margin)),
                h('td'),
              ),
            ),
          ),
        )
      : h('p', { 'data-empty': '1' }, 'No live jobs yet.'),
    h('section', { class: 'card', 'data-review': '1' },
      h('h2', null, 'Review pile'),
      h('p', null, 'Not in the margin.'),
      review.length
        ? h('p', { 'data-review-total': '1' }, formatPounds(reviewPence))
        : h('p', null, 'No lines in the review pile.'),
      review.map((row) => h('p', null, `${row.description} ${row.mark} ${row.amount}`)),
    ),
    h('section', { class: 'card', 'data-bills': '1' },
      h('h2', null, 'Supplier bills'),
      h('p', { class: 'muted' }, 'Bills you owe. They are not client invoices.'),
      bills.length
        ? h('p', { 'data-bills-total': '1' }, formatPounds(billPence))
        : h('p', null, 'No supplier bills yet.'),
      bills.map((bill) => h('p', null, `${bill.supplier} ${bill.gross}`)),
    ),
    creditNotesCard(),
  )
}

function creditNotesCard() {
  const notes = state.book?.creditNotes || []
  return h(
    'section',
    { class: 'card', 'data-credits': '1' },
    h('h2', null, 'Credit notes'),
    h('p', { class: 'muted' }, 'Not in the live margin. Issued invoice totals stay as they were.'),
    notes.length
      ? h('ul', null, notes.map((note) => h('li', null, h('a', { href: `#/credits/${note.id}` }, note.number), ` ${note.jobName} ${note.gross}`)))
      : h('p', null, 'No credit notes yet.'),
  )
}

function screenMonitor() {
  const live = liveJobs()
  return h(
    'main',
    { 'data-screen': 'monitor' },
    h('h2', null, 'Live Monitor'),
    h('p', { class: 'muted' }, 'On site means status live. There is no separate tracker.'),
    live.length
      ? h('ul', null, live.map((job) => h('li', { 'data-on-site-job': job.id },
          h('a', { href: `#/jobs/${job.id}` }, job.name),
          ` ${job.siteAddress}`,
          job.workers.length ? ` · ${job.workers.map((w) => w.name).join(', ')}` : '',
        )))
      : h('p', { 'data-empty': '1' }, 'No live jobs on site.'),
  )
}

function screenSite() {
  const notes = state.book?.siteNotes || []
  const jobs = state.book?.jobs || []
  return h(
    'main',
    { 'data-screen': 'site' },
    h('h2', null, 'Site'),
    jobs.length
      ? h('form', { class: 'card', onSubmit: saveSiteFromList },
          field('Job', h('select', { id: 'site-job' }, jobs.map((job) => h('option', { value: job.id }, job.name)))),
          field('Site note', h('textarea', { id: 'site-note' })),
          h('p', { id: 'form-error', class: 'err', role: 'alert' }),
          h('button', { type: 'submit' }, 'Add site note'),
        )
      : empty('No site notes yet.', 'Add job', '#/jobs/new'),
    notes.length
      ? h('ul', null, notes.map((note) => h('li', null, h('a', { href: `#/jobs/${note.jobId}` }, note.jobName || 'Job'), ` ${note.atDisplay} ${note.text}`)))
      : jobs.length ? h('p', { 'data-empty': '1' }, 'No site notes yet.') : null,
  )
}

async function saveSiteFromList(ev) {
  ev.preventDefault()
  const err = document.getElementById('form-error')
  err.textContent = ''
  const jobId = value('site-job')
  if (!value('site-note').trim()) {
    err.textContent = 'Enter the site note.'
    return
  }
  try {
    await api(`/api/jobs/${jobId}/site-notes`, { method: 'POST', body: { text: value('site-note') } })
    await loadBook()
  } catch (e) {
    err.textContent = e.message
  }
}

function screenCalendar() {
  const jobs = (state.book?.jobs || []).filter((job) => job.startDate).sort((a, b) => a.startDate.localeCompare(b.startDate))
  return h(
    'main',
    { 'data-screen': 'calendar' },
    h('h2', null, 'Calendar'),
    jobs.length
      ? h('ul', null, jobs.map((job) => h('li', null, `${job.startDateDisplay} `, h('a', { href: `#/jobs/${job.id}` }, job.name), ` ${job.status}`)))
      : empty('No dated jobs yet.', 'Add', '#/jobs/new'),
  )
}

function screenFiles() {
  const files = state.book?.files || []
  const jobs = state.book?.jobs || []
  return h(
    'main',
    { 'data-screen': 'files' },
    h('h2', null, 'Company files'),
    h('p', { class: 'muted' }, 'Documents saved on a job.'),
    files.length
      ? h('ul', null, files.map((file) => h('li', null, file.name, ' ', h('a', { href: `#/jobs/${file.jobId}` }, file.jobName || 'Job'))))
      : jobs.length
        ? h('div', { 'data-empty': '1' }, h('p', null, 'No company files yet.'), h('button', { type: 'button', onClick: () => { location.hash = '#/jobs' } }, 'Add'))
        : empty('No company files yet.', 'Add job', '#/jobs/new'),
  )
}

function screenReport() {
  const live = liveJobs()
  if (!live.length) {
    return h(
      'main',
      { 'data-screen': 'report' },
      h('h2', null, 'Report'),
      h('p', { 'data-empty': '1' }, 'No live jobs yet. When a job is live, this table shows the same contract sum, costs, and margin as the job and Monday.'),
    )
  }
  const totals = {
    contract: live.reduce((sum, job) => sum + job.money.contractSumPence, 0),
    costs: live.reduce((sum, job) => sum + job.money.costsPence, 0),
    margin: live.reduce((sum, job) => sum + job.money.marginPence, 0),
  }
  return h(
    'main',
    { 'data-screen': 'report' },
    h('h2', null, 'Report'),
    h('p', null, 'These figures match the job and Monday. Review lines are not included.'),
    h(
      'table',
      null,
      h('thead', null, h('tr', null,
        h('th', null, 'Job'),
        h('th', { class: 'num' }, 'Contract sum'),
        h('th', { class: 'num' }, 'Costs'),
        h('th', { class: 'num' }, 'Margin'),
        h('th', null, 'Status'),
      )),
      h('tbody', null,
        live.map((job) => h('tr', { 'data-report-row': job.id },
          h('td', null, h('a', { href: `#/jobs/${job.id}` }, job.name)),
          h('td', { class: 'num' }, job.money.contractSum),
          h('td', { class: 'num' }, job.money.costs),
          h('td', { class: 'num', 'data-report-margin': job.id }, job.money.margin),
          h('td', null, job.status),
        )),
        h('tr', null,
          h('th', null, 'Total'),
          h('td', { class: 'num' }, formatPounds(totals.contract)),
          h('td', { class: 'num' }, formatPounds(totals.costs)),
          h('td', { class: 'num', 'data-report-total': '1' }, formatPounds(totals.margin)),
          h('td'),
        ),
      ),
    ),
  )
}

function screenMaterials(focusId) {
  const materials = state.book?.materials || []
  const orders = state.book?.purchaseOrders || []
  const jobs = state.book?.jobs || []
  return h(
    'main',
    { 'data-screen': 'materials' },
    h('h2', null, 'Materials'),
    h('p', { class: 'muted' }, 'Stock and the price catalogue. A purchase order does not change the live margin or the stock quantity.'),
    h(
      'form',
      { class: 'card', onSubmit: saveMaterial },
      field('Material name', h('input', { id: 'mat-name', autocomplete: 'off' })),
      field('Unit', h('input', { id: 'mat-unit', autocomplete: 'off', placeholder: 'each' })),
      field('Catalogue price', h('input', { id: 'mat-price', inputmode: 'decimal', autocomplete: 'off' })),
      field('Stock quantity', h('input', { id: 'mat-qty', inputmode: 'decimal', autocomplete: 'off' })),
      h('p', { id: 'form-error', class: 'err', role: 'alert', 'data-error': 'form' }),
      h('button', { type: 'submit' }, 'Add material'),
    ),
    materials.length
      ? h('table', null,
          h('thead', null, h('tr', null, h('th', null, 'Name'), h('th', null, 'Unit'), h('th', { class: 'num' }, 'Price'), h('th', { class: 'num' }, 'Qty'))),
          h('tbody', null, materials.map((row) => h('tr', { 'data-material': row.id },
            h('td', null, row.name),
            h('td', null, row.unit),
            h('td', { class: 'num' }, row.price),
            h('td', { class: 'num', 'data-stock': row.id }, row.qty),
          ))),
        )
      : h('p', { 'data-empty': 'materials' }, 'No materials yet.'),
    h('h2', null, 'Purchase orders'),
    materials.length && jobs.length
      ? h(
          'form',
          { class: 'card', onSubmit: saveOrder },
          field('Order supplier', h('input', { id: 'po-supplier', autocomplete: 'off' })),
          field('Order job', h('select', { id: 'po-job' }, jobs.map((job) => h('option', { value: job.id }, job.name)))),
          field('Order material', h('select', { id: 'po-material' }, materials.map((row) => h('option', { value: row.id }, row.name)))),
          field('Order quantity', h('input', { id: 'po-qty', inputmode: 'decimal', autocomplete: 'off' })),
          h('p', { id: 'po-error', class: 'err', role: 'alert' }),
          h('button', { type: 'submit' }, 'Add purchase order'),
        )
      : jobs.length
        ? h('p', null, 'Add a material before a purchase order.')
        : h('div', null,
            h('p', null, 'Add a job before a purchase order.'),
            h('button', { type: 'button', onClick: () => { location.hash = '#/jobs/new' } }, 'Add job'),
          ),
    focusId && !orders.some((po) => po.id === focusId)
      ? h('p', null, 'That purchase order is not on the desk.')
      : null,
    orders.length
      ? h('ul', null, orders.map((po) => h('li', { 'data-po': po.id, 'data-po-focus': focusId === po.id ? '1' : null },
          h('a', { href: `#/materials/${po.id}` }, po.number),
          ' ',
          po.supplierId ? h('a', { href: `#/suppliers/${po.supplierId}` }, po.supplier) : po.supplier,
          ' ',
          po.jobId ? h('a', { href: `#/jobs/${po.jobId}` }, po.jobName || 'Job') : '',
          ` ${po.net}`,
        )))
      : h('p', { 'data-empty': 'orders' }, 'No purchase orders yet.'),
  )
}

async function saveMaterial(ev) {
  ev.preventDefault()
  const err = document.getElementById('form-error')
  err.textContent = ''
  if (!value('mat-name').trim()) {
    err.textContent = 'Enter a material name.'
    return
  }
  if (!value('mat-price').trim()) {
    err.textContent = 'Enter the catalogue price.'
    return
  }
  try {
    await api('/api/materials', {
      method: 'POST',
      body: {
        name: value('mat-name'),
        unit: value('mat-unit'),
        price: value('mat-price'),
        qty: value('mat-qty'),
      },
    })
    await loadBook()
  } catch (e) {
    err.textContent = e.message
  }
}

async function saveOrder(ev) {
  ev.preventDefault()
  const err = document.getElementById('po-error')
  err.textContent = ''
  if (!value('po-supplier').trim()) {
    err.textContent = 'Enter the supplier name.'
    return
  }
  if (!value('po-qty').trim()) {
    err.textContent = 'Enter the order quantity.'
    return
  }
  try {
    await api('/api/purchase-orders', {
      method: 'POST',
      body: {
        supplier: value('po-supplier'),
        jobId: value('po-job'),
        materialId: value('po-material'),
        qty: value('po-qty'),
      },
    })
    await loadBook()
  } catch (e) {
    err.textContent = e.message
  }
}

function screenSuppliers() {
  const suppliers = state.book?.suppliers || []
  return h(
    'main',
    { 'data-screen': 'suppliers' },
    h('h2', null, 'Suppliers'),
    h('p', { class: 'muted' }, 'Suppliers and the bills you owe them. Bills are not client invoices.'),
    h(
      'form',
      { class: 'card', onSubmit: saveSupplier },
      field('Supplier name', h('input', { id: 'sup-name', autocomplete: 'off' })),
      field('Supplier phone', h('input', { id: 'sup-phone', autocomplete: 'off' })),
      h('p', { id: 'form-error', class: 'err', role: 'alert' }),
      h('button', { type: 'submit' }, 'Add supplier'),
    ),
    suppliers.length
      ? suppliers.map((sup) => h(
          'section',
          { class: 'card', 'data-supplier': sup.id },
          h('h3', null, h('a', { href: `#/suppliers/${sup.id}` }, sup.name)),
          sup.phone ? h('p', null, sup.phone) : null,
          sup.bills.length
            ? h('ul', null, sup.bills.map((bill) => h('li', { 'data-supplier-bill': bill.id }, `${bill.dateDisplay} ${bill.reference || ''} ${bill.gross}`)))
            : h('p', null, 'No bills for this supplier yet.'),
          h(
            'form',
            { onSubmit: (ev) => saveSupplierBill(ev, sup) },
            field('Bill date', h('input', { id: `sup-bill-date-${sup.id}`, placeholder: 'dd/mm/yyyy' })),
            field('Bill reference', h('input', { id: `sup-bill-ref-${sup.id}`, autocomplete: 'off' })),
            field('Bill net', h('input', { id: `sup-bill-net-${sup.id}`, inputmode: 'decimal', autocomplete: 'off' })),
            h('p', { id: `sup-bill-error-${sup.id}`, class: 'err', role: 'alert' }),
            h('button', { type: 'submit' }, 'Add bill'),
          ),
        ))
      : h('div', { 'data-empty': '1' }, h('p', null, 'No suppliers yet.')),
  )
}

function screenSupplier(id) {
  const sup = (state.book?.suppliers || []).find((row) => row.id === id)
  if (!sup) {
    return h(
      'main',
      { 'data-screen': 'supplier' },
      h('p', null, 'That supplier is not on the desk.'),
      h('a', { href: '#/suppliers' }, 'Suppliers'),
    )
  }
  const orders = sup.purchaseOrders || []
  return h(
    'main',
    { 'data-screen': 'supplier' },
    h('p', null, h('a', { href: '#/suppliers' }, 'Suppliers')),
    h('h2', null, sup.name),
    h('p', null, sup.phone || 'No phone'),
    h('h3', null, 'Bills'),
    sup.bills.length
      ? h('ul', null, sup.bills.map((bill) => h('li', { 'data-supplier-bill': bill.id }, `${bill.dateDisplay} ${bill.reference || ''} ${bill.gross}`)))
      : h('p', null, 'No bills for this supplier yet.'),
    h(
      'form',
      { class: 'card', onSubmit: (ev) => saveSupplierBill(ev, sup) },
      field('Bill date', h('input', { id: `sup-bill-date-${sup.id}`, placeholder: 'dd/mm/yyyy' })),
      field('Bill reference', h('input', { id: `sup-bill-ref-${sup.id}`, autocomplete: 'off' })),
      field('Bill net', h('input', { id: `sup-bill-net-${sup.id}`, inputmode: 'decimal', autocomplete: 'off' })),
      h('p', { id: `sup-bill-error-${sup.id}`, class: 'err', role: 'alert' }),
      h('button', { type: 'submit' }, 'Add bill'),
    ),
    h('h3', null, 'Purchase orders'),
    orders.length
      ? h('ul', null, orders.map((po) => h('li', { 'data-supplier-po': po.id },
          h('a', { href: `#/materials/${po.id}` }, po.number),
          ' ',
          po.jobId ? h('a', { href: `#/jobs/${po.jobId}` }, po.jobName || 'Job') : '',
          ` ${po.net}`,
        )))
      : h('p', null, 'No purchase orders for this supplier yet.'),
  )
}

async function saveSupplier(ev) {
  ev.preventDefault()
  const err = document.getElementById('form-error')
  err.textContent = ''
  if (!value('sup-name').trim()) {
    err.textContent = 'Enter the supplier name.'
    return
  }
  try {
    await api('/api/suppliers', {
      method: 'POST',
      body: { name: value('sup-name'), phone: value('sup-phone') },
    })
    await loadBook()
  } catch (e) {
    err.textContent = e.message
  }
}

async function saveSupplierBill(ev, sup) {
  ev.preventDefault()
  const err = document.getElementById(`sup-bill-error-${sup.id}`)
  if (err) err.textContent = ''
  const net = value(`sup-bill-net-${sup.id}`)
  if (!net.trim()) {
    if (err) err.textContent = 'Enter a bill amount.'
    return
  }
  try {
    await api('/api/supplier-bills', {
      method: 'POST',
      body: {
        supplier: sup.name,
        date: value(`sup-bill-date-${sup.id}`),
        reference: value(`sup-bill-ref-${sup.id}`),
        net,
      },
    })
    await loadBook()
  } catch (e) {
    if (err) err.textContent = e.message
  }
}

function screenCredit(id) {
  const note = (state.book?.creditNotes || []).find((row) => row.id === id)
  if (!note) return h('main', { 'data-screen': 'credit' }, h('p', null, 'That credit note is not on the desk.'))
  return h(
    'main',
    { 'data-screen': 'credit' },
    h('p', null, h('a', { href: `#/invoices/${note.invoiceId}` }, note.invoiceNumber), ' · ', h('a', { href: `#/jobs/${note.jobId}` }, note.jobName)),
    h('h2', { 'data-credit-number': note.number }, note.number),
    h('p', null, `Date ${note.dateDisplay}`),
    h('p', null, `Job ${note.jobName}`),
    h('p', null, `Invoice ${note.invoiceNumber}`),
    h('ul', null, note.lines.map((line) => h('li', null, `${line.description} ${line.net}`))),
    h('p', { 'data-net': '1' }, `Net ${note.net}`),
    h('p', { 'data-vat': '1' }, `${note.vatLabel} ${note.vat}`),
    h('p', { class: 'money', 'data-gross': '1' }, `Gross ${note.gross}`),
    h('p', null, 'The issued invoice and the live margin are unchanged.'),
    h('p', { class: 'row noprint' }, h('a', { href: `#/credits/${note.id}/print` }, 'Print view')),
  )
}

function screenCreditPrint(id) {
  const note = (state.book?.creditNotes || []).find((row) => row.id === id)
  if (!note) return h('main', { 'data-screen': 'credit-print' }, h('p', null, 'That credit note is not on the desk.'))
  const company = state.book.company
  return h(
    'main',
    { 'data-screen': 'credit-print', class: 'card' },
    h('h2', null, company.name),
    h('p', null, `Company number ${company.number}`),
    h('p', null, company.address),
    h('h3', null, 'CREDIT NOTE'),
    h('p', { 'data-credit-number': note.number }, note.number),
    h('p', null, `Date ${note.dateDisplay}`),
    h('p', null, `Invoice ${note.invoiceNumber}`),
    h('p', null, `Job ${note.jobName}`),
    h('p', null, `Client ${note.clientName}`),
    h('p', { 'data-site': '1' }, `Site ${note.siteAddress}`),
    h('table', null,
      h('thead', null, h('tr', null, h('th', null, 'Description'), h('th', { class: 'num' }, 'Net'))),
      h('tbody', null, note.lines.map((line) => h('tr', null, h('td', null, line.description), h('td', { class: 'num' }, line.net)))),
    ),
    h('p', null, `Net ${note.net}`),
    h('p', null, `${note.vatLabel} ${note.vat}`),
    h('p', { class: 'money', 'data-gross': '1' }, `Total ${note.gross}`),
    h('p', { class: 'noprint row' },
      h('button', { type: 'button', onClick: () => window.print() }, 'Print'),
      h('a', { href: `#/credits/${note.id}` }, 'Back to credit note'),
    ),
  )
}

function draw() {
  const app = document.getElementById('app')
  const { bits } = parseRoute()
  app.replaceChildren()
  if (!state.me) {
    app.append(bits[0] === 'client' ? screenBlocked() : screenLogin())
    return
  }
  if (state.loading && !state.book) {
    app.append(shell(screenLoading()))
    return
  }
  if (state.failed && !state.book) {
    app.append(shell(screenFailed()))
    return
  }
  const top = bits[0] || 'home'
  let body
  if (top === 'home') body = screenHome()
  else if (top === 'jobs' && !bits[1]) body = screenJobs()
  else if (top === 'jobs' && bits[1] === 'new') body = h('main', { 'data-screen': 'job-new' }, jobForm(null))
  else if (top === 'jobs') body = screenJob(bits[1])
  else if (top === 'quotes' && !bits[1]) body = screenQuotes()
  else if (top === 'quotes' && bits[1] === 'new') body = h('main', { 'data-screen': 'quote-new' }, quoteForm(null))
  else if (top === 'quotes') body = screenQuote(bits[1])
  else if (top === 'tenders' && !bits[1]) body = screenTenders()
  else if (top === 'tenders' && bits[1] === 'new') body = h('main', { 'data-screen': 'tender-new' }, tenderForm(null))
  else if (top === 'tenders') body = screenTender(bits[1])
  else if (top === 'approvals') body = screenApprovals()
  else if (top === 'mail' && !bits[1]) body = screenMail()
  else if (top === 'mail' && bits[1] === 'new') body = screenMailNew()
  else if (top === 'mail') body = screenThread(bits[1])
  else if (top === 'statements') body = screenFinance()
  else if (top === 'monday') body = screenMonday()
  else if (top === 'report') body = screenReport()
  else if (top === 'materials' && bits[1]) body = screenMaterials(bits[1])
  else if (top === 'materials') body = screenMaterials()
  else if (top === 'suppliers' && bits[1]) body = screenSupplier(bits[1])
  else if (top === 'suppliers') body = screenSuppliers()
  else if (top === 'credits' && bits[2] === 'print') body = screenCreditPrint(bits[1])
  else if (top === 'credits' && bits[1]) body = screenCredit(bits[1])
  else if (top === 'invoices' && bits[2] === 'print') body = screenPrint(bits[1])
  else if (top === 'invoices' && bits[1]) body = screenInvoice(bits[1])
  else if (top === 'invoices') body = screenInvoices()
  else if (top === 'bills') body = screenBills()
  else if (top === 'client') body = screenClient()
  else if (top === 'monitor') body = screenMonitor()
  else if (top === 'workers' && bits[1]) body = screenWorker(bits[1])
  else if (top === 'workers') body = screenWorkers()
  else if (top === 'site') body = screenSite()
  else if (top === 'calendar') body = screenCalendar()
  else if (top === 'files') body = screenFiles()
  else if (top === 'login') body = screenHome()
  else body = h('main', null, h('p', null, 'That page is not on the desk.'))
  app.append(shell(body))
}

window.addEventListener('hashchange', () => {
  state.menuOpen = false
  if (state.me && state.token) loadBook()
  else draw()
})

async function boot() {
  const saved = readSession()
  if (!saved?.token) {
    draw()
    return
  }
  state.token = saved.token
  state.me = saved
  try {
    const me = await api('/api/staff-auth')
    state.me = { token: saved.token, email: me.email, name: me.name, role: me.role }
    localStorage.setItem(SESSION_KEY, JSON.stringify(state.me))
  } catch (err) {
    clearSession()
    state.authError = err.status === 401 ? '' : err.message
    draw()
    return
  }
  try { state.botThread = sessionStorage.getItem('tr.bot.thread') || '' } catch { state.botThread = '' }
  await loadBook()
  if (state.botThread) await loadBot()
}

boot()
