import { createContext, useContext, useMemo } from 'react'

/** Which persisted assistant message the rendered code/text belongs to; present only when it is final and can be edited. */
export interface EditableResponse {
  conversationId: string
  messageId: string
}

const Ctx = createContext<EditableResponse | null>(null)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** `enabled` is false while the answer streams or before it has a server id: blocks then render exactly as before. */
export function EditableResponseProvider({
  conversationId, messageId, enabled, children,
}: { conversationId?: string; messageId?: string | null; enabled: boolean; children: React.ReactNode }) {
  const value = useMemo<EditableResponse | null>(
    () => (enabled && conversationId && messageId && UUID.test(messageId) ? { conversationId, messageId } : null),
    [enabled, conversationId, messageId],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useEditableResponse = () => useContext(Ctx)
