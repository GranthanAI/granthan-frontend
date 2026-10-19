import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/lib/query-keys'
import { customModeService } from '@/services/custom-modes.service'
import type { CustomModeInput, ModeDescriptor, ToolListResponse } from '@/types/api'

/** The user's active custom modes. The server (PostgreSQL) is the only source: nothing is stored in the browser. */
export function useCustomModes() {
  return useQuery({
    queryKey: qk.customModes,
    queryFn: ({ signal }) => customModeService.list(signal),
    staleTime: 30_000,
    retry: 1,
  })
}

const refresh = (qc: ReturnType<typeof useQueryClient>) => {
  void qc.invalidateQueries({ queryKey: qk.customModes })
  void qc.invalidateQueries({ queryKey: qk.preferences })   // a saved default may have become unavailable
}

export function useCreateCustomMode() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (body: CustomModeInput) => customModeService.create(body), onSuccess: () => refresh(qc) })
}

export function useUpdateCustomMode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; version?: number } & Partial<CustomModeInput>) => customModeService.update(id, body),
    onSuccess: () => refresh(qc),
    onError: () => void qc.invalidateQueries({ queryKey: qk.customModes }),   // e.g. 409: load the latest
  })
}

export function useArchiveCustomMode() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (id: string) => customModeService.archive(id), onSuccess: () => refresh(qc) })
}

/**
 * Every mode the user can pick right now: the built-in modes llm-service offers plus the user's own custom modes
 * (id "custom:<uuid>"). Built-ins stay backend-driven; nothing is hardcoded here.
 */
export function useAllModes(toolsData?: ToolListResponse) {
  const custom = useCustomModes()
  const builtin = useMemo(() => toolsData?.modes ?? [], [toolsData])
  const customModes: ModeDescriptor[] = useMemo(
    () =>
      (custom.data?.items ?? [])
        .filter((m) => m.status === 'active')
        .map((m) => ({
          id: m.mode_ref,
          name: m.name,
          custom: true,
          description: m.description || (m.execution_style === 'smart' ? 'Custom mode (smart)' : 'Custom mode'),
        })),
    [custom.data],
  )
  const modes = useMemo(() => [...builtin, ...customModes], [builtin, customModes])
  return { modes, builtin, customModes, customLoaded: custom.isSuccess, customQuery: custom }
}
