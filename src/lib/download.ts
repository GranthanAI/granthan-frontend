/** Saves an in-memory blob (fetched with the Authorization header) as a file. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

/** A filename that is safe on every platform; never trust a title as a path. */
export function safeFileName(title: string, fallback: string, ext: string): string {
  const stem = title.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60)
  return `${stem || fallback}${ext}`
}
