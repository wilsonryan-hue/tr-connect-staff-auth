#!/usr/bin/env node
/**
 * Offline helper: print a salt+hash block for Ryan to paste into users.json.
 * Does NOT write users.json and does NOT invent credentials.
 * Usage: node src/hash-password.js
 *        STAFF_AUTH_PASSWORD='…' node src/hash-password.js
 */
import { createInterface } from 'node:readline'
import { hashPassword } from './store.js'

async function readPassword() {
  if (process.env.STAFF_AUTH_PASSWORD) {
    return process.env.STAFF_AUTH_PASSWORD
  }
  if (!process.stdin.isTTY) {
    const chunks = []
    for await (const c of process.stdin) chunks.push(c)
    return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '')
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const password = await new Promise((resolve) => {
    rl.question('Password (will not be stored by this script): ', (ans) => {
      rl.close()
      resolve(ans)
    })
  })
  return password
}

const password = await readPassword()
if (!password || password.length < 8) {
  console.error('Password must be at least 8 characters.')
  process.exit(1)
}
const out = hashPassword(password)
console.log(JSON.stringify(out, null, 2))
console.log(
  '\nPaste salt + hash into a users.json entry Ryan creates locally. Do not commit users.json.',
)
