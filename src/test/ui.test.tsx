import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { makeQueryClient } from '@/app/providers'
import { routes } from '@/app/router'
import { ConversationTree } from '@/components/conversation-tree/ConversationTree'
import { ApiError } from '@/lib/errors'
import { authService } from '@/services/auth.service'
import { useAuthStore } from '@/stores/auth.store'
import type { Conversation } from '@/types/api'

function renderApp(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

describe('protected routing', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [], next_cursor: null, has_more: false }), { status: 200 })))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('redirects anonymous users to /login and remembers the destination', async () => {
    useAuthStore.setState({ status: 'anonymous', accessToken: null, user: null })
    const router = renderApp('/c/abc')
    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect((router.state.location.state as { from: string }).from).toBe('/c/abc')
  })

  it('redirects authenticated users away from /login', async () => {
    useAuthStore.setState({ status: 'authenticated', accessToken: 't', user: null })
    const router = renderApp('/login')
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })
})

describe('login form', () => {
  beforeEach(() => useAuthStore.setState({ status: 'anonymous', accessToken: null, user: null }))
  afterEach(() => vi.restoreAllMocks())

  it('shows inline validation without calling the API', async () => {
    const login = vi.spyOn(authService, 'login')
    renderApp('/login')
    await userEvent.click(await screen.findByRole('button', { name: /sign in/i }))
    expect(await screen.findByText('Email is required')).toBeInTheDocument()
    expect(screen.getByText('Password is required')).toBeInTheDocument()
    expect(login).not.toHaveBeenCalled()
  })

  it('shows a friendly message for invalid credentials', async () => {
    vi.spyOn(authService, 'login').mockRejectedValue(new ApiError('auth', 'Incorrect email or password.', 401))
    renderApp('/login')
    await userEvent.type(await screen.findByLabelText('Email'), 'a@b.co')
    await userEvent.type(screen.getByLabelText('Password'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.')
  })

  it('toggles password visibility', async () => {
    renderApp('/login')
    const pw = await screen.findByLabelText('Password')
    expect(pw).toHaveAttribute('type', 'password')
    await userEvent.click(screen.getByRole('button', { name: /show password/i }))
    expect(pw).toHaveAttribute('type', 'text')
  })
})

describe('signup form', () => {
  beforeEach(() => useAuthStore.setState({ status: 'anonymous', accessToken: null, user: null }))
  it('enforces the password policy and confirmation', async () => {
    renderApp('/signup')
    await userEvent.type(await screen.findByLabelText('Full name'), 'Alex Doe')
    await userEvent.type(screen.getByLabelText('Email'), 'alex@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'weak')
    await userEvent.type(screen.getByLabelText('Confirm password'), 'nope')
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))
    expect(await screen.findByText('At least 12 characters')).toBeInTheDocument()
    expect(screen.getByText('Passwords do not match')).toBeInTheDocument()
  })
})

describe('conversation tree UI', () => {
  const c = (id: string, parent: string | null = null): Conversation => ({
    conversation_id: id, user_id: 'u', title: `Title ${id}`, created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z', status: 'active', parent_conversation_id: parent,
  })
  const noop = () => {}

  it('expands and collapses branches and marks the active conversation', async () => {
    const router = createMemoryRouter(
      [{ path: '*', element: <ConversationTree conversations={[c('root'), c('kid', 'root')]} activeId="root" onRename={noop} onDelete={noop} onBranch={noop} /> }],
      { initialEntries: ['/c/root'] },
    )
    render(<RouterProvider router={router} />)
    expect(screen.queryByText('Title kid')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Title root/ })).toHaveAttribute('aria-current', 'page')
    await userEvent.click(screen.getByRole('button', { name: /expand branches of Title root/i }))
    const kid = await screen.findByRole('link', { name: /Title kid/ })
    expect(kid).toHaveAttribute('href', '/c/kid')
    await userEvent.click(screen.getByRole('button', { name: /collapse branches of Title root/i }))
    expect(screen.queryByText('Title kid')).not.toBeInTheDocument()
  })

  it('navigates to a branch when selected', async () => {
    const router = createMemoryRouter(
      [{ path: '*', element: <ConversationTree conversations={[c('root'), c('kid', 'root')]} activeId="kid" onRename={noop} onDelete={noop} onBranch={noop} /> }],
      { initialEntries: ['/c/kid'] },
    )
    render(<RouterProvider router={router} />)
    // path to the active node is revealed automatically
    await userEvent.click(await screen.findByRole('link', { name: /Title root/ }))
    expect(router.state.location.pathname).toBe('/c/root')
  })
})

describe('signup with email verification toggled server-side', () => {
  const user = { id: 'u', email: 'alex@example.com', full_name: 'Alex Doe', avatar_url: null, is_email_verified: false, created_at: '', updated_at: '', last_login: null }
  beforeEach(() => useAuthStore.setState({ status: 'anonymous', accessToken: null, user: null }))
  afterEach(() => vi.restoreAllMocks())

  async function fillAndSubmit() {
    await userEvent.type(await screen.findByLabelText('Full name'), 'Alex Doe')
    await userEvent.type(screen.getByLabelText('Email'), 'alex@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'Str0ng-Passw0rd!x')
    await userEvent.type(screen.getByLabelText('Confirm password'), 'Str0ng-Passw0rd!x')
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))
  }

  it('signs straight in when the new account is already ACTIVE', async () => {
    vi.spyOn(authService, 'register').mockResolvedValue({ ...user, status: 'ACTIVE' })
    const login = vi.spyOn(authService, 'login').mockImplementation(async () => {
      useAuthStore.setState({ status: 'authenticated', accessToken: 't', user: null })
      return { ...user, status: 'ACTIVE' }
    })
    const router = renderApp('/signup')
    await fillAndSubmit()
    await waitFor(() => expect(login).toHaveBeenCalledWith({ email: 'alex@example.com', password: 'Str0ng-Passw0rd!x' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('goes to the code screen when the account is PENDING', async () => {
    vi.spyOn(authService, 'register').mockResolvedValue({ ...user, status: 'PENDING' })
    const login = vi.spyOn(authService, 'login')
    const router = renderApp('/signup')
    await fillAndSubmit()
    await waitFor(() => expect(router.state.location.pathname).toBe('/verify-email'))
    expect(login).not.toHaveBeenCalled()
  })
})
