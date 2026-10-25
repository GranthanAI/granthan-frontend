/**
 * Classification of a fenced block and safe file names for downloading it.
 *
 * The fence's info string is untrusted model output. It is only ever used as a lookup key into the table below (the file
 * extension comes from the table, never from the string), and the language stored with an edit is reduced to a strict
 * `[a-z0-9+#._-]{0,32}` token, so nothing a model writes can shape a path, an extension or a stored value.
 */

export type SourceFormat = 'code' | 'text' | 'markdown'

export interface SourceKind {
  /** Normalised language id (stored with the edit and shown in the header); '' when none / unusable. */
  language: string
  format: SourceFormat
  /** File extension without the dot. */
  ext: string
  /** Exact file name for languages whose files have no extension (Dockerfile, Makefile). */
  fixedName?: string
}

const EXT: Record<string, string> = {
  python: 'py', py: 'py', javascript: 'js', js: 'js', jsx: 'jsx', typescript: 'ts', ts: 'ts', tsx: 'tsx', json: 'json', jsonc: 'json',
  html: 'html', css: 'css', scss: 'scss', sql: 'sql', bash: 'sh', sh: 'sh', shell: 'sh', zsh: 'sh', powershell: 'ps1', ps1: 'ps1',
  java: 'java', kotlin: 'kt', c: 'c', cpp: 'cpp', 'c++': 'cpp', cc: 'cpp', h: 'h', hpp: 'hpp', csharp: 'cs', cs: 'cs', go: 'go',
  golang: 'go', rust: 'rs', rs: 'rs', ruby: 'rb', rb: 'rb', php: 'php', swift: 'swift', r: 'r', lua: 'lua', perl: 'pl', scala: 'scala',
  dart: 'dart', yaml: 'yaml', yml: 'yml', toml: 'toml', xml: 'xml', ini: 'ini', diff: 'diff', graphql: 'graphql', vue: 'vue',
  svelte: 'svelte', tex: 'tex', latex: 'tex', csv: 'csv', mermaid: 'mmd', mmd: 'mmd', manim: 'json', proto: 'proto',
}
const MARKDOWN = new Set(['markdown', 'md', 'mdx'])
const PLAIN = new Set(['', 'text', 'txt', 'plain', 'plaintext', 'log', 'output', 'console'])

export function classifyFence(info: string | undefined | null): SourceKind {
  const key = (info ?? '').trim().toLowerCase().split(/\s+/)[0] ?? ''
  const language = /^[a-z0-9+#._-]{1,32}$/.test(key) ? key : ''
  if (MARKDOWN.has(key)) return { language: 'markdown', format: 'markdown', ext: 'md' }
  if (PLAIN.has(key)) return { language: language || '', format: 'text', ext: 'txt' }
  if (key === 'dockerfile') return { language: 'dockerfile', format: 'code', ext: 'txt', fixedName: 'Dockerfile' }
  if (key === 'makefile') return { language: 'makefile', format: 'code', ext: 'txt', fixedName: 'Makefile' }
  return { language, format: 'code', ext: EXT[key] ?? 'txt' } // unknown languages stay editable, plain-source, `.txt`
}

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i

/** A file name that is safe on Windows, macOS and Linux: no separators, control characters or reserved names, bounded length. */
export function safeFilename(base: string, ext: string): string {
  const cleanExt = ext.replace(/[^a-z0-9]/gi, '').slice(0, 10) || 'txt'
  let stem = base
    .normalize('NFKC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^[.\-_]+|[.\-_ ]+$/g, '')
    .slice(0, 60)
  if (!stem || RESERVED.test(stem)) stem = 'snippet'
  return `${stem}.${cleanExt}`
}

export function downloadName(kind: SourceKind, base = 'snippet'): string {
  return kind.fixedName ?? safeFilename(base, kind.ext)
}

/**
 * Real browser download of exactly `text` as UTF-8 (no BOM, line endings untouched). Client-side only: nothing is sent to or
 * stored on the server per click.
 */
export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

// ── hashing ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Short synchronous locator hash (cyrb53). NOT security-relevant: it only keeps a block id tied to the text it was made for. */
export function quickHash(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}

/** Stable id of a block inside one message: where it is (segment, fence line) plus a fingerprint of the original text. */
export function makeBlockId(scope: string, line: number, original: string): string {
  return `${scope}-L${line}-${quickHash(original)}`
}

/** SHA-256 (hex) of the UTF-8 text: the immutable-original reference stored with an edit. */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const subtle = globalThis.crypto?.subtle
  if (subtle) {
    const digest = await subtle.digest('SHA-256', bytes)
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  }
  return sha256Fallback(bytes) // insecure contexts (plain http on a LAN) have no crypto.subtle
}

function sha256Fallback(data: Uint8Array): string {
  const K = new Uint32Array(64)
  const primes: number[] = []
  for (let n = 2; primes.length < 64; n++) if (primes.every((p) => n % p)) primes.push(n)
  primes.forEach((p, i) => (K[i] = Math.floor((Math.cbrt(p) % 1) * 2 ** 32)))
  const H = new Uint32Array(8)
  primes.slice(0, 8).forEach((p, i) => (H[i] = Math.floor((Math.sqrt(p) % 1) * 2 ** 32)))
  const len = data.length
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6)
  padded.set(data)
  padded[len] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, Math.floor((len * 8) / 2 ** 32))
  view.setUint32(padded.length - 4, (len * 8) >>> 0)
  const w = new Uint32Array(64)
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4)
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15] as number
      const b = w[i - 2] as number
      w[i] = ((w[i - 16] as number) + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + (w[i - 7] as number) + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) >>> 0
    }
    let [a, b, c, d, e, f, g, h] = H as unknown as number[] as [number, number, number, number, number, number, number, number]
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + (K[i] as number) + (w[i] as number)) >>> 0
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    const next = [a, b, c, d, e, f, g, h]
    next.forEach((v, i) => (H[i] = ((H[i] as number) + v) >>> 0))
  }
  return [...H].map((v) => v.toString(16).padStart(8, '0')).join('')
}
