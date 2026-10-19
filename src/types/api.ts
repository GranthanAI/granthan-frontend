/**
 * Contract types for the GranthanAI API Gateway. Every shape here is taken from the
 * backend's Pydantic schemas (auth-service, conversation-service, graph-service,
 * file-service) and the gateway docs. See docs/INTEGRATION.md for provenance.
 */

export interface TokenResponse {
  access_token: string
  token_type: string
  expires_in: number
}

export interface User {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  is_email_verified: boolean
  status: string
  created_at: string
  updated_at: string
  last_login: string | null
}

export interface MessageResult {
  message: string
}

export interface Conversation {
  conversation_id: string
  user_id: string
  title: string
  created_at: string
  updated_at: string
  status: string
  parent_conversation_id: string | null
}

export interface Page<T> {
  items: T[]
  next_cursor: string | null
  has_more: boolean
}

export type MessageSender = 'user' | 'assistant' | 'system' | (string & {})
/** `pending` while generation is in flight, `sent` once final, `failed` on LLM error. */
export type MessageStatus = 'pending' | 'sent' | 'failed' | (string & {})

export interface ApiMessage {
  message_id: string
  conversation_id: string
  sender: MessageSender
  content: string
  created_at: string
  status: MessageStatus
  file_ids?: string[]
  /** Only on POST .../messages and .../regenerate: the assistant id the reply streams under. */
  response_message_id?: string | null
}

export interface SendMessageBody {
  content: string
  mode?: string
  selected_tools?: string[]
  file_ids?: string[]
}

/** Retrieval source attached to the final SSE event of a grounded answer (not persisted). */
export interface Citation {
  file_id: string
  source_name: string
  page_number: number | null
  section: string | null
}

/** Event schema of GET /stream/{conversation_id}. */
export interface StreamEvent {
  conversation_id: string
  /** The ASSISTANT message id (matches `response_message_id` of the send acknowledgement). */
  message_id: string
  request_message_id?: string
  sender: 'assistant'
  content: string
  sequence_number?: number
  is_final: boolean
  status?: 'completed' | 'failed'
  citations?: Citation[]
  full_content?: string
  /** Replay-log cursor (Redis Stream id). Absent if the server's event log was unavailable. */
  event_id?: string
}

export type FileStatus =
  | 'UPLOADING'
  | 'UPLOADED'
  | 'SCANNING'
  | 'PROCESSING'
  | 'READY'
  | 'FAILED'
  | 'DELETING'
  | 'DELETED'

export interface FileRecord {
  document_id: string
  conversation_id: string | null
  owner_id: string
  filename: string
  content_type: string
  size_bytes: number
  status: FileStatus
  current_version: number
  created_at: string
  updated_at: string
}

export interface FileListItem {
  document_id: string
  filename: string
  status: FileStatus
}

export interface FileListResponse {
  items: FileListItem[]
  next_cursor: string | null
}

export interface InitiateUploadBody {
  conversation_id?: string | null
  filename: string
  content_type: string
  size_bytes: number
}

export interface InitiateUploadResponse {
  document_id: string
  upload_url: string
  upload_method: 'PUT' | 'POST'
  form_data: Record<string, string> | null
  expires_in: number
}

export interface FileStatusResponse {
  document_id: string
  status: FileStatus
  retry_count: number
  /** Only while FAILED: why processing/indexing failed (e.g. a scanned PDF with no text). */
  error_code?: string | null
  error_message?: string | null
}

export interface DownloadResponse {
  download_url: string
  expires_in: number
}

/** Graph-service node (all fields strings, status upper-case). */
export interface GraphConversation {
  conversation_id: string
  user_id: string
  title: string
  status: string
  created_at: string
  updated_at: string
  parent_conversation_id: string | null
}

/** One entry of GET /tools: a tool that is registered and enabled in the backend right now. */
export interface ToolDescriptor {
  id: string
  name: string
  description: string
  version: string
  parameters: { name: string; type: string; description: string; required: boolean }[]
  /** False when the tool needs input that cannot be derived from the chat message. */
  auto_runnable: boolean
}

/** A response mode the user may pick (Auto = none selected). Comes from the backend, never hardcoded. */
export interface ModeDescriptor {
  id: string
  name: string
  description: string
  /** True for the user's own custom modes (id is "custom:<uuid>"). */
  custom?: boolean
}

/* ---------------- Custom modes ---------------- */

export type ExecutionStyle = 'direct' | 'smart'

/** A user-owned, reusable mode (conversation-service, PostgreSQL). Send `mode_ref` as the message `mode`. */
export interface CustomMode {
  mode_id: string
  mode_ref: string
  name: string
  description: string
  instructions: string
  execution_style: ExecutionStyle
  status: 'active' | 'archived'
  /** Optimistic-concurrency version: send it back on PATCH. */
  version: number
  created_at: string
  updated_at: string
  archived_at: string | null
}

export interface CustomModeList {
  items: CustomMode[]
  total: number
  limit: number
  offset: number
  max_per_user: number
  /** Maximum characters, from the server's configuration. */
  limits?: { name: number; description: number; instructions: number }
}

export interface CustomModeInput {
  name: string
  description: string
  instructions: string
  execution_style: ExecutionStyle
}

export interface ToolListResponse {
  tools: ToolDescriptor[]
  max_selected: number
  /** Optional: absent from older backends (then no mode selector is shown). */
  modes?: ModeDescriptor[]
}

/* ---------------- Settings ---------------- */

export type AnswerLength = 'concise' | 'balanced' | 'detailed'
export type Tone = 'professional' | 'friendly' | 'simple'
export type CitationPreference = 'show' | 'hide'
export type DocumentContextPreference = 'conversation' | 'attached_only'

/** Server-persisted AI / application preferences (conversation-service). */
export interface Preferences {
  /** null = Auto (the planner decides). */
  default_mode: string | null
  default_tools: string[]
  answer_length: AnswerLength
  tone: Tone
  /** 'auto' = answer in the language of the question. */
  language: string
  personal_instructions: string
  citations: CitationPreference
  document_context: DocumentContextPreference
  /** False when the saved default is a custom mode that was archived (Auto is used until changed). */
  default_mode_available?: boolean
  /** Optimistic-concurrency version: send it back on PATCH. 0 = never saved. */
  version: number
  updated_at: string | null
  options: PreferenceOptions
}

export interface PreferenceOptions {
  answer_length: AnswerLength[]
  tone: Tone[]
  citations: CitationPreference[]
  document_context: DocumentContextPreference[]
  languages: { code: string; name: string }[]
  personal_instructions_max: number
}

export type PreferencesPatch = Partial<
  Pick<Preferences, 'default_mode' | 'default_tools' | 'answer_length' | 'tone' | 'language' | 'personal_instructions' | 'citations' | 'document_context'>
> & { version?: number }

export interface MemorySettings {
  memory_enabled: boolean
}

export interface MemoryFact {
  id: string
  category: string
  statement: string
  importance: number
  created_at: string | null
  conversation_id: string | null
}

export interface MemoryFactList {
  items: MemoryFact[]
  memory_enabled: boolean
}

/** What a branch inherits from its ancestors (GET /conversations/{id}/context). */
export interface InheritedDocument {
  document_id: string
  source_conversation_id: string
  source_title: string
  source_message_id: string
}

export interface BranchContext {
  conversation_id: string
  branch_message_id: string | null
  lineage: { conversation_id: string; title: string; upto_message_id: string | null }[]
  /** Why the ancestor chain ended early (missing / deleted / inaccessible ancestor, cycle, depth). */
  truncated: string | null
  documents: InheritedDocument[]
}

export interface DeviceSession {
  id: string
  device: string | null
  browser: string | null
  os: string | null
  ip_address: string | null
  created_at: string
  last_seen: string
  expires_at: string
  /** The session of this browser. */
  is_current?: boolean
}
