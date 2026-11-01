/**
 * Which files can be attached. Mirrors file-service ALLOWED_EXTENSIONS / ALLOWED_FILENAMES and what retrieval-service can read
 * (app/ingestion/formats.py); the server stays authoritative. A .zip is opened and every readable file inside is used.
 */

/** Documents, with the type browsers/servers expect for them. */
const DOCUMENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  html: 'text/html',
  htm: 'text/html',
  md: 'text/markdown',
  markdown: 'text/markdown',
  mdx: 'text/markdown',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  zip: 'application/zip',
  txt: 'text/plain',
  json: 'application/json',
  xml: 'application/xml',
}

/** Plain text and source code: sent as text/plain (the server accepts any text/* with an allowed extension). */
const TEXT_EXTENSIONS = new Set(
  (
    'text,log,rst,adoc,asciidoc,tex,org,srt,vtt,jsonl,ndjson,yaml,yml,toml,ini,cfg,conf,properties,ipynb,gql,graphql,proto,' +
    'sql,py,pyi,js,jsx,mjs,cjs,ts,tsx,java,kt,kts,scala,groovy,gradle,c,h,cc,cpp,cxx,hpp,hh,cs,go,rs,rb,php,swift,m,mm,dart,lua,r,jl,pl,pm,' +
    'sh,bash,zsh,fish,ps1,bat,cmd,vue,svelte,css,scss,sass,less,tf,tfvars,hcl,ex,exs,erl,hs,clj,cljs,fs,ml,nim,zig,v,sol,asm,s,cmake,mk,makefile'
  ).split(','),
)

/** Extensionless files that are plain text by convention. */
const TEXT_FILENAMES = new Set(
  'dockerfile,makefile,readme,license,licence,changelog,authors,contributing,notice,procfile,gemfile,rakefile,jenkinsfile,vagrantfile,codeowners'.split(
    ',',
  ),
)

export const ALLOWED_EXTENSIONS: string[] = [...Object.keys(DOCUMENT_TYPES), ...TEXT_EXTENSIONS]

/** Value for the file picker's `accept`. */
export const ACCEPT = ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(',')

export function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop()!.toLowerCase()
  const dot = base.replace(/^\.+/, '').lastIndexOf('.')
  return dot === -1 ? '' : base.replace(/^\.+/, '').slice(dot + 1)
}

export function isSupportedName(name: string): boolean {
  const ext = extensionOf(name)
  if (ext) return ext in DOCUMENT_TYPES || TEXT_EXTENSIONS.has(ext)
  return TEXT_FILENAMES.has(name.toLowerCase())
}

/** The content type to declare for a file ('' when its name is not supported). Browsers often report an empty or generic type. */
export function typeForName(name: string): string {
  const ext = extensionOf(name)
  if (ext in DOCUMENT_TYPES) return DOCUMENT_TYPES[ext]!
  return isSupportedName(name) ? 'text/plain' : ''
}
