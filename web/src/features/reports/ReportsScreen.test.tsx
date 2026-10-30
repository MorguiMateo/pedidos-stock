import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { today } from '@shared/lib/format';
import type { FinancialMovement, Order, Snapshot } from '@shared/lib/types';
import type { Workspace } from '@/lib/workspace';
import ReportsScreen from './ReportsScreen';

const mocked = vi.hoisted(() => ({ ws: {} as Workspace, file: vi.fn(), text: vi.fn() }));
vi.mock('@/lib/workspace', () => ({ useWorkspace: () => mocked.ws }));
vi.mock('@/lib/exportFile', () => ({ downloadFile: mocked.file, downloadText: mocked.text }));
const order = (patch: Partial<Order> = {}): Order => ({ id: 'historical-order', client_id: 'ana', pickup_date: today(), location_id: 'a', payment_method: 'efectivo', status: 'entregado', notes: '', total: '120', version: 8, allocation_version: 0, created_at: `${today()}T12:00:00Z`, delivered_at: '2020-01-01T12:00:00Z', lines: [{ id: 'line', product_id: 'food', quantity: '1.5', unit_price: '80', product_name: 'Pollo histórico', product_unit: 'kg', reserved: '0', shortage: '0' }], ...patch });
const fixture = (): Snapshot => ({ profile: { id: 'admin', role: 'admin', location_id: null, display_name: 'Administración' }, locations: [{ id: 'a', name: 'Centro', color: '#ff8844', active: true, is_pickup: true }, { id: 'b', name: 'Salta', color: '#778844', active: true, is_pickup: true }], clients: [{ id: 'ana', name: 'Ana', phone: '261111111', version: 1 }], items: [{ id: 'food', name: 'Nombre actual', kind: 'product', unit: 'kg', price: '9999', minimum: '2', active: true, version: 1 }], orders: [order(), order({ id: 'gratis-order', client_id: null, payment_method: 'gratis', total: '999' }), order({ id: 'cancelled', status: 'cancelado' })], stock: [{ item_id: 'food', location_id: 'a', on_hand: '4', usable: '3', reserved: '2', shortage: '0' }], movements: [], recipes: [], purchases: [], productions: [], financial_movements: [{ id: 'payment', order_id: 'historical-order', purchase_id: null, kind: 'payment', amount: '20', method: 'efectivo', occurred_on: today(), notes: '', category: '', reconciled: false, version: 4, created_at: `${today()}T12:00:00Z`, reverses_id: null }], updated_at: `${today()}T12:00:00Z` });
beforeAll(() => { HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); }; HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); }; });
beforeEach(() => { mocked.ws = { data: fixture(), isLoading: false, isRefreshing: false, isSaving: false, isConfigured: true, isOnline: true, error: null, refresh: vi.fn(), exportData: vi.fn(), command: vi.fn().mockResolvedValue({ id: 'saved', affected_order_ids: [] }), setMember: vi.fn() }; mocked.file.mockReset().mockResolvedValue(undefined); mocked.text.mockReset().mockResolvedValue(undefined); });
afterEach(cleanup);
function section(title: string) { return screen.getByRole('heading', { name: title }).closest('section')!; }

describe('native report operational and financial parity', () => {
  it('shows actual cash over arbitrary inclusive dates, nets refunds/reversals and filters by pickup point independently of the month', () => {
    mocked.ws.data!.orders.push(order({ id: 'salta-cash', location_id: 'b', payment_method: 'transferencia', total: '9999' }));
    const movement = (id: string, amount: string, occurred_on: string, patch: Partial<FinancialMovement> = {}): FinancialMovement => ({ ...mocked.ws.data!.financial_movements![0]!, id, amount, occurred_on, ...patch });
    mocked.ws.data!.financial_movements = [
      movement('cash-start', '100', '2024-01-15'),
      movement('cash-refund', '-20', '2024-02-10', { kind: 'refund' }),
      movement('cash-reversal', '-10', '2024-02-11', { kind: 'reversal', reverses_id: 'cash-start' }),
      movement('cash-end', '80', '2024-03-20', { order_id: 'salta-cash' }),
      movement('before-range', '5000', '2024-01-14'),
      movement('after-range', '6000', '2024-03-21'),
      movement('bank-transfer', '7000', '2024-02-10', { method: 'transferencia' }),
      movement('expense-not-collection', '-8000', '2024-02-10', { kind: 'expense', order_id: null }),
    ];
    render(<ReportsScreen />);
    fireEvent.change(screen.getByLabelText('Efectivo desde'), { target: { value: '2024-01-15' } });
    fireEvent.change(screen.getByLabelText('Efectivo hasta'), { target: { value: '2024-03-20' } });
    const cash = within(section('Cobros reales en efectivo'));
    expect(cash.getByText('Efectivo recibido').parentElement!.textContent).toContain('$ 180,00');
    expect(cash.getByText('Reintegros y reversiones de efectivo').parentElement!.textContent).toContain('$ 30,00');
    expect(cash.getByText('Efectivo neto cobrado').parentElement!.textContent).toContain('$ 150,00');
    expect(cash.getAllByText('Centro').length).toBeGreaterThan(0);
    expect(cash.getAllByText('Salta').length).toBeGreaterThan(0);
    expect(cash.getByText('Ver detalle de efectivo (4 movimientos)')).toBeTruthy();
    fireEvent.click(cash.getByText('Ver detalle de efectivo (4 movimientos)'));
    expect(cash.getByText('Reintegro en efectivo')).toBeTruthy();
    expect(cash.getByText('Reversión en efectivo')).toBeTruthy();
    expect(cash.queryByText('$ 7.000,00')).toBeNull();
    expect(cash.queryByText('$ 9.999,00')).toBeNull();
    fireEvent.change(cash.getByLabelText('Punto de cobros en efectivo'), { target: { value: 'a' } });
    expect((screen.getByLabelText('Punto de retiro') as HTMLSelectElement).value).toBe('a');
    expect(cash.getByText('Efectivo neto cobrado').parentElement!.textContent).toContain('$ 70,00');
    expect(cash.queryAllByRole('cell', { name: 'Salta' })).toHaveLength(0);
    expect((screen.getByLabelText('Efectivo desde') as HTMLInputElement).value).toBe('2024-01-15');
    expect((screen.getByLabelText('Efectivo hasta') as HTMLInputElement).value).toBe('2024-03-20');
  });
  it('clearly identifies an empty cash period even when all pickup points have zero totals', () => {
    mocked.ws.data!.financial_movements = [];
    render(<ReportsScreen />);
    const cash = within(section('Cobros reales en efectivo'));
    expect(cash.getByText('Sin cobros en efectivo para este período y punto.')).toBeTruthy();
    expect(cash.getByText('Efectivo neto cobrado').parentElement!.textContent).toContain('$ 0,00');
  });
  it('validates cash date ranges and exports the selected cash period and point', async () => {
    render(<ReportsScreen />);
    fireEvent.change(screen.getByLabelText('Efectivo desde'), { target: { value: '2024-01-15' } });
    fireEvent.change(screen.getByLabelText('Efectivo hasta'), { target: { value: '2024-01-14' } });
    expect(within(section('Cobros reales en efectivo')).getByRole('alert').textContent).toContain('desde debe ser anterior o igual');
    fireEvent.click(screen.getByRole('button', { name: 'Exportar Excel' }));
    expect(await screen.findByText('Revisá el período de cobros en efectivo antes de exportar.')).toBeTruthy();
    expect(mocked.file).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Efectivo hasta'), { target: { value: '2024-03-20' } });
    fireEvent.change(screen.getByLabelText('Punto de retiro'), { target: { value: 'a' } });
    fireEvent.click(screen.getByRole('button', { name: 'Exportar Excel' }));
    await waitFor(() => expect(mocked.file).toHaveBeenCalledTimes(1));
    const workbook = new TextDecoder().decode(mocked.file.mock.calls[0]![1]);
    expect(workbook).toContain('2024-01-15');
    expect(workbook).toContain('2024-03-20');
    expect(workbook).toContain('Efectivo');
  });
  it('separates historical sales, unique clients, gratis samples and real collections', () => {
    render(<ReportsScreen />);
    expect(screen.getAllByText('2 pedidos válidos').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1 clientes únicos').length).toBeGreaterThan(0);
    const products = within(section('Productos del mes'));
    expect(products.getByText('Pollo histórico')).toBeTruthy();
    expect(products.getByText('3 kg')).toBeTruthy();
    expect(products.getAllByText('$ 120,00').length).toBeGreaterThan(0);
    const debt = within(section('Entregados pendientes de cobro'));
    expect(debt.getByText('$ 100,00')).toBeTruthy();
    expect(debt.queryByText('#gratis-o')).toBeNull();
    expect(within(section('Ingresos y egresos')).getAllByText('$ 20,00').length).toBeGreaterThan(0);
  });
  it('downloads a real xlsx workbook with selected point, original report sheets and historical details', async () => {
    mocked.ws.data!.orders.push(order({ id: 'other-point', location_id: 'b', total: '900', lines: [{ id: 'other-line', product_id: 'food', product_name: 'Exclusivo otro punto', product_unit: 'kg', quantity: '1', unit_price: '900', reserved: '0', shortage: '0' }] }));
    render(<ReportsScreen />);
    fireEvent.change(screen.getByLabelText('Punto de retiro'), { target: { value: 'a' } });
    fireEvent.click(screen.getByRole('button', { name: 'Exportar Excel' }));
    await waitFor(() => expect(mocked.file).toHaveBeenCalledTimes(1));
    const [name, bytes, mime] = mocked.file.mock.calls[0]!;
    expect(name).toMatch(/\.xlsx$/);
    expect(mime).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect([...bytes.slice(0, 4)]).toEqual([80, 75, 3, 4]);
    const workbook = new TextDecoder().decode(bytes);
    expect(workbook).toContain('Pedidos filtrados');
    expect(workbook).toContain('Entregados sin cobrar');
    expect(workbook).toContain('Stock y mínimos');
    expect(workbook).toContain('Pollo histórico');
    expect(workbook).not.toContain('Exclusivo otro punto');
    expect(workbook).toContain('<v>100.00</v>');
  });
  it('honors optimistic version for reconciliation and requires a reversal reason', async () => {
    render(<ReportsScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Marcar conciliado' }));
    await waitFor(() => expect(mocked.ws.command).toHaveBeenCalledWith('reconcile_movement', { id: 'payment', reconciled: true }, 4));
    fireEvent.click(screen.getByRole('button', { name: 'Revertir con motivo' }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('Motivo obligatorio'), { target: { value: 'Cobro duplicado' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Crear reversión' }));
    await waitFor(() => expect(mocked.ws.command).toHaveBeenLastCalledWith('reverse_financial_movement', { id: 'payment', reason: 'Cobro duplicado' }));
  });
  it('validates expense money precision, retaining inputs until the server confirms success', async () => {
    render(<ReportsScreen />); fireEvent.click(screen.getByRole('button', { name: 'Registrar egreso' }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('Importe ($)'), { target: { value: '1,234' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Registrar egreso' }));
    expect(await dialog.findByText('El importe admite dos decimales.')).toBeTruthy();
    expect(mocked.ws.command).not.toHaveBeenCalled();
    fireEvent.change(dialog.getByLabelText('Importe ($)'), { target: { value: '1,23' } });
    fireEvent.change(dialog.getByLabelText('Medio de pago'), { target: { value: 'efectivo' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Registrar egreso' }));
    await waitFor(() => expect(mocked.ws.command).toHaveBeenCalledWith('record_expense', { amount: '1.23', method: 'efectivo', category: 'Gastos generales', occurred_on: today(), notes: '' }));
  });
  it('restricts responsables to their point and disables finance writes and complete server backup', () => {
    mocked.ws.data!.profile = { id: 'responsable', role: 'responsable', location_id: 'a', display_name: 'Punto A' };
    render(<ReportsScreen />);
    const selector = screen.getByLabelText('Punto de retiro') as HTMLSelectElement;
    expect(selector.disabled).toBe(true);
    expect([...selector.options].map(option => option.value)).toEqual(['a']);
    const cashSelector = screen.getByLabelText('Punto de cobros en efectivo') as HTMLSelectElement;
    expect(cashSelector.disabled).toBe(true);
    expect([...cashSelector.options].map(option => option.value)).toEqual(['a']);
    expect((screen.getByRole('button', { name: 'Registrar egreso' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Descargar respaldo JSON' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Marcar conciliado' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('backs up the fresh server export rather than the cached snapshot and hashes the portable payload', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const fresh = { format: 'pedidos-stock', schema_version: 2, exported_at: today(), data: { ...fixture(), clients: [{ id: 'fresh-only', name: 'Contacto recién creado', version: 1 }] }, raw_tables: { clients: [{ id: 'fresh-only' }] }, idempotency_commands: [] };
    vi.mocked(mocked.ws.exportData).mockResolvedValue(fresh as Awaited<ReturnType<Workspace['exportData']>>);
    render(<ReportsScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Descargar respaldo JSON' }));
    await waitFor(() => expect(mocked.text).toHaveBeenCalledTimes(1));
    const [name, content, mime] = mocked.text.mock.calls[0]!;
    expect(mocked.ws.exportData).toHaveBeenCalledTimes(1);
    expect(name).toMatch(/respaldo.*\.json$/);
    expect(mime).toBe('application/json;charset=utf-8');
    const downloaded = JSON.parse(content);
    expect(downloaded.data.clients[0].id).toBe('fresh-only');
    expect(downloaded.integrity.algorithm).toBe('SHA-256');
    expect(downloaded.integrity.payload_hash).toMatch(/^[a-f0-9]{64}$/);
    const expected = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(fresh)));
    expect(downloaded.integrity.payload_hash).toBe(Buffer.from(expected).toString('hex'));
    vi.unstubAllGlobals();
  });
  it('blocks workbook export for invalid operational dates and keeps the selected criteria visible', async () => {
    render(<ReportsScreen />);
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2030-12-31' } });
    fireEvent.click(screen.getByRole('button', { name: 'Exportar Excel' }));
    expect(await screen.findByText('Revisá las fechas y el umbral de días antes de exportar.')).toBeTruthy();
    expect(mocked.file).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Desde') as HTMLInputElement).value).toBe('2030-12-31');
  });
});
