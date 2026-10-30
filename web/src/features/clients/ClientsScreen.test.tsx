import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { today } from '@shared/lib/format';
import type { Snapshot } from '@shared/lib/types';
import type { Workspace } from '@/lib/workspace';
import ClientsScreen from './ClientsScreen';
import { ClientEditor } from './ClientEditor';

const mocked = vi.hoisted(() => ({ ws: {} as Workspace }));
vi.mock('@/lib/workspace', () => ({ useWorkspace: () => mocked.ws }));
const fixture = (): Snapshot => ({ profile: { id: 'admin', role: 'admin', location_id: null, display_name: 'Admin' }, locations: [{ id: 'point', name: 'Centro', color: '#dd8844', active: true, is_pickup: true }], clients: [{ id: 'ana', name: 'Ana', phone: '261 111-111', version: 7, preferred_location_id: 'point', pets: [{ name: 'Firulais', species: 'perro', weight_kg: '12', diet: 'Sin pollo' }] }], items: [], orders: [], recipes: [], purchases: [], productions: [], movements: [], stock: [], updated_at: today() });
beforeAll(() => { HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); }; HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); }; });
beforeEach(() => { mocked.ws = { data: fixture(), isLoading: false, isRefreshing: false, isSaving: false, isConfigured: true, isOnline: true, error: null, refresh: vi.fn(), exportData: vi.fn(), command: vi.fn().mockResolvedValue({ id: 'ana', affected_order_ids: [] }), setMember: vi.fn() }; });
afterEach(cleanup);

describe('native client workflow parity', () => {
  it('searches pet diet and normalized phone without creating separate contacts', () => {
    render(<ClientsScreen />);
    fireEvent.change(screen.getByLabelText('Buscar por cliente, contacto o mascota'), { target: { value: 'sin pollo' } });
    expect(screen.getByRole('button', { name: 'Ana' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Buscar por cliente, contacto o mascota'), { target: { value: '261111111' } });
    expect(screen.getByRole('button', { name: 'Ana' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Buscar por cliente, contacto o mascota'), { target: { value: 'inexistente' } });
    expect(screen.queryByRole('button', { name: 'Ana' })).toBeNull();
  });
  it('blocks duplicate normalized phones and lets the user open the existing versioned contact', async () => {
    render(<ClientsScreen />); fireEvent.click(screen.getByRole('button', { name: 'Nuevo cliente' }));
    let dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('Nombre del cliente'), { target: { value: 'Otra Ana' } });
    fireEvent.change(dialog.getByLabelText('Teléfono'), { target: { value: '(261)111111' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Guardar cambios' }));
    expect(mocked.ws.command).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole('button', { name: 'Usar ficha de Ana' }));
    dialog = within(screen.getByRole('dialog'));
    expect((dialog.getByLabelText('Nombre del cliente') as HTMLInputElement).value).toBe('Ana');
    fireEvent.change(dialog.getByLabelText('Peso en kg de mascota 1 (opcional)'), { target: { value: '12,5' } });
    fireEvent.change(dialog.getByLabelText('Especie de mascota 1'), { target: { value: 'gato' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(mocked.ws.command).toHaveBeenCalledWith('save_client', expect.objectContaining({ id: 'ana', name: 'Ana', preferred_location_id: 'point', pets: [{ name: 'Firulais', species: 'gato', weight_kg: '12.5', diet: 'Sin pollo' }] }), 7));
  });
  it('keeps invalid pet weights in the form and never submits them', async () => {
    render(<ClientsScreen />); fireEvent.click(screen.getByRole('button', { name: 'Nuevo cliente' }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('Nombre del cliente'), { target: { value: 'Valentina' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Agregar mascota' }));
    fireEvent.change(dialog.getByLabelText('Nombre de mascota 1'), { target: { value: 'Nube' } });
    fireEvent.change(dialog.getByLabelText('Peso en kg de mascota 1 (opcional)'), { target: { value: '0' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Guardar cambios' }));
    expect(await dialog.findByText('Cada mascota necesita nombre y un peso mayor a cero si lo indicás.')).toBeTruthy();
    expect(mocked.ws.command).not.toHaveBeenCalled();
    expect((dialog.getByLabelText('Nombre de mascota 1') as HTMLInputElement).value).toBe('Nube');
  });
  it('disables edits when offline but keeps existing client details readable', () => {
    mocked.ws.isOnline = false; render(<ClientsScreen />);
    expect((screen.getByRole('button', { name: 'Nuevo cliente' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Ana' }));
    expect((screen.getByRole('button', { name: 'Editar ficha' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Firulais')).toBeTruthy();
  });
});


describe('reusable complete client editor', () => {
  it('saves all new-client details and returns an immediately selectable client', async () => {
    const onSaved = vi.fn();
    render(<ClientEditor initialName="Valentina" onSaved={onSaved} onCancel={vi.fn()} />);
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('Teléfono'), { target: { value: '2619990000' } });
    fireEvent.change(dialog.getByLabelText('Punto de retiro habitual'), { target: { value: 'point' } });
    fireEvent.change(dialog.getByLabelText('Notas del cliente'), { target: { value: 'Llamar antes' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Agregar mascota' }));
    fireEvent.change(dialog.getByLabelText('Nombre de mascota 1'), { target: { value: 'Nube' } });
    fireEvent.change(dialog.getByLabelText('Edad en años de mascota 1 (opcional)'), { target: { value: '3' } });
    fireEvent.change(dialog.getByLabelText('Anotaciones de mascota 1 (opcional)'), { target: { value: 'Miedosa' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('ana', expect.objectContaining({ name: 'Valentina', phone: '2619990000', preferred_location_id: 'point', notes: 'Llamar antes', pets: [expect.objectContaining({ name: 'Nube', age_years: '3', age_recorded_on: today(), notes: 'Miedosa' })] })));
  });
  it('retains entered form values and does not select a client after a failed save', async () => {
    mocked.ws.command = vi.fn().mockRejectedValue(new Error('Servidor no disponible'));
    const onSaved = vi.fn();
    render(<ClientEditor initialName="Valentina" onSaved={onSaved} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Servidor no disponible')).toBeTruthy();
    expect((screen.getByLabelText('Nombre del cliente') as HTMLInputElement).value).toBe('Valentina');
    expect(onSaved).not.toHaveBeenCalled();
  });
});
