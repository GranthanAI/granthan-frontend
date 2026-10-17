import { useEffect, useMemo } from 'react'
import { familyOf } from './tree'
import { useTreeSource } from './hooks'

/**
 * The whole branch family (master conversation and every descendant) containing `id`.
 * Keeps fetching list pages while the hierarchy is open, so branches beyond page one still appear.
 */
export function useFamily(id: string) {
  const { list, all } = useTreeSource(id)
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])
  const root = useMemo(() => familyOf(all, id), [all, id])
  return { root, isPending: list.isPending && !root, isError: list.isError && !root, loadingMore: !!hasNextPage }
}
