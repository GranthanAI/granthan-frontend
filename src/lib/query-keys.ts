export const qk = {
  conversations: ['conversations'] as const,
  conversation: (id: string) => ['conversation', id] as const,
  messages: (id: string) => ['messages', id] as const,
  children: (id: string) => ['children', id] as const,
  ancestors: (id: string) => ['ancestors', id] as const,
  files: (conversationId?: string) => ['files', conversationId ?? 'all'] as const,
  tools: ['tools'] as const,
  file: (id: string) => ['file', id] as const,
  fileStatus: (id: string) => ['file-status', id] as const,
}
