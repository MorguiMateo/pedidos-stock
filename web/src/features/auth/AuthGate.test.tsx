import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';
const state = vi.hoisted(() => ({
  configured: true,
  auth: { session: null as Session | null, initializing: false, signIn: vi.fn(), register: vi.fn(), signOut: vi.fn() },
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => state.auth, get backendConfigured() { return state.configured; } }));
import AuthGate from './AuthGate';
beforeEach(() => {
  state.configured = true;
  state.auth.session = null;
  state.auth.initializing = false;
  state.auth.signIn.mockReset().mockResolvedValue(undefined);
  state.auth.register.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);
describe('personal account access', () => {
  it('keeps private UI hidden until an authenticated session exists', () => {
    const { rerender } = render(<AuthGate><p>Datos privados</p></AuthGate>);
    expect(screen.queryByText('Datos privados')).toBeNull();
    state.auth.session = { user: { id: 'person-1' } } as Session;
    rerender(<AuthGate><p>Datos privados</p></AuthGate>);
    expect(screen.getByText('Datos privados')).toBeTruthy();
  });
  it('passes account credentials only to Auth and retains understandable sign-in failures', async () => {
    state.auth.signIn.mockRejectedValue(new Error('El correo o la contraseña no son correctos.'));
    render(<AuthGate />);
    fireEvent.change(screen.getByLabelText('Correo'), { target: { value: 'persona@example.test' } });
    fireEvent.change(screen.getByLabelText(/^Contraseña/), { target: { value: 'test-password' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Ingresar' }).closest('form')!);
    await waitFor(() => expect(state.auth.signIn).toHaveBeenCalledWith('persona@example.test', 'test-password'));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'El correo o la contraseña no son correctos.');
    expect(state.auth.register).not.toHaveBeenCalled();
  });
  it('requests a personal account without pretending it is already enabled', async () => {
    render(<AuthGate />);
    fireEvent.click(screen.getByRole('button', { name: 'Solicitar una cuenta personal' }));
    fireEvent.change(screen.getByLabelText('Tu nombre'), { target: { value: 'Persona nueva' } });
    fireEvent.change(screen.getByLabelText('Correo'), { target: { value: 'nueva@example.test' } });
    fireEvent.change(screen.getByLabelText(/^Contraseña/), { target: { value: 'test-password' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Solicitar acceso' }).closest('form')!);
    await waitFor(() => expect(state.auth.register).toHaveBeenCalledWith('nueva@example.test', 'test-password', 'Persona nueva'));
    expect(await screen.findByText(/Una administradora debe habilitar tu cuenta/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ingresar' })).toBeTruthy();
  });
  it('does not attempt access without public backend configuration', () => {
    state.configured = false;
    render(<AuthGate />);
    expect((screen.getByRole('button', { name: 'Ingresar' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Falta configurar la conexión/)).toBeTruthy();
    expect(state.auth.signIn).not.toHaveBeenCalled();
  });
});
