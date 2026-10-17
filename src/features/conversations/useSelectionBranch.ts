import { useNavigate } from 'react-router-dom'
import { toast } from '@/components/ui/overlays'
import { errorMessage } from '@/lib/errors'
import { branchTitle } from '@/lib/quote'
import { useQuoteStore } from '@/stores/quote.store'
import { useCreateConversation } from './hooks'

/**
 * Actions for text selected in a conversation.
 *  - newBranch: creates a child conversation (real parent link) titled with the first 5 words of the
 *    selection, opens it, and queues the selection to be sent with the first prompt there. The backend
 *    does not copy history into a branch, so the quote is what carries the context over.
 *  - thisBranch: stays in the current conversation and queues the selection for the next prompt.
 */
export function useSelectionBranch(conversationId: string) {
  const create = useCreateConversation()
  const navigate = useNavigate()
  const setQuote = useQuoteStore((s) => s.set)

  const newBranch = async (selection: string) => {
    if (create.isPending) return
    try {
      const c = await create.mutateAsync({ title: branchTitle(selection), parent_conversation_id: conversationId })
      setQuote(c.conversation_id, selection)
      navigate(`/c/${c.conversation_id}`)
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  const thisBranch = (selection: string) => {
    setQuote(conversationId, selection)
    // focus after the quote chip renders
    setTimeout(() => document.getElementById('composer-input')?.focus(), 0)
  }

  return { newBranch, thisBranch, pending: create.isPending }
}
