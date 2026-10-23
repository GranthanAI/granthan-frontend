import { createContext, useContext, useMemo } from 'react'

/** Which persisted message a rendered visual belongs to. Provided by the message component, read by the visual blocks. */
export interface ArtifactSource {
  conversationId: string
  messageId: string
}

const Ctx = createContext<ArtifactSource | null>(null)

export function ArtifactSourceProvider({
  conversationId,
  messageId,
  children,
}: ArtifactSource & { children: React.ReactNode }) {
  const value = useMemo(() => ({ conversationId, messageId }), [conversationId, messageId])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** null when the visual is not part of a persisted message (e.g. a message still being written). */
export const useArtifactSource = () => useContext(Ctx)
