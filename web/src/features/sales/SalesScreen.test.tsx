import React from 'react';
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Snapshot, Order } from '@shared/lib/types';
import { today, formatDate, monthLabel, isValidDate } from '@shared/lib/format';
import { shiftCalendarDate } from '@shared/lib/calendar';
import SalesScreen from './SalesScreen';

const state = vi.hoisted(() => ({ data: undefined as Snapshot | undefined, command: vi.fn(), isOnline: true }));
vi.mock('@/lib/workspace', () => ({ useWorkspace: () => ({ data: state.data, command: state.command, isConfigured: true, isOnline: state.isOnline, isSaving: false, isLoading: false, error: null, refresh: vi.fn() }) }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'admin' } } }) }));
const fixture = (): Snapshot => ({
  profile: { id: 'admin', role: 'admin', location_id: null, display_name: 'Administración' },
  locations: [{ id: 'punto', name: 'Centro', color: '#339977', active: true, is_pickup: true }],
  clients: [{ id: 'ana', name: 'Ana Pérez', phone: '261111111', version: 1, first_purchase_gift: { eligible: true, order_id: null, state: 'available' } }],
  items: [{ id: 'comida', kind: 'product', name: 'Menú natural', unit: 'kg', price: '200', minimum: '1', active: true, version: 1, package_size: '0.5' }, { id: 'bolsa', kind: 'product', name: 'Bolsa reutilizable', unit: 'unidad', price: '20', minimum: '0', active: true, version: 1, first_purchase_gift_eligible: true }],
  recipes: [], orders: [], purchases: [], productions: [], pickup_closures: [], stock: [{ item_id: 'comida', location_id: 'punto', on_hand: '100', reserved: '0', shortage: '0' }, { item_id: 'bolsa', location_id: 'punto', on_hand: '100', reserved: '0', shortage: '0' }], movements: [], financial_movements: [], updated_at: new Date().toISOString(),
});
const order = (overrides: Partial<Order> = {}): Order => ({ id: 'pedido', client_id: 'ana', pickup_date: today(), location_id: 'punto', payment_method: 'efectivo', status: 'pendiente_entrega', notes: '', total: '100', version: 7, allocation_version: 2, created_at: new Date().toISOString(), delivered_at: null, packages: 1, prepared_packages: 1, lines: [{ id: 'linea', product_id: 'comida', quantity: '1', unit_price: '100', product_name: 'Menú histórico', product_unit: 'kg', product_package_size: '0.5', reserved: '1', shortage: '0' }], ...overrides });
function dialog() { return screen.getByRole('dialog'); }
beforeAll(() => { HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); }; HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); }; });
beforeEach(() => { state.data = fixture(); state.command.mockReset().mockResolvedValue({ id: 'new-order', affected_order_ids: [] }); state.isOnline = true; });
afterEach(cleanup);

describe('Sales native workflow parity', () => {
  it('lists pending product totals on separate header rows, independent of payment, preserving order amounts and filter scope', async () => {
    const lines = (dog: string, bags: string, calcium: string): Order['lines'] => [
      { ...order().lines[0]!, product_name: 'Fórmula perro', product_unit: 'unidad', quantity: dog },
      { ...order().lines[0]!, id: 'bolsas', product_id: 'bolsa', product_name: undefined, product_unit: undefined, quantity: bags },
      { ...order().lines[0]!, id: 'calcio', product_id: 'calcio', product_name: 'Calcio', quantity: calcium },
    ];
    state.data!.orders = [
      order({ id: 'paid', total: '1312.50', prepared_packages: 0, lines: lines('10', '2', '1.125') }),
      order({ id: 'unpaid', total: '1712.50', lines: lines('14', '2', '1.125') }),
      order({ id: 'delivered', status: 'entregado', lines: lines('100', '100', '100') }),
      order({ id: 'cancelled', status: 'cancelado', lines: lines('100', '100', '100') }),
      order({ id: 'returned', returned_at: new Date().toISOString(), lines: lines('100', '100', '100') }),
      order({ id: 'tomorrow', pickup_date: shiftCalendarDate(today(), 1, 'day'), lines: lines('100', '100', '100') }),
    ];
    state.data!.financial_movements = [{ id: 'paid-in-full', kind: 'payment', order_id: 'paid', purchase_id: null, amount: '1312.50', method: 'efectivo', category: '', occurred_on: today(), notes: '', reconciled: false, version: 1, created_at: new Date().toISOString(), reverses_id: null }];
    state.data!.clients.push({ id: 'bruno', name: 'Bruno', version: 1 });
    const user = userEvent.setup(); render(<SalesScreen/>);
    const list = screen.getByRole('list', { name: 'Productos pendientes en Centro' });
    expect(within(list).getAllByRole('listitem').map(row => row.textContent)).toEqual(['24 X FP', '4 X BOL', '2.25 kg X K']);
    expect(list.parentElement!.parentElement!.textContent).toContain('2 pendientes');
    expect(list.parentElement!.textContent).not.toContain('$');
    const dayTotals = () => within(screen.getByRole('list', { name: 'Unidades totales del día en Centro' })).getAllByRole('listitem').map(row => row.textContent);
    const expectedDayTotals = ['124 X FP', '104 X BOL', '102.25 kg X K'];
    expect(dayTotals()).toEqual(expectedDayTotals);
    expect(within(screen.getByRole('button', { name: /#paid/ })).getByText('$ 1.312,50')).toBeTruthy();
    expect(within(screen.getByRole('button', { name: /#unpaid/ })).getByText('$ 1.712,50')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Filtros' }));
    await user.selectOptions(screen.getByLabelText('Estado de pago'), 'pagado');
    const paidList = screen.getByRole('list', { name: 'Productos pendientes en Centro' });
    expect(within(paidList).getAllByRole('listitem').map(row => row.textContent)).toEqual(['10 X FP', '2 X BOL', '1.125 kg X K']);
    expect(paidList.parentElement!.parentElement!.textContent).toContain('1 pendientes');
    expect(dayTotals()).toEqual(expectedDayTotals);
    await user.selectOptions(screen.getByLabelText('Preparación'), 'preparado');
    expect(screen.queryByRole('list', { name: 'Productos pendientes en Centro' })).toBeNull();
    expect(dayTotals()).toEqual(expectedDayTotals);
    await user.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    await user.selectOptions(screen.getByLabelText('Estado de entrega'), 'entregado');
    expect(screen.getByText('Sin productos pendientes')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Productos pendientes en Centro' })).toBeNull();
    expect(dayTotals()).toEqual(expectedDayTotals);
    await user.selectOptions(screen.getByLabelText('Producto'), 'bolsa');
    expect(dayTotals()).toEqual(expectedDayTotals);
    await user.selectOptions(screen.getByLabelText('Cliente'), 'bruno');
    expect(dayTotals()).toEqual(expectedDayTotals);
  });
  it('adds valid day quantities by point and overall, including gifts while excluding canceled, returned and other days', async () => {
    state.data!.locations.push({ id: 'otro', name: 'Salta', color: '#335577', active: true, is_pickup: true });
    const units = (quantity: string, isGift = false): Order['lines'] => [{ ...order().lines[0]!, quantity, is_gift: isGift }];
    state.data!.orders = [
      order({ id: 'pending', lines: units('1.25') }),
      order({ id: 'delivered', status: 'entregado', lines: units('2.5') }),
      order({ id: 'gift', location_id: 'otro', payment_method: 'gratis', lines: units('0.75', true) }),
      order({ id: 'cancelled', status: 'cancelado', lines: units('100') }),
      order({ id: 'returned', returned_at: new Date().toISOString(), lines: units('100') }),
      order({ id: 'tomorrow', pickup_date: shiftCalendarDate(today(), 1, 'day'), lines: units('100') }),
    ];
    const user = userEvent.setup(); render(<SalesScreen/>);
    const total = () => screen.getByRole('list', { name: 'Unidades totales del día en todos los puntos seleccionados' });
    expect(total().textContent).toBe('4.5 kg X Menú histórico');
    expect(screen.getByRole('list', { name: 'Unidades totales del día en Centro' }).textContent).toBe('3.75 kg X Menú histórico');
    expect(screen.getByRole('list', { name: 'Unidades totales del día en Salta' }).textContent).toBe('0.75 kg X Menú histórico');
    await user.click(screen.getByRole('button', { name: 'Salta' }));
    expect(total().textContent).toBe('0.75 kg X Menú histórico');
    expect(screen.queryByRole('list', { name: 'Unidades totales del día en Centro' })).toBeNull();
  });
  it('keeps delivery independent from payment and collects only the historical remaining balance', async () => {
    state.data!.orders = [order()]; state.data!.financial_movements = [{ id: 'partial', kind: 'payment', order_id: 'pedido', purchase_id: null, amount: '30', method: 'efectivo', category: '', occurred_on: today(), notes: '', reconciled: false, version: 1, created_at: new Date().toISOString(), reverses_id: null }];
    state.command.mockImplementation(async (operation: string) => {
      if (operation === 'deliver_order') state.data = { ...state.data!, orders: [order({ status: 'entregado', delivered_at: new Date().toISOString(), version: 8 })] };
      if (operation === 'record_payment') state.data = { ...state.data!, orders: [order({ status: 'entregado', delivered_at: new Date().toISOString(), version: 9 })], financial_movements: [...state.data!.financial_movements!, { ...state.data!.financial_movements![0]!, id: 'balance-payment', amount: '70' }] };
      return { id: 'pedido', affected_order_ids: ['pedido'] };
    });
    const user = userEvent.setup(); render(<SalesScreen/>);
    await user.click(screen.getByRole('button', { name: /Ana Pérez/ }));
    await user.click(screen.getByRole('button', { name: 'Entregar pedido' }));
    await user.click(within(dialog()).getByRole('button', { name: 'ENTREGADO PERO FALTA PAGAR' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Entregar · falta pagar' }));
    await waitFor(() => expect(state.command).toHaveBeenCalledWith('deliver_order', { id: 'pedido', payment_status: 'no_pagado', transfer_name: null }, 7));
    await user.click(screen.getByRole('button', { name: /Cobrar saldo completo ·/ }));
    await user.click(within(dialog()).getByRole('button', { name: 'Registrar cobro' }));
    expect(screen.getByText('¿Estás seguro que deseas cambiar el método de pago ya seleccionado?')).toBeTruthy();
    expect(state.command).toHaveBeenCalledTimes(1);
    await user.click(within(dialog()).getByRole('button', { name: 'Sí' }));
    await waitFor(() => expect(state.command).toHaveBeenLastCalledWith('record_payment', { order_id: 'pedido', amount: '70.00', method: 'transferencia', occurred_on: today(), notes: '', transfer_name: null }, 8));
    expect(within(screen.getByRole('button', { name: /Ana Pérez/ })).getByText('Pagado')).toBeTruthy();
  });
  it('creates a real multi-product first-purchase order with normalized commercial quantities and explicit gift flags', async () => {
    const user = userEvent.setup(); render(<SalesScreen/>); await user.click(screen.getByRole('button', { name: 'Nuevo pedido' }));
    await user.selectOptions(within(dialog()).getByLabelText('Cliente'), 'ana');
    await user.click(within(dialog()).getByRole('button', { name: 'Menú natural' }));
    await user.clear(within(dialog()).getByLabelText('Cantidad de Menú natural (kg)')); await user.type(within(dialog()).getByLabelText('Cantidad de Menú natural (kg)'), '1,5');
    await user.click(within(dialog()).getByRole('button', { name: 'Bolsa reutilizable' })); await user.click(within(dialog()).getByLabelText('Bolsa gratis · primera compra'));
    await user.click(within(dialog()).getByRole('button', { name: 'Guardar pedido' }));
    await waitFor(() => expect(state.command).toHaveBeenCalledWith('save_order', expect.objectContaining({ client_id: 'ana', payment_status: 'no_pagado', lines: [{ product_id: 'comida', quantity: '1.5', is_gift: false }, { product_id: 'bolsa', quantity: '1', is_gift: true }] }), undefined));
  });
  it('requires explicit shortage confirmation after server rejection and retains the draft', async () => {
    state.command.mockRejectedValueOnce(new Error('STOCK_CONFIRMATION_REQUIRED')).mockResolvedValue({ id: 'new-order', affected_order_ids: [] });
    const user = userEvent.setup(); render(<SalesScreen/>); await user.click(screen.getByRole('button', { name: 'Nuevo pedido' })); await user.selectOptions(within(dialog()).getByLabelText('Cliente'), 'ana'); await user.click(within(dialog()).getByRole('button', { name: 'Menú natural' })); await user.click(within(dialog()).getByRole('button', { name: 'Guardar pedido' }));
    await user.click(await screen.findByRole('button', { name: 'Agendar con faltantes' }));
    await waitFor(() => expect(state.command).toHaveBeenLastCalledWith('save_order', expect.objectContaining({ allow_stock_shortage: true, client_id: 'ana', lines: [{ product_id: 'comida', quantity: '1', is_gift: false }] }), undefined));
    expect(state.command).toHaveBeenCalledTimes(2);
  });
  it('edits delivered quantities at historical prices without marking existing collections as a new payment', async () => {
    state.data!.orders = [order({ status: 'entregado', delivered_at: new Date().toISOString() })];
    state.data!.financial_movements = [{ id: 'paid', kind: 'payment', order_id: 'pedido', purchase_id: null, amount: '100', method: 'efectivo', category: '', occurred_on: today(), notes: '', reconciled: false, version: 1, created_at: new Date().toISOString(), reverses_id: null }];
    const user = userEvent.setup(); render(<SalesScreen/>); await user.click(screen.getByRole('button', { name: /Ana Pérez/ })); await user.click(screen.getByRole('button', { name: 'Editar entregado' }));
    const input = within(dialog()).getByLabelText('Cantidad de Menú histórico (kg)'); await user.clear(input); await user.type(input, '2,5');
    expect(within(dialog()).getAllByText(/\$ 250,00/).length).toBeGreaterThan(0);
    await user.click(within(dialog()).getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(state.command).toHaveBeenCalledWith('save_order', expect.objectContaining({ id: 'pedido', lines: [{ product_id: 'comida', quantity: '2.5', is_gift: false }] }), 7));
    expect(state.command.mock.calls[0]?.[1]).not.toHaveProperty('payment_status');
  });
  it('appends a spontaneous sale atomically to an existing pending order and retains payment metadata', async () => {
    state.data!.orders = [order()]; const user = userEvent.setup(); render(<SalesScreen/>); await user.click(screen.getByRole('button', { name: 'Venta espontánea' }));
    await user.selectOptions(within(dialog()).getByLabelText('Cliente (opcional)'), 'ana'); await user.selectOptions(within(dialog()).getByLabelText('Cómo registrar la venta'), 'pedido'); await user.click(within(dialog()).getByRole('button', { name: 'Menú natural' }));
    await user.selectOptions(within(dialog()).getByLabelText('Estado de pago'), 'pagado'); await user.selectOptions(within(dialog()).getByLabelText('Cómo se recibió el pago'), 'transferencia'); await user.type(within(dialog()).getByLabelText('Nombre de quien transfiere (opcional)'), 'María Pérez'); await user.click(within(dialog()).getByRole('button', { name: 'Registrar y entregar' }));
    await waitFor(() => expect(state.command).toHaveBeenCalledWith('append_spontaneous_sale', { id: 'pedido', lines: [{ product_id: 'comida', quantity: '1', is_gift: false }], payment_status: 'pagado', method: 'transferencia', transfer_name: 'María Pérez', deliver: true }, 7));
  });
  it.each([['future', 35], ['past', -35]] as const)('keeps an appended %s order visible on its original pickup day after the server snapshot updates', async (_label, offset) => {
    const pickupDate = shiftCalendarDate(today(), offset, 'day');
    const original = order({ pickup_date: pickupDate });
    state.data!.orders = [original];
    state.command.mockImplementation(async () => {
      // Real append response: delivery is today, but the operational pickup
      // cohort remains the existing order's date (not the spontaneous date).
      state.data = { ...state.data!, orders: [{ ...original, status: 'entregado', delivered_at: new Date().toISOString(), version: 8, total: '200', lines: [{ ...original.lines[0]!, quantity: '2', reserved: '0' }] }] };
      return { id: 'pedido', affected_order_ids: ['pedido'] };
    });
    const user = userEvent.setup(); render(<SalesScreen/>);
    expect(screen.queryByRole('button', { name: /Ana Pérez/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Venta espontánea' }));
    await user.selectOptions(within(dialog()).getByLabelText('Cliente (opcional)'), 'ana');
    await user.selectOptions(within(dialog()).getByLabelText('Cómo registrar la venta'), 'pedido');
    await user.click(within(dialog()).getByRole('button', { name: 'Menú natural' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Registrar y entregar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('heading', { name: formatDate(pickupDate), level: 2 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: monthLabel(pickupDate.slice(0, 7)), level: 3 })).toBeTruthy();
    const visibleOrder = screen.getByRole('button', { name: /Ana Pérez/ });
    expect(within(visibleOrder).getByText('Entregado')).toBeTruthy();
    expect(within(visibleOrder).getByText('2 kg X Menú histórico')).toBeTruthy();
    expect(within(visibleOrder).getByText('$ 200,00')).toBeTruthy();
    expect(state.command).toHaveBeenCalledWith('append_spontaneous_sale', expect.objectContaining({ id: 'pedido', deliver: true }), 7);
  });
  it('ignores invalid day input and safely renders/navigates four-digit year boundaries', async () => {
    const user = userEvent.setup(); render(<SalesScreen/>);
    await user.click(screen.getByRole('button', { name: 'Día' }));
    const input = screen.getByLabelText('Día de retiro') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe(today());
    fireEvent.change(input, { target: { value: '2026-02-30' } });
    expect(input.value).toBe(today());
    expect(isValidDate('0000-01-01')).toBe(true);
    for (const [date, direction] of [['9999-12-31', 'Período siguiente']] as const) {
      fireEvent.change(screen.getByLabelText('Día de retiro'), { target: { value: date } });
      expect((screen.getByLabelText('Día de retiro') as HTMLInputElement).value).toBe(date);
      await user.click(screen.getByRole('button', { name: direction }));
      expect((screen.getByLabelText('Día de retiro') as HTMLInputElement).value).toBe(date);
      await user.click(screen.getByRole('button', { name: 'Mes' }));
      expect(screen.getByRole('heading', { name: monthLabel(date.slice(0, 7)), level: 3 })).toBeTruthy();
      await user.click(screen.getByRole('button', { name: direction }));
      expect(screen.getByRole('heading', { name: monthLabel(date.slice(0, 7)), level: 3 })).toBeTruthy();
      await user.click(screen.getByRole('button', { name: 'Semana' }));
      expect(screen.getByRole('heading', { name: formatDate(date), level: 2 })).toBeTruthy();
      await user.click(screen.getByRole('button', { name: 'Día' }));
    }
  });
  it('safely reveals API-valid year-zero orders whose calendar weeks cross the supported year range', async () => {
    // Native HTML date inputs disallow year zero, but ISO/API date validation
    // accepts it and existing server data can still be revealed from the ledger.
    state.data!.orders = [order({ pickup_date: '0000-01-01', status: 'entregado' })];
    const user = userEvent.setup(); render(<SalesScreen/>);
    await user.click(screen.getByRole('button', { name: '1 pedidos' }));
    await user.click(screen.getByRole('button', { name: /Ana Pérez/ }));
    expect(screen.getByRole('heading', { name: formatDate('0000-01-01'), level: 2 })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Período anterior' }));
    expect(screen.getByRole('heading', { name: monthLabel('0000-01'), level: 3 })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Semana' }));
    expect(screen.getByRole('heading', { name: formatDate('0000-01-01'), level: 2 })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Período anterior' }));
    expect(screen.getByRole('heading', { name: formatDate('0000-01-01'), level: 2 })).toBeTruthy();
  });
  it('blocks writes while offline, without fabricating data or orders', () => {
    state.isOnline = false; render(<SalesScreen/>); expect((screen.getByRole('button', { name: 'Nuevo pedido' }) as HTMLButtonElement).disabled).toBe(true); expect((screen.getByRole('button', { name: 'Venta espontánea' }) as HTMLButtonElement).disabled).toBe(true); expect(state.command).not.toHaveBeenCalled();
  });
  it('does not announce initial or rescheduled historical orders as newly created today', () => {
    state.data!.orders = [order()]; const view = render(<SalesScreen/>); expect(screen.queryByText('Nuevos pedidos de hoy')).toBeNull();
    state.data = { ...state.data!, orders: [order(), order({ id: 'historical', created_at: '2025-01-01T12:00:00Z' })] }; view.rerender(<SalesScreen/>); expect(screen.queryByText('Nuevos pedidos de hoy')).toBeNull();
    state.data = { ...state.data!, orders: [...state.data!.orders, order({ id: 'actual-new' })] }; view.rerender(<SalesScreen/>); expect(screen.getByText('Nuevos pedidos de hoy')).toBeTruthy();
  });
});


describe('compact order actions and new order shortcuts', () => {
  it('exposes delivery and collection without expanding details and confirms existing method changes with Sí/No', async () => {
    state.data!.orders = [order()];
    const user = userEvent.setup(); render(<SalesScreen/>);
    expect(screen.getByRole('button', { name: 'Entregar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Entregar sin pagar' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Marcar pagado' }));
    expect((within(dialog()).getByLabelText('Medio de pago') as HTMLSelectElement).value).toBe('transferencia');
    await user.click(within(dialog()).getByRole('button', { name: 'Registrar cobro' }));
    expect(state.command).not.toHaveBeenCalled();
    await user.click(within(dialog()).getByRole('button', { name: 'No' }));
    expect((within(dialog()).getByLabelText('Medio de pago') as HTMLSelectElement).value).toBe('transferencia');
    expect(state.command).not.toHaveBeenCalled();
    await user.click(within(dialog()).getByRole('button', { name: 'Registrar cobro' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Sí' }));
    await waitFor(() => expect(state.command).toHaveBeenCalledWith('record_payment', expect.objectContaining({ method: 'transferencia', amount: '100.00' }), 7));
  });
  it('defaults to preferred point then Mendieta, and repeats only latest noncancelled order quantities and pickup point', async () => {
    state.data!.locations.push({ id: 'mendieta', name: 'Mendieta', color: '#335577', active: true, is_pickup: true });
    state.data!.clients[0]!.preferred_location_id = 'punto';
    state.data!.orders = [order({ id: 'old', pickup_date: '2026-12-20', created_at: '2026-10-01T12:00:00Z' }), order({ id: 'latest', status: 'entregado', location_id: 'mendieta', created_at: '2026-10-29T12:00:00Z', lines: [{ ...order().lines[0]!, quantity: '2.500000' }] }), order({ id: 'cancelled', status: 'cancelado', created_at: '2026-10-30T12:00:00Z', lines: [{ ...order().lines[0]!, quantity: '99' }] })];
    const user = userEvent.setup(); render(<SalesScreen/>);
    await user.click(screen.getByRole('button', { name: 'Nuevo pedido' }));
    expect((within(dialog()).getByLabelText('Punto de retiro') as HTMLSelectElement).value).toBe('mendieta');
    await user.selectOptions(within(dialog()).getByLabelText('Cliente'), 'ana');
    expect((within(dialog()).getByLabelText('Punto de retiro') as HTMLSelectElement).value).toBe('punto');
    await user.click(within(dialog()).getByRole('button', { name: 'Repetir último pedido' }));
    expect((within(dialog()).getByLabelText('Punto de retiro') as HTMLSelectElement).value).toBe('mendieta');
    const quantity = within(dialog()).getByLabelText('Cantidad de Menú natural (kg)') as HTMLInputElement;
    expect(quantity.value).toBe('2.5');
    await user.clear(quantity); await user.type(quantity, '3');
    await user.selectOptions(within(dialog()).getByLabelText('Punto de retiro'), 'punto');
    await user.click(within(dialog()).getByRole('button', { name: 'Guardar pedido' }));
    await waitFor(() => expect(state.command).toHaveBeenCalledWith('save_order', expect.objectContaining({ location_id: 'punto', payment_method: 'transferencia', lines: [{ product_id: 'comida', quantity: '3', is_gift: false }] }), undefined));
  });
  it('opens full client registration inside new order flow and preserves the basket on return', async () => {
    const user = userEvent.setup(); render(<SalesScreen/>);
    await user.click(screen.getByRole('button', { name: 'Nuevo pedido' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Menú natural' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Nuevo cliente · formulario completo' }));
    expect(within(dialog()).getByLabelText('Domicilio')).toBeTruthy();
    expect(within(dialog()).getByLabelText('Correo electrónico')).toBeTruthy();
    expect(within(dialog()).getByLabelText('Punto de retiro habitual')).toBeTruthy();
    expect(within(dialog()).getByRole('button', { name: 'Agregar mascota' })).toBeTruthy();
    await user.click(within(dialog()).getByRole('button', { name: 'Cerrar formulario' }));
    expect((within(dialog()).getByLabelText('Cantidad de Menú natural (kg)') as HTMLInputElement).value).toBe('1');
  });
  it('shows overdue pickups with reschedule and cancel independently from the selected day', () => {
    state.data!.orders = [order({ id: 'overdue', pickup_date: shiftCalendarDate(today(), -1, 'day') })];
    render(<SalesScreen/>);
    const heading = screen.getByRole('heading', { name: 'Pedidos no retirados · 1' });
    const panel = heading.closest('section')!;
    expect(within(panel).getByRole('button', { name: 'Cambiar día de retiro' })).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Cancelar pedido' })).toBeTruthy();
  });
});
