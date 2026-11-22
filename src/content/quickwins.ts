/** Copy for the quick wins: edit, thumbs, share, temporary chat, follow-ups, voice and think longer. */

export const THINK_COPY = {
  label: 'Think longer',
  pending: 'Thinking longer…',
  thought: 'Thought longer',
  notApplied: 'This model answered without thinking longer.',
  modelCannot: "This model can't think longer",
  upgrade: 'Not in your plan',
  limitReached: "You've used today's Think longer answers. They reset at midnight.",
}

export const EDIT_COPY = {
  edit: 'Edit message',
  cancel: 'Cancel',
  send: 'Send',
  busy: 'Wait for the current answer to finish',
  editedBanner: 'Edited version of an earlier question',
  original: 'Open the original conversation',
  versions: (n: number) => `Edited · ${n} versions`,
  versionsLabel: 'Edited versions of this message',
}

export const FEEDBACK_COPY = {
  up: 'Good answer',
  down: 'Bad answer',
  title: 'What went wrong?',
  consent: 'Sending this lets the GranthanAI team read this answer and your question to improve answers.',
  comment: 'Anything else? (optional)',
  submit: 'Send',
  skip: 'Skip',
  reasons: {
    inaccurate: 'Inaccurate',
    not_helpful: 'Not helpful',
    wrong_level: 'Wrong level for me',
    too_long: 'Too long',
    too_short: 'Too short',
    formatting: 'Formatting',
    unsafe: 'Unsafe',
    other: 'Other',
  } as const,
}

export const SHARE_COPY = {
  menu: 'Share',
  title: 'Share a snapshot',
  scopeConversation: 'This conversation',
  scopeHierarchy: 'The whole tree',
  create: 'Create link',
  warning: "Anyone with the link can read this snapshot. Later messages aren't included.",
  onceOnly: 'Copy it now: the link is shown only this once.',
  copy: 'Copy link',
  copied: 'Copied',
  settingsTitle: 'Shared links',
  settingsEmpty: 'You have no shared links.',
  update: 'Update snapshot',
  remove: 'Delete link',
  removeTitle: 'Delete this link?',
  removeBody: 'Anyone who has it will no longer be able to open it.',
  notFound: 'This link was removed or never existed',
  tooMany: 'Too many requests, try again in a minute',
  earlier: 'Earlier in this tree',
  manim: 'Animation available in GranthanAI',
  tryIt: 'Try GranthanAI',
  branches: 'Branches',
}

export const TEMP_COPY = {
  toggle: 'Temporary',
  tooltip: 'Not saved to history or memory. Deleted after 24 hours.',
  banner: (when: string) => `Temporary chat · not in your history · not remembered · deleted ${when}`,
  leave: 'This temporary chat will be gone. Leave?',
  dontAsk: "Don't ask again",
  stay: 'Stay',
  leaveAction: 'Leave',
}

export const SUGGEST_COPY = {
  label: 'Suggested follow-up questions',
  setting: 'Suggest follow-up questions',
  settingHelp: 'Show two or three short questions under the latest answer.',
}

export const VOICE_COPY = {
  mic: 'Dictate',
  stop: 'Stop dictation',
  listening: 'Listening…',
  speak: 'Read aloud',
  stopSpeak: 'Stop reading',
  firstUse: "Your voice is processed by your browser's speech service.",
  denied: "Microphone permission is blocked. Allow it in the browser's site settings.",
  network: 'Dictation needs an internet connection.',
  language: 'Dictation language',
  speed: 'Read-aloud speed',
  voice: 'Read-aloud voice',
  voiceDefault: 'Default voice',
  codeSkipped: 'code block skipped',
  diagramSkipped: 'diagram skipped',
  tableSkipped: 'table skipped',
}
