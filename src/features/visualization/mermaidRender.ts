import DOMPurify from 'dompurify'

let initialized: 'dark' | 'default' | null = null
let counter = 0

/**
 * Renders Mermaid source to a SANITISED <svg> element. Defence in depth: Mermaid runs with securityLevel 'strict' and no
 * HTML labels, the SVG string is then sanitised with DOMPurify (scripts, foreignObject and event handlers removed), and the
 * caller inserts the parsed node with replaceChildren — never innerHTML.
 */
export async function renderMermaid(source: string): Promise<SVGElement> {
  const { default: mermaid } = await import('mermaid')
  const theme = document.documentElement.classList.contains('dark') ? 'dark' : 'default'
  if (initialized !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme,
      htmlLabels: false, // node labels become plain SVG text (foreignObject is stripped by the sanitiser)
      flowchart: { htmlLabels: false },
      maxTextSize: 20000,
      maxEdges: 400,
    })
    initialized = theme
  }
  const id = `viz-${Date.now()}-${counter++}`
  let svg: string
  try {
    ;({ svg } = await mermaid.render(id, source))
  } catch (e) {
    // On a parse error Mermaid leaves its own "Syntax error" graphic (a temporary #d<id> node) appended to <body>, which
    // shows up under the whole app. Remove it; the caller shows its own error state.
    document.getElementById(`d${id}`)?.remove()
    document.getElementById(id)?.remove()
    throw e
  }
  // Wrapped in a <div> because DOMPurify drops a bare leading <svg>; RETURN_DOM avoids re-serialising (mXSS) the result.
  const body = DOMPurify.sanitize(`<div>${svg}</div>`, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'foreignObject', 'iframe', 'a'],
    FORBID_ATTR: ['onload', 'onclick', 'onerror', 'href', 'xlink:href'],
    RETURN_DOM: true,
  }) as HTMLElement
  const el = body.querySelector('svg')
  if (!el) throw new Error('diagram produced no usable image')
  // Belt and braces: no element may keep an event-handler or script-URL attribute, whatever the sanitiser config did.
  for (const node of [el, ...Array.from(el.querySelectorAll('*'))]) {
    for (const attr of Array.from(node.attributes)) {
      if (/^on/i.test(attr.name) || /^\s*(javascript|data|vbscript):/i.test(attr.value)) node.removeAttribute(attr.name)
    }
  }
  return document.importNode(el, true) as unknown as SVGElement
}
