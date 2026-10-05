#!/usr/bin/env node
/**
 * Rasterise the TR mark (gold T on #0a0a0a) into the phone icons.
 * The path matches tr-logo.svg: M10 12h44v10.4H37.6V54h-11.2V22.4H10V12z
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

const BG = [0x0a, 0x0a, 0x0a]
const GOLD = [0xc9, 0xa2, 0x27]

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i]
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data])
  const len = Buffer.alloc(4)
  len.writeUInt32BE(body.length - 4, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

function png(size, pixels) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const raw = Buffer.alloc(size * (1 + size * 3))
  for (let y = 0; y < size; y += 1) {
    const row = y * (1 + size * 3)
    raw[row] = 0
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = pixels[y * size + x]
      const i = row + 1 + x * 3
      raw[i] = r
      raw[i + 1] = g
      raw[i + 2] = b
    }
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function inMark(sx, sy) {
  const bar = sx >= 10 && sx < 54 && sy >= 12 && sy < 22.4
  const stem = sx >= 26.4 && sx < 37.6 && sy >= 22.4 && sy < 54
  return bar || stem
}

export function raster(size) {
  const pixels = new Array(size * size)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sx = ((x + 0.5) * 64) / size
      const sy = ((y + 0.5) * 64) / size
      pixels[y * size + x] = inMark(sx, sy) ? GOLD : BG
    }
  }
  return png(size, pixels)
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const files = [
    ['icon-192.png', 192],
    ['icon-512.png', 512],
    ['apple-touch-icon.png', 180],
  ]
  for (const [name, size] of files) {
    const buf = raster(size)
    writeFileSync(join(OUT, name), buf)
    console.log(`${name} ${size}x${size} ${buf.length} bytes`)
  }
}
