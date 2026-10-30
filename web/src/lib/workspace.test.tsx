import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PropsWithChildren } from 'react';
import type { Snapshot } from '@shared/lib/types';

const state = vi.hoisted(() => ({ userId: 'admin-a', rpc: vi.fn(), subscribe: vi.fn(), removeChannel: vi.fn() }));
vi.mock('./auth', () => ({
  backendConfigured: true, backendUrl: 'https://unit-test.invalid',
  useAuth: () => ({ session: { user: { id: state.userId } } }),
  AuthProvider: ({ children }: PropsWithChildren) => children,
  backendClient: {
    rpc: state.rpc,
    channel: () => ({ on: () => ({ subscribe: state.subscribe }) }),
    removeChannel: state.removeChannel,
  },
}));
import { friendlyError, useWorkspace, WorkspaceProvider } from './workspace';

function snapshot(name = 'Cuenta A'): Snapshot {
  return {
    features: { first_purchase_gifts: true, editable_delivered_orders: true },
    profile: { id: state.userId, display_name: name, role: 'admin', location_id: null },
    locations: [], clients: [], items: [], recipes: [], orders: [], purchases: [], productions: [],
    production_plans: [], stock: [], movements: [], pickup_closures: [], updated_at: '2026-10-28T15:00:00Z',
  };
}
let currentSnapshot: Snapshot;
let snapshotError: { message: string } | null;
function mockRpc(operation: string) {
  if (operation === 'app_snapshot') {
    return { abortSignal: () => Promise.resolve({ data: currentSnapshot, error: snapshotError }) };
  }
  return Promise.resolve({ data: { id: 'saved-order', affected_order_ids: [] }, error: null, status: 200 });
}
beforeEach(() => {
  state.userId = 'admin-a';
  currentSnapshot = snapshot(); snapshotError = null;
  state.rpc.mockReset().mockImplementation(mockRpc);
  state.subscribe.mockReturnValue({});
  const stored = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value); },
    removeItem: (key: string) => { stored.delete(key); },
    clear: () => stored.clear(), key: (index: number) => [...stored.keys()][index] ?? null,
    get length() { return stored.size; },
  });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});
afterEach(() => { cleanup(); });

describe('browser workspace integration', () => {
  it('reads only the authorized snapshot RPC and sends expected version and an idempotency UUID', async () => {
    const { result } = renderHook(useWorkspace, { wrapper: WorkspaceProvider });
    await waitFor(() => expect(result.current.data?.profile?.display_name).toBe('Cuenta A'));
    expect(state.rpc).toHaveBeenCalledWith('app_snapshot');
    await act(async () => { await result.current.command('save_order', { id: 'order-1', notes: 'Editar' }, 7); });
    expect(state.rpc).toHaveBeenCalledWith('app_command', {
      p_command_id: expect.stringMatching(/^[\da-f-]{36}$/), p_operation: 'save_order',
      p_payload: { id: 'order-1', notes: 'Editar' }, p_expected_version: 7,
    });
    expect(localStorage.getItem('command-pending-v1:https://unit-test.invalid:admin-a')).toBe('{}');
  });

  it('rejects writes while offline before invoking any mutation RPC', async () => {
    const { result } = renderHook(useWorkspace, { wrapper: WorkspaceProvider });
    await waitFor(() => expect(result.current.data).toBeDefined());
    act(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current.isOnline).toBe(false);
    await act(async () => { await expect(result.current.command('deliver_order', { id: 'order-1' }, 1)).rejects.toThrow('conexión'); });
    expect(state.rpc.mock.calls.filter(([name]) => name === 'app_command')).toHaveLength(0);
  });

  it('prevents two overlapping writes even before React rerenders the busy state', async () => {
    const { result } = renderHook(useWorkspace, { wrapper: WorkspaceProvider });
    await waitFor(() => expect(result.current.data).toBeDefined());
    let resolve!: (value: unknown) => void;
    state.rpc.mockImplementation(name => name === 'app_command' ? new Promise(done => { resolve = done; }) : mockRpc(name));
    let first!: Promise<unknown>;
    await act(async () => {
      first = result.current.command('deliver_order', { id: 'one' }, 1);
      await expect(result.current.command('deliver_order', { id: 'two' }, 1)).rejects.toThrow('operación anterior');
    });
    await waitFor(() => expect(resolve).toBeDefined());
    await act(async () => { resolve({ data: { id: 'one', affected_order_ids: [] }, error: null, status: 200 }); await first; });
    expect(state.rpc.mock.calls.filter(([name]) => name === 'app_command')).toHaveLength(1);
  });

  it('never renders the previous account snapshot after switching users', async () => {
    const { result, rerender } = renderHook(useWorkspace, { wrapper: WorkspaceProvider });
    await waitFor(() => expect(result.current.data?.profile?.display_name).toBe('Cuenta A'));
    state.userId = 'responsable-b'; currentSnapshot = snapshot('Cuenta B');
    rerender();
    expect(result.current.data?.profile?.display_name).not.toBe('Cuenta A');
    await waitFor(() => expect(result.current.data?.profile?.display_name).toBe('Cuenta B'));
    expect(state.removeChannel).toHaveBeenCalled();
  });

  it('clears cached business data when access is revoked', async () => {
    const { result } = renderHook(useWorkspace, { wrapper: WorkspaceProvider });
    await waitFor(() => expect(result.current.data).toBeDefined());
    snapshotError = { message: 'ACCESS_DENIED' };
    await act(async () => { await result.current.refresh(); });
    await waitFor(() => expect(result.current.error?.message).toContain('habilitada'), { timeout: 3000 });
    expect(result.current.data).toBeUndefined();
    await act(async () => { await expect(result.current.command('save_order', {})).rejects.toThrow('habilitada'); });
  });

  it('keeps stock confirmation and concurrency domain errors distinguishable to the UI', () => {
    expect(friendlyError({ message: 'STOCK_CONFIRMATION_REQUIRED' })).toMatchObject({ code: 'STOCK_CONFIRMATION_REQUIRED' });
    expect(friendlyError({ message: 'VERSION_CONFLICT' }).message).toContain('Otra persona');
    expect(friendlyError({ message: 'VALIDATION_ERROR: cantidad inválida' }).message).toContain('cantidad inválida');
    expect(friendlyError({ message: 'secret internal database detail' }).message).not.toContain('secret');
  });

  it('rejects malformed recovery exports instead of downloading an integrity-only backup', async () => {
    const { result } = renderHook(useWorkspace, { wrapper: WorkspaceProvider });
    await waitFor(() => expect(result.current.data).toBeDefined());
    state.rpc.mockImplementation(name => name === 'app_export' ? Promise.resolve({ data: null, error: null }) : mockRpc(name));
    await expect(result.current.exportData()).rejects.toThrow('respaldo completo válido');
    const complete = { format: 'pedidos-stock', schema_version: 2, exported_at: '2026-10-28T15:00:00Z', data: currentSnapshot, raw_tables: { clients: [] }, idempotency_commands: [] };
    state.rpc.mockImplementation(name => name === 'app_export' ? Promise.resolve({ data: complete, error: null }) : mockRpc(name));
    await expect(result.current.exportData()).resolves.toEqual(complete);
  });
});
