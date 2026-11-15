import { useOutletContext } from 'react-router-dom'

/** Whether the staff user may change things (set by the admin layout). Read-only roles never see write controls. */
export function useCanWrite(): boolean {
  return useOutletContext<{ canWrite: boolean } | null>()?.canWrite ?? false
}
