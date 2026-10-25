import { useEffect, useRef } from 'react'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { defaultHighlightStyle, indentOnInput, LanguageDescription, syntaxHighlighting } from '@codemirror/language'
import { languages } from '@codemirror/language-data'

interface Props {
  /** Initial text. The editor is uncontrolled afterwards: remount (change `resetKey`) to replace it. */
  value: string
  resetKey: number | string
  language: string
  ariaLabel: string
  onChange: (text: string) => void
  onSave: () => void
}

const theme = EditorView.theme({
  '&': { backgroundColor: 'transparent', color: 'inherit', fontSize: '13px', maxHeight: '28rem' },
  '.cm-scroller': { fontFamily: 'var(--font-mono, ui-monospace, monospace)', lineHeight: '1.5rem', overflow: 'auto' },
  '.cm-content': { caretColor: 'currentColor', padding: '0.5rem 0' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'inherit', opacity: '0.5', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'rgba(127,127,127,0.08)' },
  '&.cm-focused': { outline: '2px solid var(--color-accent, #6366f1)', outlineOffset: '-2px' },
})

/**
 * A CodeMirror 6 editor (maintained, accessible: real contenteditable with ARIA, keyboard-only operation, screen-reader
 * friendly, Ctrl/Cmd-M toggles Tab between "indent" and "move focus on" so keyboard users are never trapped). Language
 * support is loaded on demand, one chunk per language. The text is never altered by the editor: whitespace, tabs, Unicode
 * and the original line-ending style (CRLF stays CRLF) round-trip exactly.
 */
export default function SourceEditor({ value, resetKey, language, ariaLabel, onChange, onSave }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const cb = useRef({ onChange, onSave })
  useEffect(() => {
    cb.current = { onChange, onSave }
  })

  useEffect(() => {
    if (!host.current) return
    const lang = new Compartment()
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          EditorState.lineSeparator.of(value.includes('\r\n') ? '\r\n' : '\n'),
          lineNumbers(), history(), drawSelection(), highlightActiveLine(), indentOnInput(), EditorView.lineWrapping,
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          keymap.of([
            { key: 'Mod-s', preventDefault: true, run: () => (cb.current.onSave(), true) },
            indentWithTab, ...defaultKeymap, ...historyKeymap,
          ]),
          EditorView.contentAttributes.of({ 'aria-label': ariaLabel, 'aria-multiline': 'true', spellcheck: 'false', autocapitalize: 'off' }),
          lang.of([]),
          theme,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) cb.current.onChange(u.state.doc.sliceString(0, u.state.doc.length, u.state.lineBreak))
          }),
        ],
      }),
    })
    const desc = language ? LanguageDescription.matchLanguageName(languages, language, true) : null
    let alive = true
    void desc?.load().then(
      (support) => alive && view.dispatch({ effects: lang.reconfigure(support) }),
      () => undefined, // an unavailable language pack just means no highlighting
    )
    return () => {
      alive = false
      view.destroy()
    }
    // The editor is uncontrolled: it is rebuilt only when asked to (resetKey) or for another language / label.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, language, ariaLabel])

  return <div ref={host} data-testid="source-editor" />
}
