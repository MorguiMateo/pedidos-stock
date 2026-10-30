import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PropsWithChildren } from 'react';
import type { Workspace } from './lib/workspace';
const state = vi.hoisted(() => ({ workspace: {} as Workspace, signOut: vi.fn() }));
vi.mock('@/lib/workspace', () => ({ useWorkspace: () => state.workspace, WorkspaceProvider: ({ children }: PropsWithChildren) => children }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'u' } }, signOut: state.signOut }) }));
vi.mock('@/features/auth/AuthGate', () => ({ default: ({ children }: PropsWithChildren) => children }));
vi.mock('@/features/sales/SalesScreen', () => ({ default: () => <h1>Agenda operativa</h1> }));
vi.mock('@/features/clients/ClientsScreen', () => ({ default: () => <h1>Fichas de clientes</h1> }));
vi.mock('@/features/stock/StockScreen', () => ({ default: () => <h1>Inventario</h1> }));
vi.mock('@/features/reports/ReportsScreen', () => ({ default: () => <h1>Informes de administración</h1> }));
vi.mock('@/features/settings/SettingsScreen', () => ({ default: () => <h1>Configuración interna</h1> }));
import App from './App';
beforeEach(() => {
  window.history.replaceState({}, '', '/');
  state.workspace = {
    data: { profile: { id: 'u', role: 'admin', location_id: null, display_name: 'Administradora' }, locations: [], items: [], clients: [], orders: [], stock: [], movements: [], recipes: [], purchases: [], productions: [], updated_at: '2026-10-28' },
    error: null, isOnline: true, isConfigured: true, isLoading: false, isSaving: false, isRefreshing: false,
    refresh: vi.fn().mockResolvedValue(undefined), command: vi.fn(), exportData: vi.fn(), setMember: vi.fn(),
  };
  state.signOut.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);
describe('web navigation and account boundaries', () => {
  it('supports direct links and admin navigation without relying on the mobile router', async () => {
    window.history.replaceState({}, '', '/resumen');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Informes de administración' })).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Clientes' }));
    expect(await screen.findByRole('heading', { name: 'Fichas de clientes' })).toBeTruthy();
    expect(window.location.pathname).toBe('/clientes');
  });
  it('rejects direct admin routes and hides their links for responsables', async () => {
    state.workspace.data!.profile = { id: 'u', role: 'responsable', location_id: 'mendieta', display_name: 'Responsable' };
    window.history.replaceState({}, '', '/ajustes');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Agenda operativa' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Ajustes/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Resumen/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Configuración interna' })).toBeNull();
    expect(window.location.pathname).toBe('/');
  });
  it('does not mount business routes while awaiting membership assignment', () => {
    state.workspace.data = undefined;
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Esperando habilitación' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Agenda operativa' })).toBeNull();
  });
  it('retains session read-only data offline and blocks refresh', async () => {
    state.workspace.isOnline = false;
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Agenda operativa' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Conectate para guardar cambios');
    expect((screen.getByRole('button', { name: 'Actualizar' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('surfaces logout failures without silently keeping a supposedly closed session', async () => {
    state.signOut.mockRejectedValue(new Error('No se pudo cerrar la sesión.'));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    await waitFor(() => expect(state.signOut).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'No se pudo cerrar la sesión.');
  });
});
