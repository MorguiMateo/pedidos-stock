import { describe, expect, it } from 'vitest';
import { breakEven, consumptionForecast, financeHistory, financeMonth, monthDays, parseBreakEvenDrafts, shiftMonth } from './financeAnalytics';
import type { Order, Snapshot } from './types';

const fixture = (): Snapshot => ({ locations: [{ id: 'a', name: 'Centro', color: '#111111', is_pickup: true }, { id: 'b', name: 'Norte', color: '#222222', is_pickup: true }], items: [], clients: [], recipes: [], orders: [], purchases: [], productions: [], stock: [], movements: [], updated_at: '2026-10-30T12:00:00Z' });
const order = (patch: Partial<Order> = {}): Order => ({ id: 'o', client_id: 'ana', location_id: 'a', pickup_date: '2026-09-10', payment_method: 'efectivo', status: 'entregado', notes: '', total: '10.00', version: 1, allocation_version: 0, created_at: '2026-09-01T12:00:00Z', delivered_at: '2026-09-10T12:00:00Z', lines: [{ id: 'line', product_id: 'p', product_name: 'Pollo histórico', product_unit: 'kg', quantity: '2.5', unit_price: '4', reserved: 0, shortage: 0 }], ...patch });

describe('Monthly finance analytics', () => {
  it('deduplicates clients globally and at each point, excluding anonymous/cancelled/returned orders', () => {
    const data = fixture();
    data.orders = [order(), order({ id: 'repeat' }), order({ id: 'other-point', location_id: 'b' }), order({ id: 'pending', client_id: 'bea', status: 'pendiente_entrega' }), order({ id: 'anonymous', client_id: null }), order({ id: 'cancelled', client_id: 'cancelled', status: 'cancelado' }), order({ id: 'returned', client_id: 'returned', returned_at: '2026-09-11' })];
    const report = financeMonth(data, '2026-09');
    expect(report).toMatchObject({ orders: 5, clients: 2, deliveredClients: 1, sales: 4, revenue: '40.00', averageTicket: '10.00' });
    expect(report.points.map(point => [point.id, point.clients, point.orders])).toEqual([['a', 2, 4], ['b', 1, 1]]);
    expect(financeMonth(data, '2026-09', 'b')).toMatchObject({ orders: 1, clients: 1 });
    expect(report.days.find(day => day.date === '2026-09-10')).toMatchObject({ count: 5, points: [{ id: 'a', count: 4 }, { id: 'b', count: 1 }] });
  });
  it('keeps sold units delivered-only, gifts separate, billed revenue reconciled and units/points separate', () => {
    const data = fixture();
    data.orders = [order({ total: '0.03', lines: [
      { id: 'paid', product_id: 'p', product_name: 'Histórico', product_unit: 'kg', quantity: '.2', unit_price: '.1', reserved: 0, shortage: 0 },
      { id: 'gift', product_id: 'p', product_unit: 'kg', quantity: '.1', unit_price: '0', is_gift: true, reserved: 0, shortage: 0 },
    ] }), order({ id: 'pending', status: 'pendiente_entrega' }), order({ id: 'gratis', payment_method: 'gratis', total: '999' }), order({ id: 'units', location_id: 'b', lines: [{ id: 'u', product_id: 'p', product_unit: 'unidad', quantity: 1, unit_price: '10', reserved: 0, shortage: 0 }] })];
    const report = financeMonth(data, '2026-09');
    expect(report).toMatchObject({ revenue: '10.03', sales: 2, averageTicket: '5.02' });
    expect(report.products).toHaveLength(2);
    expect(report.products[0]).toMatchObject({ locationId: 'a', name: 'Histórico', unit: 'kg', sold: '0.2', gifts: '2.6', revenue: '0.03' });
    expect(report.products[1]).toMatchObject({ locationId: 'b', unit: 'unidad', sold: '1', gifts: '0', revenue: '10.00' });
  });
  it('uses exact pickup calendar boundaries across leap years and year changes, not delivery timestamps', () => {
    const data = fixture(); data.orders = [order({ pickup_date: '2026-12-31', delivered_at: '2027-01-01T00:00:00Z' }), order({ id: 'jan', pickup_date: '2027-01-01' }), order({ id: 'invalid', pickup_date: '2027-01-32' })];
    expect(financeMonth(data, '2026-12').orders).toBe(1);
    expect(financeMonth(data, '2027-01').orders).toBe(1);
    expect(monthDays('2028-02')).toHaveLength(29);
    expect(monthDays('2026-02')).toHaveLength(28);
    expect(monthDays('2026-13')).toEqual([]);
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(financeHistory(data, '2027-01').map(month => month.month)).toEqual(['2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01']);
    expect(financeMonth(fixture(), '2026-09').averageTicket).toBeNull();
  });
});
describe('Transparent consumption forecast', () => {
  it('averages completed calendar months, includes zero months, excludes current/future/pending/returned', () => {
    const data = fixture(); data.orders = [order({ pickup_date: '2026-07-31', lines: [{ ...order().lines[0]!, quantity: '3' }] }), order({ id: 'sep', lines: [{ ...order().lines[0]!, quantity: '6' }] }), order({ id: 'current', pickup_date: '2026-10-01', total: '99999' }), order({ id: 'future', pickup_date: '2027-01-01' }), order({ id: 'pending', pickup_date: '2026-08-01', status: 'pendiente_entrega' }), order({ id: 'return', pickup_date: '2026-08-01', returned_at: '2026-08-02' }), order({ id: 'other-point', location_id: 'b', pickup_date: '2026-08-01' })];
    const forecast = consumptionForecast(data, '2027-12', 'a', '2026-10-30');
    expect(forecast.months).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(forecast.forecastMonth).toBe('2026-10');
    expect(forecast.rows[0]).toMatchObject({ values: ['3', '0', '6'], forecast: '3' });
  });
  it('does not claim a forecast without three complete months of product/unit history', () => {
    const data = fixture(); data.orders = [order({ pickup_date: '2026-08-01' }), order({ id: 'unit', pickup_date: '2026-09-01', lines: [{ ...order().lines[0]!, product_unit: 'unidad' }] })];
    expect(consumptionForecast(data, '2026-09', 'all', '2026-10-30').rows.map(row => row.forecast)).toEqual([null, null]);
    expect(consumptionForecast(fixture(), '2026-09', 'all', '2026-10-30').rows).toEqual([]);
    expect(consumptionForecast(data, '2026-06', 'all', '2026-10-30').rows).toEqual([]);
  });
});
describe('Product break-even simulator', () => {
  it('calculates contribution, contribution margin and rounds units upward without binary-money error', () => {
    expect(breakEven({ fixed: '100', variable: '3', price: '10' })).toMatchObject({ contribution: '7.00', margin: '70.00', units: '15', exactUnits: '14.29', error: null });
    expect(breakEven({ fixed: '0,3', variable: '0,1', price: '0,2' }).units).toBe('3');
    expect(breakEven({ fixed: '0', variable: '0', price: '2' }).units).toBe('0');
    expect(breakEven({ fixed: '1', variable: '0', price: '3' }).exactUnits).toBe('0.34');
  });
  it('never manufactures a zero cost or finite break-even when costs are missing or contribution is nonpositive', () => {
    for (const fixed of ['', '-2', 'NaN', '1e20']) expect(breakEven({ fixed, variable: '1', price: '2' }).units).toBeNull();
    expect(breakEven({ fixed: '10', variable: '', price: '2' }).units).toBeNull();
    expect(breakEven({ fixed: '10', variable: '2', price: '2' }).error).toContain('Sin punto de equilibrio');
    expect(breakEven({ fixed: '10', variable: '3', price: '2' })).toMatchObject({ contribution: '-1.00', margin: '-50.00', units: null });
    expect(breakEven({ fixed: '10', variable: '0', price: '0' }).units).toBeNull();
  });
  it('recovers local calculator scenarios without accepting malformed or oversized storage', () => {
    expect(parseBreakEvenDrafts('{invalid')).toEqual({});
    expect(parseBreakEvenDrafts('[]')).toEqual({});
    expect(parseBreakEvenDrafts(JSON.stringify({ p: { fixed: '1', variable: '2', price: '4' }, broken: { fixed: 0 }, long: { fixed: '1'.repeat(41), variable: '', price: '' } }))).toEqual({ p: { fixed: '1', variable: '2', price: '4' } });
  });
});
