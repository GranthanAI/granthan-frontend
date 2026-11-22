import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OrganisationSettings } from '@/features/org/OrgSettings'
import { csvFileProblem } from '@/features/org/CsvInvites'
import { useAuthStore } from '@/stores/auth.store'

const saved = vi.hoisted(() => ({ calls: [] as Array<{ filename: string; text: string }> }))
vi.mock('@/lib/download', async (orig) => ({
  ...(await orig<typeof import('@/lib/download')>()),
  saveBlob: (blob: Blob, filename: string) => { saved.calls.push({ filename, text: 'blob' }); void blob },
}))

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
const problem = (status: number, code: string, headers: Record<string, string> = {}) => json(status, { status, code, detail: 'x' }, headers)
const ME = (role: string, features: Record<string, boolean> = {}) => ({
  org: { id: 'org-1', name: 'Sunrise College', slug: 's', type: 'college', status: 'active', pilot_ends_at: null }, role,
  seats: { plan_code: 'org_pro', status: 'active', used: 3, bought: 10, over_by: 0, pending: null },
  features: { lock_modes: true, shared_modes_max: null, usage_reports: true, spend_cap: true, csv_invites: true, invite_links: true, domains: true, ...features },
})
const REPORT = (over: Record<string, unknown> = {}) => ({
  batch_id: 'b1', dry_run: true, rows_total: 8, rows_ok: 5, rows_failed: 3,
  errors_preview: [{ row: 2, email: 'bad', reason: 'invalid_email' }, { row: 4, email: 'dup@x.edu', reason: 'duplicate_in_file' }, { row: 6, email: 'm@x.edu', reason: 'already_member' }],
  seats: { used: 3, bought: 10, open_invites: 0, payment_due: false }, ...over,
})

interface Call { method: string; path: string; form: Record<string, unknown> | null; headers: Record<string, string> }
function mock(me: unknown, handler: (c: Call) => Response | undefined) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input)
    const form = init?.body instanceof FormData ? Object.fromEntries(init.body.entries()) : null
    const c: Call = { method: init?.method ?? 'GET', path: url.pathname.replace('/api/v1', ''), form, headers: (init?.headers ?? {}) as Record<string, string> }
    calls.push(c)
    if (c.path === '/org/me') return json(200, me)
    if (c.path === '/org/orgs/org-1/members' || c.path === '/org/orgs/org-1/invites' && c.method === 'GET') return json(200, { items: [], next_cursor: null })
    if (c.path === '/org/orgs/org-1/invite-links') return json(200, { items: [] })
    if (c.path === '/org/orgs/org-1/domains') return json(200, { items: [] })
    return handler(c) ?? problem(404, 'NOT_FOUND')
  }))
  return calls
}
const csv = (name = 'students.csv', body = 'email\na@x.edu\n') => new File([body], name, { type: 'text/csv' })
async function openInvites() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><OrganisationSettings /></MemoryRouter></QueryClientProvider>)
  await userEvent.click(await screen.findByRole('tab', { name: 'Invites' }))
  return (await screen.findByLabelText(/CSV file/)) as HTMLInputElement
}

beforeEach(() => { useAuthStore.getState().setSession('tok'); saved.calls.length = 0 })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('browser checks on the file', () => {
  it('accepts a .csv up to 1 MiB and refuses the rest in words', () => {
    expect(csvFileProblem(csv())).toBe('')
    expect(csvFileProblem(csv('x.CSV'))).toBe('')
    expect(csvFileProblem(csv('x.xlsx'))).toMatch(/\.csv/)
    expect(csvFileProblem(csv('x.csv', ''))).toMatch(/empty/)
    expect(csvFileProblem(new File([new Uint8Array(1_048_576)], 'x.csv'))).toBe('')
    expect(csvFileProblem(new File([new Uint8Array(1_048_577)], 'x.csv'))).toMatch(/1 MB/)
  })
  it('does not call the API for a wrong file and keeps Check file disabled', async () => {
    const calls = mock(ME('admin'), () => undefined)
    const input = await openInvites()
    await userEvent.upload(input, new File(['x'], 'list.txt'), { applyAccept: false })
    expect(await screen.findByRole('alert')).toHaveTextContent('.csv')
    expect(screen.getByRole('button', { name: 'Check file' })).toBeDisabled()
    expect(calls.some((c) => c.path.endsWith('/invites/csv'))).toBe(false)
  })
})

describe('CSV dry run and send', () => {
  it('dry run is multipart with dry_run=true, then shows counts and the errors in plain words', async () => {
    const calls = mock(ME('admin'), (c) => (c.path === '/org/orgs/org-1/invites/csv' ? json(200, REPORT()) : undefined))
    const input = await openInvites()
    await userEvent.upload(input, csv())
    await userEvent.click(screen.getByRole('button', { name: 'Check file' }))
    expect(await screen.findByTestId('csv-counts')).toHaveTextContent('8 rows · 5 ready · 3 with a problem')
    const up = calls.find((c) => c.path.endsWith('/invites/csv'))!
    expect(up.form).toMatchObject({ dry_run: 'true', role: 'member' })
    expect(up.form!.file).toBeInstanceOf(File)
    expect(up.headers['Idempotency-Key']).toBeTruthy()
    const table = screen.getByTestId('csv-errors')
    expect(table).toHaveTextContent('Not a valid email address')
    expect(table).toHaveTextContent('Listed more than once in the file')
    expect(table).toHaveTextContent('Already a member')
    expect(screen.getByRole('button', { name: 'Send 5 invites' })).toBeEnabled()
  })

  it('shows only the first 20 errors', async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ row: i + 2, email: `e${i}@x.edu`, reason: 'invalid_email' }))
    mock(ME('admin'), () => json(200, REPORT({ rows_failed: 25, errors_preview: many })))
    const input = await openInvites()
    await userEvent.upload(input, csv())
    await userEvent.click(screen.getByRole('button', { name: 'Check file' }))
    const table = await screen.findByTestId('csv-errors')
    expect(table.querySelectorAll('tbody tr')).toHaveLength(20)
  })

  it('warns about payment due and about too few seats', async () => {
    mock(ME('admin'), () => json(200, REPORT({ rows_ok: 9, seats: { used: 3, bought: 10, open_invites: 0, payment_due: true } })))
    const input = await openInvites()
    await userEvent.upload(input, csv())
    await userEvent.click(screen.getByRole('button', { name: 'Check file' }))
    expect(await screen.findByText(/payment due/i)).toBeInTheDocument()
    expect(screen.getByText(/fewer free seats than invitations/)).toBeInTheDocument()
  })

  it('"Send N invites" uploads the same file without dry_run and shows the batch', async () => {
    const calls = mock(ME('admin'), (c) => {
      if (c.path === '/org/orgs/org-1/invites/csv') return json(200, REPORT({ dry_run: c.form?.dry_run === 'true', batch_id: c.form?.dry_run === 'true' ? 'b1' : 'b2' }))
      if (c.path === '/org/invite-batches/b2') return json(200, { batch_id: 'b2', status: 'sending', dry_run: false, rows_total: 8, rows_ok: 5, rows_failed: 3, sent: 2, pending_send: 3, not_sent: 0, errors_note: null, created_at: '2026-11-22T00:00:00Z', finished_at: null })
    })
    const input = await openInvites()
    await userEvent.upload(input, csv())
    await userEvent.click(screen.getByRole('button', { name: 'Check file' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Send 5 invites' }))
    const progress = await screen.findByTestId('batch-progress')
    await waitFor(() => expect(progress).toHaveTextContent('2 sent · 3 waiting · 0 not sent'))
    const sends = calls.filter((c) => c.path.endsWith('/invites/csv'))
    expect(sends).toHaveLength(2)
    expect(sends[1]!.form).toMatchObject({ dry_run: 'false' })
    expect((sends[1]!.form!.file as File).name).toBe('students.csv')
  })

  it('the owner can pick Admin; an admin cannot', async () => {
    mock(ME('owner'), () => undefined)
    await openInvites()
    expect(screen.getAllByRole('option', { name: 'Admin' }).length).toBeGreaterThan(0)
  })
  it('an admin only sees Member', async () => {
    mock(ME('admin'), () => undefined)
    await openInvites()
    expect(screen.queryByRole('option', { name: 'Admin' })).toBeNull()
  })
})

describe('batch polling, errors download, refusals', () => {
  it('polls every 5 seconds until the batch is done, then stops', async () => {
    let n = 0
    const calls = mock(ME('admin'), (c) => {
      if (c.path === '/org/orgs/org-1/invites/csv') return json(200, REPORT({ dry_run: false, batch_id: 'b2' }))
      if (c.path === '/org/invite-batches/b2') { n += 1; return json(200, { batch_id: 'b2', status: n >= 2 ? 'done' : 'sending', dry_run: false, rows_total: 8, rows_ok: 5, rows_failed: 0, sent: n >= 2 ? 5 : 1, pending_send: n >= 2 ? 0 : 4, not_sent: 0, errors_note: null, created_at: 'x', finished_at: null }) }
    })
    const input = await openInvites()
    await userEvent.upload(input, csv())
    await userEvent.click(screen.getByRole('button', { name: 'Check file' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Send 5 invites' }))
    await waitFor(() => expect(screen.getByTestId('batch-progress')).toHaveTextContent('1 sent'))
    await waitFor(() => expect(screen.getByTestId('batch-progress')).toHaveTextContent('Finished'), { timeout: 9000 })
    const polled = calls.filter((c) => c.path === '/org/invite-batches/b2').length
    await new Promise((r) => setTimeout(r, 300))
    expect(calls.filter((c) => c.path === '/org/invite-batches/b2')).toHaveLength(polled) // done: no more polling
  }, 20000)

  it('shows why a stopped batch stopped', async () => {
    mock(ME('admin'), (c) => {
      if (c.path === '/org/orgs/org-1/invites/csv') return json(200, REPORT({ dry_run: false, batch_id: 'b2' }))
      if (c.path === '/org/invite-batches/b2') return json(200, { batch_id: 'b2', status: 'stopped', dry_run: false, rows_total: 8, rows_ok: 5, rows_failed: 0, sent: 1, pending_send: 0, not_sent: 4, errors_note: 'org inactive', created_at: 'x', finished_at: 'y' })
    })
    const input = await openInvites()
    await userEvent.upload(input, csv())
    await userEvent.click(screen.getByRole('button', { name: 'Check file' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Send 5 invites' }))
    expect(await screen.findByText(/Sending stopped: org inactive/)).toBeInTheDocument()
  })

  it('Download errors fetches errors.csv and saves it under the server filename', async () => {
    mock(ME('admin'), (c) => {
      if (c.path === '/org/orgs/org-1/invites/csv') return json(200, REPORT())
      if (c.path === '/org/invite-batches/b1/errors.csv') return new Response('row,email,reason\n', { status: 200, headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="invite-errors-b1.csv"' } })
    })
    const input = await openInvites()
    await userEvent.upload(input, csv())
    await userEvent.click(screen.getByRole('button', { name: 'Check file' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Download errors' }))
    await waitFor(() => expect(saved.calls).toEqual([{ filename: 'invite-errors-b1.csv', text: 'blob' }]))
  })

  it.each([
    ['CSV_INVALID', 400, {}, /could not be read/],
    ['REQUEST_TOO_LARGE', 413, {}, /too large/],
    ['RATE_LIMITED', 429, { 'Retry-After': '42' }, /Try again in 42 seconds/],
  ])('%s is shown in words', async (code, status, headers, text) => {
    mock(ME('admin'), (c) => (c.path === '/org/orgs/org-1/invites/csv' ? problem(status, code, headers) : undefined))
    const input = await openInvites()
    await userEvent.upload(input, csv())
    await userEvent.click(screen.getByRole('button', { name: 'Check file' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(text)
  })

  it('an organisation whose plan has no CSV invites sees the plan note, not the form', async () => {
    mock(ME('admin', { csv_invites: false }), () => undefined)
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><OrganisationSettings /></MemoryRouter></QueryClientProvider>)
    await userEvent.click(await screen.findByRole('tab', { name: 'Invites' }))
    expect(await screen.findByText(/Bulk invites from a file: available on Org Pro and above/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/CSV file/)).toBeNull()
  })
})
