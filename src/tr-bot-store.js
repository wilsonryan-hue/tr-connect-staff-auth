/**
 * On-disk TR Bot desk chat threads (prep / local).
 * File: data/tr-bot-threads.json (gitignored).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

function dataDir() {
  return process.env.DATA_DIR || join(ROOT, 'data')
}

function storePathNow() {
  return process.env.TR_BOT_THREADS_PATH || join(dataDir(), 'tr-bot-threads.json')
}

function ensureDir() {
  const dir = dirname(storePathNow())
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

/** @returns {{ threads: Record<string, { id: string, createdAt: string, updatedAt: string, messages: object[] }> }} */
export function loadThreads() {
  ensureDir()
    const path = storePathNow()
  if (!existsSync(path)) {
    return { threads: {} }
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    const threads =
      raw && typeof raw.threads === 'object' && raw.threads ? raw.threads : {}
    return { threads }
  } catch {
    return { threads: {} }
  }
}

function saveThreads(book) {
  ensureDir()
  writeFileSync(storePathNow(), JSON.stringify(book, null, 2), 'utf8')
}

export function storePath() {
  return storePathNow()
}

function newId(prefix) {
  return `${prefix}_${randomBytes(8).toString('hex')}`
}

/**
 * @param {{ threadId?: string, staffName?: string, staffEmail?: string, text: string }} input
 */
export function appendStaffMessage(input) {
  const text = String(input.text ?? '').trim()
  if (!text) throw new Error('text required')
  const book = loadThreads()
  let threadId = String(input.threadId ?? '').trim()
  const now = new Date().toISOString()
  if (!threadId || !book.threads[threadId]) {
    threadId = newId('thr')
    book.threads[threadId] = {
      id: threadId,
      createdAt: now,
      updatedAt: now,
      messages: [],
    }
  }
  const msg = {
    id: newId('msg'),
    role: 'staff',
    text,
    staffName: String(input.staffName ?? '').trim() || undefined,
    staffEmail: String(input.staffEmail ?? '').trim().toLowerCase() || undefined,
    at: now,
  }
  book.threads[threadId].messages.push(msg)
  book.threads[threadId].updatedAt = now
  saveThreads(book)
  return {
    threadId,
    messages: book.threads[threadId].messages,
    message: msg,
  }
}

/**
 * @param {{ threadId: string, text: string }} input
 */
export function appendAssistantMessage(input) {
  const threadId = String(input.threadId ?? '').trim()
  const text = String(input.text ?? '').trim()
  if (!threadId) throw new Error('threadId required')
  if (!text) throw new Error('text required')
  const book = loadThreads()
  const now = new Date().toISOString()
  if (!book.threads[threadId]) {
    book.threads[threadId] = {
      id: threadId,
      createdAt: now,
      updatedAt: now,
      messages: [],
    }
  }
  const msg = {
    id: newId('msg'),
    role: 'assistant',
    text,
    at: now,
  }
  book.threads[threadId].messages.push(msg)
  book.threads[threadId].updatedAt = now
  saveThreads(book)
  return {
    threadId,
    messages: book.threads[threadId].messages,
    message: msg,
  }
}

/** @param {string} threadId */
export function getThreadMessages(threadId) {
  const id = String(threadId ?? '').trim()
  if (!id) return { threadId: null, messages: [] }
  const book = loadThreads()
  const thr = book.threads[id]
  if (!thr) return { threadId: id, messages: [] }
  return { threadId: id, messages: thr.messages || [] }
}
