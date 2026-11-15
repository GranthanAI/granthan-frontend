/**
 * EVERY message_key (and plan_limit `limit` name) the backend services can return, read from their code. A test
 * (src/test/message-keys.test.tsx) fails when a key here has no entry in LIMIT_COPY, so a new backend key cannot ship
 * without words. Add the key here with its source repo, then give it copy in content/plans.ts.
 */

export interface MessageKeySource {
  key: string
  /** the repo that can return it (read from its code) */
  source: string
}

export const MESSAGE_KEYS: ReadonlyArray<MessageKeySource> = [
  // billing-service src/billing/app/reserve.py (MESSAGE_KEYS, BEST_SWITCHED_KEY, MODEL_UNAVAILABLE_KEY)
  { key: 'limit.daily', source: 'billing-service' },
  { key: 'limit.monthly', source: 'billing-service' },
  { key: 'limit.per_minute', source: 'billing-service' },
  { key: 'limit.best_switched', source: 'billing-service' },
  { key: 'plan.model_not_included', source: 'billing-service' },
  { key: 'model.unavailable', source: 'billing-service' },
  { key: 'credits.empty', source: 'billing-service' },
  { key: 'credits.spend_cap', source: 'billing-service' },
  { key: 'credits.member_cap', source: 'billing-service' },
  { key: 'account.blocked', source: 'billing-service' },
  // conversation-service app/core/billing_messages.py (BILLING_DENIALS, UNKNOWN_DENIAL)
  { key: 'billing.degraded', source: 'conversation-service' },
  { key: 'limit.unknown', source: 'conversation-service' },
  // file-service app/core/billing_messages.py: the same denial keys as billing (account.blocked, billing.degraded, credits.*)
  // llm-service (Manim reserve): the same denial keys as billing; it never invents its own
  // memory-service: no message_key of its own (it returns facts_used / facts_limit; the plan_limit name is below)
]

/** plan_limit denials: message_key is `limit.<name>`. */
export const PLAN_LIMIT_NAMES: ReadonlyArray<MessageKeySource> = [
  // conversation-service app/core/billing_messages.py (PLAN_LIMIT_COPY) and app/services/plan_limits.py
  { key: 'messages_per_conversation', source: 'conversation-service' },
  { key: 'branches_per_tree', source: 'conversation-service' },
  { key: 'documents_per_tree', source: 'conversation-service' },
  { key: 'custom_modes', source: 'conversation-service' },
  { key: 'mode_instruction_chars', source: 'conversation-service' },
  // file-service app/core/billing_messages.py (PLAN_LIMIT_COPY)
  { key: 'file_size_mb', source: 'file-service' },
  { key: 'storage_mb', source: 'file-service' },
  // memory-service: the memory_facts plan limit (app/services/long_memory_service.py)
  { key: 'memory_facts', source: 'memory-service' },
  // billing-service: the monthly YouTube allowance is returned as limit.monthly; the name is kept for the settings pages
  { key: 'youtube_per_month', source: 'billing-service' },
]

/** Stream notice keys (usage.threshold_80 / _100, metric-specific) are worded by quietMessage, not LIMIT_COPY. */
export const NOTICE_KEY_PREFIXES: ReadonlyArray<string> = ['usage.threshold_']
