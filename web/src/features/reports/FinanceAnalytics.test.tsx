import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Order, Snapshot } from '@shared/lib/types';
import { formatDate } from '@shared/lib/format';
import FinanceAnalytics from './FinanceAnalytics';

const order = (patch: Partial<Order> = {}): Order => ({ id: 'sale', client_id: 'ana', location_id: 'a', pickup_date: '2026-01-05', payment_method: 'efectivo', status: 'entregado', notes: '', total: '100', version: 1, allocation_version: 0, created_at: '2026-01-01T12:00:00Z', delivered_at: '2026-01-05T12:00:00Z', lines: [{ id: 'line', product_id: 'p', product_name: 'Nombre histórico', product_unit: 'unidad', quantity: '2', unit_price: '50', reserved: 0, shortage: 0 }], ...patch });
const fixture = (): Snapshot => ({ profile: { id: 'admin', role: 'admin', location_id: null, display_name: 'Admin' }, locations: [{ id: 'a', name: 'Centro', color: '#112233', is_pickup: true }, { id: 'b', name: 'Norte', color: '#445566', is_pickup: true }], items: [{ id: 'p', kind: 'product', name: 'Pollo', unit: 'unidad', price: '10', minimum: '0', active: true, version: 1 }, { id: 'p2', kind: 'product', name: 'Carne', unit: 'kg', price: '20', minimum: '0', active: true, version: 1 }], clients: [], recipes: [], orders: [order(), order({ id: 'repeat' }), order({ id: 'other-point', location_id: 'b' }), order({ id: 'pending', status: 'pendiente_entrega' }), order({ id: 'anonymous', client_id: null })], purchases: [], productions: [], stock: [], movements: [], updated_at: '2026-10-30T12:00:00Z' });
function section(title: string) { return screen.getByRole('heading', { name: title }).closest('section')!; }
beforeEach(() => { const values = new Map<string, string>(); vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Finance analytics panels', () => {
  it('selects calendar days and scopes delivered product/client/ticket tables to the chosen point', () => {
    const data = fixture(); const view = render(<FinanceAnalytics data={data} month="2026-01" location="all" />);
    const calendar = within(section('Calendario financiero de pedidos'));
    fireEvent.click(calendar.getByRole('button', { name: /: 5 pedidos$/ }));
    expect(calendar.getByRole('heading', { name: /5 pedidos/ })).toBeTruthy();
    const sold = within(section('Productos vendidos por punto y mes'));
    expect(sold.getByRole('cell', { name: '6 unidad' })).toBeTruthy();
    expect(sold.getByRole('cell', { name: '2 unidad' })).toBeTruthy();
    expect(within(section('Clientes y ticket por punto')).getByText('Total único del mes: 1.', { exact: false })).toBeTruthy();
    view.rerender(<FinanceAnalytics data={data} month="2026-01" location="b" />);
    expect(within(section('Productos vendidos por punto y mes')).queryByRole('cell', { name: 'Centro' })).toBeNull();
    expect(screen.getByText('Ticket promedio mensual').parentElement!.textContent).toContain('$ 100,00');
    fireEvent.click(within(section('Calendario financiero de pedidos')).getByRole('button', { name: `${formatDate('2026-01-06')}: 0 pedidos` }));
    expect(screen.getByText('Sin pedidos válidos en este día.')).toBeTruthy();
  });
  it('changes the month-over-month chart metric with readable exact values', () => {
    render(<FinanceAnalytics data={fixture()} month="2026-01" location="all" />);
    fireEvent.change(screen.getByLabelText('Métrica a comparar'), { target: { value: 'clients' } });
    const comparison = within(section('Comparación mes a mes'));
    expect(comparison.getByRole('img', { name: 'Comparación mensual de Clientes únicos con pedido' }).textContent).toContain('enero de 2026');
    expect(comparison.getByText('1')).toBeTruthy();
  });
  it('persists separate break-even scenarios per product and does not fill in missing costs', () => {
    const data = fixture(); const view = render(<FinanceAnalytics data={data} month="2026-01" location="all" />);
    const panel = within(section('Punto de equilibrio por producto'));
    expect(panel.getAllByText('Completá costos y precio con números no negativos.')).toHaveLength(2);
    fireEvent.change(panel.getByLabelText('Costo fijo mensual asignado ($) · Pollo'), { target: { value: '100' } });
    fireEvent.change(panel.getByLabelText('Costo variable por unidad ($) · Pollo'), { target: { value: '3' } });
    expect(panel.getByText('Equilibrio: 15 unidad / mes')).toBeTruthy();
    fireEvent.change(panel.getByLabelText('Costo fijo mensual asignado ($) · Carne'), { target: { value: '60' } });
    fireEvent.change(panel.getByLabelText('Costo variable por kg ($) · Carne'), { target: { value: '8' } });
    expect(panel.getByText('Equilibrio: 5.00 kg / mes')).toBeTruthy();
    view.unmount();
    render(<FinanceAnalytics data={data} month="2026-01" location="all" />);
    expect((screen.getByLabelText('Costo fijo mensual asignado ($) · Pollo') as HTMLInputElement).value).toBe('100');
    expect((screen.getByLabelText('Costo fijo mensual asignado ($) · Carne') as HTMLInputElement).value).toBe('60');
  });
  it('shows insufficient history instead of inventing a forecast for a new product', () => {
    render(<FinanceAnalytics data={fixture()} month="2026-01" location="all" />);
    expect(within(section('Pronóstico de consumo')).getByText(/Historial insuficiente/)).toBeTruthy();
    expect(within(section('Pronóstico de consumo')).getByText('Sin datos')).toBeTruthy();
  });
});
