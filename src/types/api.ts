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
