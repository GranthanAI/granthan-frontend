import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AdminLayout } from '@/features/admin/AdminLayout'
import { ReasonDialog } from '@/features/admin/ReasonDialog'
import { useCanWrite } from '@/features/admin/useCanWrite'
import { useAuthStore } from '@/stores/auth.store'
import { mePro, meSimulated } from './billing-fixtures'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function mock(role: string | undefined, me = mePro) {
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const path = new URL(input).pathname.replace('/api/v1', '')
    if (path === '/auth/me') return json(200, { id: 'u', email: 's@example.com', is_email_verified: true, status: 'ACTIVE', ...(role ? { role } : {}) })
    if (path === '/billing/me') return json(200, me)
    return json(404, {})
  }))
}

function Probe() {
  const canWrite = useCanWrite()
  return <div>{canWrite ? <button>Write something</button> : <span>read only</span>}</div>
}

function renderAdmin() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/admin/accounts']}>
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route path="accounts" element={<Probe />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => useAuthStore.setState({ status: 'authenticated', accessToken: 't', user: null, expired: false }))
afterEach(() => vi.unstubAllGlobals())

describe('who sees the admin console', () => {
  it('a normal user typing /admin gets the 404 page', async () => {
    mock('user')
    renderAdmin()
    expect(await screen.findByTestId('not-found')).toBeInTheDocument()
    expect(screen.queryByTestId('admin-shell')).toBeNull()
  })

  it('a user with no role at all gets the 404 page too', async () => {
    mock(undefined)
    renderAdmin()
    expect(await screen.findByTestId('not-found')).toBeInTheDocument()
  })

  it('support sees the console read-only: no write controls', async () => {
    mock('support')
    renderAdmin()
    expect(await screen.findByTestId('admin-shell')).toBeInTheDocument()
    expect(screen.getByTestId('staff-role')).toHaveTextContent('support (read-only)')
    expect(screen.getByText('read only')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Write something' })).toBeNull()
  })

  it('billing_admin and admin may write', async () => {
    for (const role of ['billing_admin', 'admin']) {
      mock(role)
      const v = renderAdmin()
      expect(await screen.findByRole('button', { name: 'Write something' })).toBeInTheDocument()
      v.unmount()
    }
  })

  it('the simulator link appears only when payments are simulated', async () => {
    mock('billing_admin', meSimulated)
    const v = renderAdmin()
    expect(await screen.findByRole('link', { name: 'Simulator tools' })).toBeInTheDocument()
    v.unmount()
    mock('billing_admin')
    renderAdmin()
    await screen.findByTestId('admin-shell')
    expect(screen.queryByRole('link', { name: 'Simulator tools' })).toBeNull()
  })
})

describe('every write asks for a reason and confirms first', () => {
  it('the confirm button stays off until there is a reason, and the reason is what is sent', async () => {
    const onConfirm = vi.fn(async () => undefined)
    const onClose = vi.fn()
    render(<ReasonDialog title="Block this account" confirmLabel="Block" onConfirm={onConfirm} onClose={onClose} />)
    const confirm = screen.getByRole('button', { name: 'Block' })
    expect(confirm).toBeDisabled()
    await userEvent.type(screen.getByLabelText(/reason/i), 'ab')
    expect(confirm).toBeDisabled()
    expect(screen.getByText('At least 3 characters.')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText(/reason/i), 'c  ')
    expect(confirm).toBeEnabled()
    await userEvent.click(confirm)
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('abc'))
    expect(onClose).toHaveBeenCalled()
  })

  it('a typed word is required when asked for, and a failure is shown without closing', async () => {
    const onConfirm = vi.fn(async () => { throw new Error('refused by the server') })
    const onClose = vi.fn()
    render(<ReasonDialog title="Publish" confirmLabel="Publish" typed="PUBLISH" onConfirm={onConfirm} onClose={onClose} />)
    await userEvent.type(screen.getByLabelText(/reason/i), 'plan sheet v2')
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Type PUBLISH to confirm'), 'publish')
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled() // case matters
    await userEvent.clear(screen.getByLabelText('Type PUBLISH to confirm'))
    await userEvent.type(screen.getByLabelText('Type PUBLISH to confirm'), 'PUBLISH')
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }))
    expect(await screen.findByText('refused by the server')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})
