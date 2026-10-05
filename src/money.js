/**
 * Ordinary UK construction money and dates for the staff desk.
 * Pounds and pence are stored as integer pence.
 */

export const FORMULA = 'Live margin = contract sum + approved variations - costs'

const REVIEW = new Set(['ryan', 'ryan2', 'kacey'])

export function companyProfile() {
  const address = (
    process.env.COMPANY_ADDRESS || '5 Mulberry Close, Watford, England, WD17 4UZ'
  ).trim()
  return {
    name: 'Treun Roc Contracts Ltd',
    number: String(process.env.COMPANY_NUMBER || '16649937').trim(),
    address,
  }
}

/**
 * @param {unknown} mark
 * @returns {''|'Ryan'|'Ryan2'|'Kacey'|null}
 */
export function parseMark(mark) {
  const s = String(mark ?? '').trim().toLowerCase()
  switch (s) {
    case '':
    case 'none':
      return ''
    case 'ryan':
      return 'Ryan'
    case 'ryan2':
      return 'Ryan2'
    case 'kacey':
      return 'Kacey'
    default:
      return null
  }
}

export function isReviewMark(mark) {
  return REVIEW.has(String(mark ?? '').trim().toLowerCase())
}

/**
 * @param {'standard'|'zero'|'reverse'} treatment
 */
export function vatSpec(treatment) {
  switch (treatment) {
    case 'standard':
      return { rate: 0.2, label: 'VAT 20%' }
    case 'zero':
      return { rate: 0, label: 'VAT 0% (zero-rate)' }
    case 'reverse':
      return { rate: 0, label: 'VAT reverse charge' }
    default: {
      const unknown = treatment
      throw new Error(`Unknown VAT treatment: ${String(unknown)}`)
    }
  }
}

/**
 * @param {unknown} value
 * @returns {'standard'|'zero'|'reverse'|null}
 */
export function parseVatTreatment(value) {
  const s = String(value ?? '').trim().toLowerCase()
  switch (s) {
    case '':
    case 'standard':
    case '20':
    case '20%':
      return 'standard'
    case 'zero':
    case 'zero-rate':
    case '0':
    case '0%':
      return 'zero'
    case 'reverse':
    case 'reverse charge':
    case 'reverse-charge':
      return 'reverse'
    default:
      return null
  }
}

/**
 * @param {unknown} value
 * @returns {'quoted'|'live'|'snagging'|'done'|null}
 */
export function parseStatus(value) {
  const s = String(value ?? '').trim().toLowerCase()
  switch (s) {
    case 'quoted':
    case 'live':
    case 'snagging':
    case 'done':
      return s
    default:
      return null
  }
}

/**
 * @param {'quoted'|'live'|'snagging'|'done'} status
 */
export function assertStatus(status) {
  switch (status) {
    case 'quoted':
    case 'live':
    case 'snagging':
    case 'done':
      return status
    default: {
      const unknown = status
      throw new Error(`Unknown status: ${String(unknown)}`)
    }
  }
}

/**
 * @param {unknown} value
 * @returns {'CIS'|'PAYE'|null}
 */
export function parseTax(value) {
  const s = String(value ?? '').trim().toLowerCase()
  switch (s) {
    case 'cis':
      return 'CIS'
    case 'paye':
      return 'PAYE'
    default:
      return null
  }
}

/**
 * @param {unknown} input
 * @returns {{ ok: true, pence: number } | { ok: false, error: string }}
 */
export function parsePounds(input) {
  const raw = String(input ?? '').trim()
  if (!raw) return { ok: false, error: 'Enter an amount in pounds and pence.' }
  const cleaned = raw.replace(/£/g, '').replace(/\s/g, '').replace(/,/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return { ok: false, error: 'Enter an amount in pounds and pence.' }
  }
  const [whole, frac = ''] = cleaned.split('.')
  const pence = Number(whole) * 100 + Number((frac + '00').slice(0, 2))
  if (!Number.isSafeInteger(pence)) {
    return { ok: false, error: 'Enter an amount in pounds and pence.' }
  }
  return { ok: true, pence }
}

export function formatPounds(pence) {
  const n = Number(pence) || 0
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  const pounds = Math.floor(abs / 100)
  const rem = abs % 100
  const grouped = String(pounds).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${sign}£${grouped}.${String(rem).padStart(2, '0')}`
}

export function vatPence(netPence, treatment) {
  const spec = vatSpec(treatment)
  if (spec.rate === 0) return 0
  return Math.round((netPence * 20) / 100)
}

/**
 * @param {number} marginPence
 * @param {number} basePence
 * @returns {string|null}
 */
export function marginPercent(marginPence, basePence) {
  if (!basePence) return null
  const pct = (marginPence / basePence) * 100
  return (Math.round(pct * 10) / 10).toFixed(1)
}

export function londonToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/**
 * @param {unknown} input
 * @returns {string|null} ISO date
 */
export function parseDate(input) {
  const s = String(input ?? '').trim()
  if (!s) return null
  const uk = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s)
  if (uk) {
    const d = Number(uk[1])
    const m = Number(uk[2])
    const y = Number(uk[3])
    if (!isRealDate(y, m, d)) return null
    return iso(y, m, d)
  }
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (isoMatch) {
    const y = Number(isoMatch[1])
    const m = Number(isoMatch[2])
    const d = Number(isoMatch[3])
    if (!isRealDate(y, m, d)) return null
    return iso(y, m, d)
  }
  return null
}

export function formatUk(isoDate) {
  if (!isoDate) return ''
  const [y, m, d] = String(isoDate).split('-')
  if (!y || !m || !d) return ''
  return `${d}/${m}/${y}`
}

function iso(y, m, d) {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function isRealDate(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return false
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

export function clip(value, max) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max)
}
