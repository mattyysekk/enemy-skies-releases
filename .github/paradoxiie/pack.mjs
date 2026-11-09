// Paradoxiie: cut a built game into pieces so the launcher can update it by downloading only what changed.
//
//   node pack.mjs <game folder> <out prefix>
//
// writes <out prefix>.pack (every distinct piece, each squeezed on its own, end to end) and <out prefix>.chunks.json
// (each file as a list of pieces, and where each piece sits in the .pack). The pieces are cut where the content says
// (not every N bytes), so a change in one place leaves the pieces before and after it the same.
// The launcher cuts the copy you have the same way: THE CUTTING HERE AND IN THE LAUNCHER (src/main/delta.ts) MUST MATCH.
import { createHash } from 'crypto'
import { closeSync, openSync, readFileSync, readdirSync, statSync, writeFileSync, writeSync } from 'fs'
import { join, relative, sep } from 'path'
import { deflateRawSync } from 'zlib'

const MIN = 16 * 1024
const MAX = 256 * 1024
const MASK = 0xffff0000 // about one cut every 64 KB
const GEAR = (() => {
  const g = new Uint32Array(256)
  let x = 0x9e3779b9
  for (let i = 0; i < 256; i++) {
    x ^= x << 13
    x >>>= 0
    x ^= x >>> 17
    x ^= x << 5
    x >>>= 0
    g[i] = x
  }
  return g
})()

/** where the pieces of `buf` end */
export function cuts(buf) {
  const out = []
  const n = buf.length
  let start = 0
  let h = 0
  for (let i = 0; i < n; i++) {
    h = ((h << 1) + GEAR[buf[i]]) >>> 0
    const len = i + 1 - start
    if ((len >= MIN && (h & MASK) === 0) || len >= MAX) {
      out.push(i + 1)
      start = i + 1
      h = 0
    }
  }
  if (start < n) out.push(n)
  return out
}
export const hashOf = (b) => createHash('sha256').update(b).digest('hex').slice(0, 32)

function walk(dir, root = dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, root, out)
    else out.push(relative(root, p).split(sep).join('/'))
  }
  return out
}

if (process.argv[1] && process.argv[1].endsWith('pack.mjs')) {
  const [dir, prefix] = process.argv.slice(2)
  if (!dir || !prefix) {
    console.error('usage: node pack.mjs <game folder> <out prefix>')
    process.exit(1)
  }
  const pack = openSync(prefix + '.pack', 'w')
  let at = 0
  const chunks = {}
  const files = []
  let raw = 0
  for (const p of walk(dir)) {
    const buf = readFileSync(join(dir, p))
    const list = []
    let s = 0
    for (const e of cuts(buf)) {
      const piece = buf.subarray(s, e)
      const h = hashOf(piece)
      if (!chunks[h]) {
        const z = deflateRawSync(piece, { level: 9 })
        writeSync(pack, z)
        chunks[h] = [at, z.length, piece.length]
        at += z.length
      }
      list.push(h)
      s = e
    }
    raw += buf.length
    files.push({ p, s: buf.length, c: list })
  }
  closeSync(pack)
  writeFileSync(prefix + '.chunks.json', JSON.stringify({ v: 1, files, chunks }))
  console.log(`${files.length} files, ${(raw / 1048576).toFixed(1)} MB in ${Object.keys(chunks).length} pieces; pack ${(at / 1048576).toFixed(1)} MB`)
}
