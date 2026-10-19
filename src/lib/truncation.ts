/** The backend appends this notice to an answer that stopped at the model's output limit (llm-service TRUNCATION_NOTICE). */
export const TRUNCATION_MARKER = 'The response was cut off because it reached the length limit.'

export const isTruncated = (content: string | undefined | null): boolean => !!content && content.includes(TRUNCATION_MARKER)
