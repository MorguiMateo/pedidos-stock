import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Snapshot } from '@shared/lib/types';
import type { Workspace } from '@/lib/workspace';
import StockScreen from './StockScreen';
import ProductionPanel from './ProductionPanel';
import SettingsScreen from '../settings/SettingsScreen';
const mocked = vi.hoisted(() => ({ ws: {} as Workspace }));
vi.mock('@/lib/workspace', () => ({ useWorkspace: () => mocked.ws }));
function data(): Snapshot {
  return { profile: { id: 'admin', display_name: 'Admin', role: 'admin', location_id: 'a' }, locations: [{ id: 'a', name: 'Mendieta', color: '#319C75', active: true, is_pickup: true }, { id: 'b', name: 'Salta', color: '#8757D5', active: true, is_pickup: true }, { id: 'cocina', name: 'Cocina central', color: '#AA6A19', active: true, is_pickup: false }], items: [{ id: 'p', name: 'Alimento pollo', kind: 'product', unit: 'kg', active: true, version: 3, price: '4000', minimum: '1' }], clients: [], orders: [], purchases: [], productions: [], recipes: [], stock: [{ item_id: 'p', location_id: 'a', on_hand: '10', reserved: '4', shortage: '0', usable: '9' }], movements: [], updated_at: '2026-10-28', production_plans: [{ id: 'plan', product_id: 'p', quantity: '12', available_on: '2026-10-29', fulfilled_quantity: '3', allocated_quantity: '4', available_quantity: '5', status: 'planificado', version: 7, notes: '', created_at: '2026-10-28' }] };
}
beforeEach(() => {
  mocked.ws = { data: data(), isLoading: false, isRefreshing: false, isSaving: false, isConfigured: true, isOnline: true, error: null, refresh: vi.fn(), exportData: vi.fn(), command: vi.fn().mockResolvedValue({ id: 'saved', affected_order_ids: [] }), setMember: vi.fn() };
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(cleanup);
describe('stock and administration contracts', () => {
  it('limits responsables to their own point and blocks configuration', () => {
    mocked.ws.data!.profile!.role = 'responsable';
    const { unmount } = render(<StockScreen />);
    expect(screen.getByRole('button', { name: 'Mendieta' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Salta' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Inventario inicial' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Transferir' })).toBeNull();
    unmount(); render(<SettingsScreen />);
    expect(screen.getByText('Acceso reservado a administración')).toBeTruthy();
    expect(screen.queryByText('Catálogo de productos')).toBeNull();
  });
  it('records initial stock as an additive adjustment with the automatic audit reason', async () => {
    render(<StockScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Inventario inicial' }));
    fireEvent.change(screen.getByLabelText('Producto'), { target: { value: 'p' } });
    fireEvent.change(screen.getByLabelText('Cantidad (kg)'), { target: { value: '2,5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar movimiento' }));
    await waitFor(() => expect(mocked.ws.command).toHaveBeenCalledWith('adjust_stock', { item_id: 'p', location_id: 'a', quantity: '2.5', reason: 'Inventario inicial' }));
  });
  it('requires transfer reason and prevents transferring reserved or expired stock', async () => {
    render(<StockScreen />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Transferir' })[0]!);
    fireEvent.change(screen.getByLabelText('Producto'), { target: { value: 'p' } });
    fireEvent.change(screen.getByLabelText('Cantidad (kg)'), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar movimiento' }));
    await screen.findByText('Ingresá un motivo para conservar el historial.');
    expect(mocked.ws.command).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Motivo obligatorio'), { target: { value: 'Reposición Salta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar movimiento' }));
    await screen.findByText('No alcanza el stock libre del origen. No se pueden transferir reservas ni lotes vencidos.');
    expect(mocked.ws.command).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Cantidad (kg)'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar movimiento' }));
    await waitFor(() => expect(mocked.ws.command).toHaveBeenCalledWith('transfer_stock', { item_id: 'p', from_location_id: 'a', to_location_id: 'b', quantity: '5', reason: 'Reposición Salta' }));
  });
  it('reconciles production only above linked receipts and preserves optimistic version', async () => {
    render(<ProductionPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar con cantidad real' }));
    fireEvent.change(screen.getByLabelText('Cantidad real total (kg)'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await screen.findByText('El total real no puede ser menor que los ingresos ya vinculados.');
    expect(mocked.ws.command).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Cantidad real total (kg)'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(mocked.ws.command).toHaveBeenCalledWith('reconcile_production_plan', { id: 'plan', actual_quantity: '8' }, 7));
  });
  it('disables stock mutations while offline', () => {
    mocked.ws.isOnline = false;
    render(<StockScreen />);
    expect((screen.getByRole('button', { name: 'Inventario inicial' }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocked.ws.command).not.toHaveBeenCalled();
  });
});
