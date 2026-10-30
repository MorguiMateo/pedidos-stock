import { describe, it, expect } from 'vitest';
import { cashCollectionsReport, monthlyReport, reportWorksheets } from './reports';
import { formatDate, isValidDate, money, sumMoney } from './format';
import type { FinancialMovement, Order, Snapshot } from './types';
const empty = (): Snapshot => ({ locations: [], clients: [], items: [], recipes: [], orders: [], purchases: [], productions: [], stock: [], movements: [], updated_at: '2026-10-22T12:00:00Z' });
const order = (patch: Partial<Order> = {}): Order => ({ id: 'order-1', client_id: 'client-1', pickup_date: '2026-11-03', location_id: 'mendieta', payment_method: 'desconocido', status: 'pendiente_entrega', notes: '', total: '0.30', version: 1, allocation_version: 0, created_at: '2026-10-22T12:00:00Z', delivered_at: null, lines: [{ id: 'line-1', product_id: 'product-1', quantity: 3, unit_price: '0.10', reserved: 0, shortage: 3 }], ...patch });

describe('Cobros reales en efectivo por rango y punto', () => {
  const receipt = (patch: Partial<FinancialMovement> = {}): FinancialMovement => ({ id: 'receipt', kind: 'payment', order_id: 'order-1', purchase_id: null, amount: '0.10', method: 'efectivo', category: '', occurred_on: '2026-11-01', notes: '', reconciled: false, version: 1, created_at: '2026-11-01T12:00:00Z', reverses_id: null, ...patch });
  it('usa fechas inclusivas de movimiento, no retiro, método previsto, confirmación ni total del pedido', () => {
    const data = empty();
    data.orders = [order({ payment_method: 'transferencia', pickup_date: '2027-01-01', total: '999' }), order({ id: 'unpaid', payment_method: 'efectivo', payment_confirmed_at: '2026-11-01T12:00:00Z', total: '999' })];
    data.financial_movements = [receipt({ id: 'before', occurred_on: '2026-10-31' }), receipt({ id: 'start' }), receipt({ id: 'end', occurred_on: '2026-11-30', amount: '.20' }), receipt({ id: 'after', occurred_on: '2026-12-01' }), receipt({ id: 'transfer', method: 'transferencia', amount: '300' }), receipt({ id: 'unknown', method: 'desconocido', amount: '400' }), receipt({ id: 'expense', kind: 'expense', order_id: null, amount: '-800' }), receipt({ id: 'expense-reversal', kind: 'reversal', order_id: null, amount: '800', reverses_id: 'expense' })];
    const report = cashCollectionsReport(data, '2026-11-01', '2026-11-30');
    expect(report.entries.map(entry => entry.id)).toEqual(['start', 'end']);
    expect(report).toMatchObject({ received: '0.30', refunds: '0.00', net: '0.30' });
    expect(cashCollectionsReport(data, '2026-11-30', '2026-11-30').net).toBe('0.20');
    expect(cashCollectionsReport(data, '2026-12-01', '2026-11-01').entries).toEqual([]);
    expect(cashCollectionsReport(data, '2026-02-30', '2026-11-01').entries).toEqual([]);
    expect(cashCollectionsReport({ ...data, financial_movements: undefined }, '2026-11-01', '2026-11-30').net).toBe('0.00');
  });
  it('conserva cobros de cancelados y devueltos y netea reintegros, reversión de cobros y de reintegros', () => {
    const data = empty();
    data.orders = [order({ status: 'cancelado' }), order({ id: 'returned', status: 'entregado', returned_at: '2026-11-02' })];
    data.financial_movements = [receipt(), receipt({ id: 'refund', kind: 'refund', amount: '-.03' }), receipt({ id: 'undo-refund', kind: 'reversal', amount: '.03', reverses_id: 'refund' }), receipt({ id: 'undo-payment', kind: 'reversal', amount: '-.10', reverses_id: 'receipt' }), receipt({ id: 'returned-payment', order_id: 'returned', amount: '.20' }), receipt({ id: 'returned-refund', order_id: 'returned', kind: 'refund', amount: '-.05' })];
    expect(cashCollectionsReport(data, '2026-11-01', '2026-11-30')).toMatchObject({ received: '0.33', refunds: '0.18', net: '0.15' });
    expect(cashCollectionsReport(data, '2026-11-01', '2026-11-30').entries).toHaveLength(6);
  });
  it('atribuye puntos históricos, hereda punto de reversión y muestra no atribuidos sin mezclarlos con un punto', () => {
    const data = empty();
    data.locations = [{ id: 'mendieta', name: 'Centro', color: '#112233', is_pickup: true }, { id: 'salta', name: 'Norte', color: '#445566', is_pickup: true, active: false }];
    data.orders = [order({ location_id: 'salta' })];
    data.financial_movements = [receipt({ id: 'historical', location_id: 'mendieta', amount: '.10' }), receipt({ id: 'deleted', order_id: 'deleted-order', location_id: 'salta', amount: '.20', occurred_on: '2026-10-31' }), receipt({ id: 'reverse-deleted', order_id: 'deleted-order', kind: 'reversal', amount: '-.20', reverses_id: 'deleted' }), receipt({ id: 'unknown', order_id: 'missing-order', amount: '.30' })];
    const report = cashCollectionsReport(data, '2026-11-01', '2026-11-01');
    expect(report.entries.find(entry => entry.id === 'historical')).toMatchObject({ location_name: 'Centro', location_id: 'mendieta', client: 'client-1' });
    expect(report.byLocation).toMatchObject([{ id: 'mendieta', name: 'Centro', net: '0.10' }, { id: 'salta', name: 'Norte', net: '-0.20' }, { id: null, name: 'Sin punto atribuido', net: '0.30' }]);
    expect(cashCollectionsReport(data, '2026-11-01', '2026-11-01', 'salta')).toMatchObject({ net: '-0.20', received: '0.00', refunds: '0.20' });
    expect(cashCollectionsReport(data, '2026-11-01', '2026-11-01', 'mendieta').entries.map(entry => entry.id)).toEqual(['historical']);
  });
  it('exporta el rango y punto de efectivo seleccionados sin atarlos al mes ni filtros operativos', () => {
    const data = empty(); data.orders = [order()];
    data.financial_movements = [receipt({ occurred_on: '2026-12-31' }), receipt({ id: 'outside', occurred_on: '2026-11-01', amount: '99' })];
    const filters = { from: '2026-11-01', to: '2026-11-30', location: 'other-point', product: 'all', client: 'all', status: 'all' };
    const sheets = reportWorksheets(data, '2026-11', filters, 30, '2026-11-02', { from: '2026-12-31', to: '2026-12-31', location: 'mendieta' });
    expect(sheets.find(sheet => sheet.name === 'Efectivo resumen')?.rows).toContainEqual(['Desde (fecha de movimiento)', '2026-12-31']);
    expect(sheets.find(sheet => sheet.name === 'Efectivo por punto')?.rows.at(-1)).toEqual(['TOTAL', 1, { number: '0.10' }, { number: '0.00' }, { number: '0.10' }]);
    expect(sheets.find(sheet => sheet.name === 'Efectivo detalle')?.rows[1]).toEqual(['2026-12-31', 'mendieta', 'order-1', 'client-1', 'payment', { number: '0.10' }, null, '']);
    expect(reportWorksheets(data, '2026-11', { ...filters, location: 'all' }, 30).find(sheet => sheet.name === 'Efectivo detalle')?.rows).toHaveLength(2);
  });
  it('atribuye la reversión sin punto al recibo histórico aunque el pedido se haya mudado de punto', () => {
    const data = empty(); data.orders = [order({ location_id: 'new-point' })];
    data.financial_movements = [receipt({ location_id: 'old-point', occurred_on: '2026-10-31' }), receipt({ id: 'reverse', kind: 'reversal', amount: '-.10', reverses_id: 'receipt' })];
    const report = cashCollectionsReport(data, '2026-11-01', '2026-11-01', 'old-point');
    expect(report).toMatchObject({ net: '-0.10', refunds: '0.10' });
    expect(report.entries[0]).toMatchObject({ id: 'reverse', location_id: 'old-point' });
    expect(cashCollectionsReport(data, '2026-11-01', '2026-11-01', 'new-point').entries).toEqual([]);
  });
});
describe('Informes por fecha de retiro', () => {
  it('mantiene noviembre aunque se encargue en octubre y entregue en diciembre', () => { const data = empty(); data.orders = [order({ status: 'entregado', delivered_at: '2026-12-01T12:00:00Z' })]; expect(monthlyReport(data, '2026-10').total).toBe('0.00'); expect(monthlyReport(data, '2026-11').delivered).toBe('0.30'); expect(monthlyReport(data, '2026-12').count).toBe(0); });
  it('separa cancelados, pendientes y entregados y consolida los tres puntos', () => { const data = empty(); data.orders = [order(), order({ id: '2', location_id: 'salta', status: 'entregado' }), order({ id: '3', location_id: 'carrodilla', status: 'cancelado' })]; const report = monthlyReport(data, '2026-11'); expect(report.total).toBe('0.60'); expect(report.pending).toBe('0.30'); expect(report.delivered).toBe('0.30'); expect(report.cancelled).toBe('0.30'); expect(report.products[0]?.units).toBe(6); expect(monthlyReport(data, '2026-11', 'salta').count).toBe(1); });
  it('usa el precio histórico aunque se cambie el catálogo', () => { const data = empty(); data.orders = [order()]; data.items = [{ id: 'product-1', kind: 'product', name: 'Producto', unit: 'unidad', price: '5000.00', minimum: '0', active: true, version: 2 }]; expect(monthlyReport(data, '2026-11').products[0]?.total).toBe('0.30'); });
  it('clasifica compras por fecha local de recepción y no por fecha planificada', () => { const data = empty(); data.purchases = [{ id: 'purchase-1', supplier: '', expected_date: '2026-09-10', received_at: '2026-11-01T01:30:00Z', status: 'recibida', notes: '', total: '1250.55', version: 2, lines: [] }]; expect(monthlyReport(data, '2026-10').purchaseTotal).toBe('1250.55'); expect(monthlyReport(data, '2026-11').purchaseTotal).toBe('0.00'); });
});
describe('Precisión monetaria y fechas', () => {
  it('muestra la última actualización en Mendoza cuando UTC ya cambió de día', () => { expect(formatDate('2026-10-23T01:35:00Z')).toBe(formatDate('2026-10-22')); expect(formatDate('2026-10-23T01:35:00Z')).not.toBe(formatDate('2026-10-23')); });
  it('suma sin errores binarios y conserva importes grandes al mostrarlos', () => { expect(sumMoney([{ quantity: 3, unit_price: '.10' }, { quantity: 1, unit_price: '.20' }])).toBe('0.50'); expect(money('9007199254740993.01')).toBe('$ 9.007.199.254.740.993,01'); });
  it('rechaza fechas inexistentes y respeta años bisiestos', () => { expect(isValidDate('2026-02-30')).toBe(false); expect(isValidDate('2028-02-29')).toBe(true); expect(isValidDate('22/10/2026')).toBe(false); });
});

describe('Finanzas separadas de las entregas', () => {
  it('conserva por punto recibos históricos y la reversión posterior aunque el pedido esté eliminado', () => {
    const data = empty();
    const base = { purchase_id: null, method: 'efectivo' as const, category: '', notes: '', reconciled: false, version: 1, created_at: '', reverses_id: null };
    data.financial_movements = [
      { ...base, id: 'receipt', kind: 'payment', order_id: 'deleted-order', location_id: 'mendieta', amount: '20.50', occurred_on: '2026-11-30' },
      { ...base, id: 'deletion-reversal', kind: 'reversal', order_id: 'deleted-order', location_id: 'mendieta', amount: '-20.50', occurred_on: '2026-12-01', reverses_id: 'receipt' },
      { ...base, id: 'other-point', kind: 'payment', order_id: 'another-deleted-order', location_id: 'salta', amount: '999.00', occurred_on: '2026-11-30' },
    ];
    expect(monthlyReport(data, '2026-11', 'mendieta')).toMatchObject({ collections: '20.50', cashNet: '20.50', total: '0.00', receivables: [] });
    expect(monthlyReport(data, '2026-12', 'mendieta')).toMatchObject({ collections: '-20.50', cashNet: '-20.50', total: '0.00', receivables: [] });
    expect(monthlyReport(data, '2026-11', 'salta').collections).toBe('999.00');
    expect(monthlyReport(data, '2026-11', 'mendieta').movements.map(entry => entry.id)).toEqual(['receipt']);
    expect(monthlyReport(data, '2026-12', 'mendieta').movements.map(entry => entry.id)).toEqual(['deletion-reversal']);
  });

  it('mantiene visible un reintegro pendiente de un pedido devuelto', () => {
    const data = empty(); data.orders = [order({ status: 'entregado', returned_at: '2026-11-04T12:00:00Z' })];
    data.financial_movements = [{ id: 'p', kind: 'payment', order_id: 'order-1', purchase_id: null, amount: '0.30', method: 'efectivo', category: '', occurred_on: '2026-11-01', notes: '', reconciled: false, version: 1, created_at: '2026-11-01T12:00:00Z', reverses_id: null }];
    expect(monthlyReport(data, '2026-11').receivables[0]).toMatchObject({ pending: '0.00', credit: '0.30' });
  });
  it('separa deuda a proveedores del egreso efectivo y permite revertir pagos', () => {
    const data = empty(); data.purchases = [{ id: 'purchase', supplier: 'Proveedor', expected_date: '2026-01-01', received_at: '2026-01-01T12:00:00Z', status: 'recibida', total: '100.25', notes: '', version: 2, lines: [] }];
    data.financial_movements = [{ id: 'p', kind: 'expense', order_id: null, purchase_id: 'purchase', amount: '-40.10', method: 'efectivo', category: '', occurred_on: '2026-11-01', notes: '', reconciled: false, version: 1, created_at: '2026-11-01T12:00:00Z', reverses_id: null }];
    expect(monthlyReport(data, '2026-11').payableTotal).toBe('60.15');
    data.financial_movements.push({ ...data.financial_movements[0]!, id: 'r', kind: 'reversal', reverses_id: 'p', amount: '40.10' });
    expect(monthlyReport(data, '2026-11').payableTotal).toBe('100.25');
    expect(monthlyReport(data, '2026-11').expenses).toBe('0.00');
  });
  it('no considera un pedido entregado como cobrado y usa fecha efectiva para caja', () => {
    const data = empty();
    data.orders = [order({ status: 'entregado' })];
    data.financial_movements = [{ id: 'p', kind: 'payment', order_id: 'order-1', purchase_id: null, amount: '0.10', method: 'efectivo', category: '', occurred_on: '2026-12-02', notes: '', reconciled: false, version: 1, created_at: '2026-12-02T12:00:00Z', reverses_id: null }];
    const november = monthlyReport(data, '2026-11');
    expect(november.delivered).toBe('0.30');
    expect(november.collections).toBe('0.00');
    expect(november.receivableTotal).toBe('0.20');
    expect(monthlyReport(data, '2026-12').collections).toBe('0.10');
  });
  it('contabiliza reintegros y contramovimientos con su signo, sin duplicar egresos', () => {
    const data = empty(); data.orders = [order()];
    const base = { purchase_id: null, method: 'transferencia' as const, category: '', occurred_on: '2026-11-03', notes: '', reconciled: false, version: 1, created_at: '2026-11-03T12:00:00Z', reverses_id: null };
    data.financial_movements = [
      { ...base, id: 'p', kind: 'payment', order_id: 'order-1', amount: '0.30' },
      { ...base, id: 'r', kind: 'refund', order_id: 'order-1', amount: '-0.10' },
      { ...base, id: 'e', kind: 'expense', order_id: null, amount: '-10.00' },
      { ...base, id: 'er', kind: 'reversal', order_id: null, amount: '10.00', reverses_id: 'e' },
    ];
    const report = monthlyReport(data, '2026-11');
    expect(report.collections).toBe('0.20'); expect(report.expenses).toBe('0.00'); expect(report.cashNet).toBe('0.20'); expect(report.receivableTotal).toBe('0.10');
  });
  it('no llama venta a un pedido devuelto ni lo deja como deuda', () => {
    const data = empty(); data.orders = [order({ status: 'entregado', returned_at: '2026-11-04T12:00:00Z' })];
    const report = monthlyReport(data, '2026-11'); expect(report.delivered).toBe('0.00'); expect(report.returned).toBe('0.30'); expect(report.receivableTotal).toBe('0.00');
  });
  it('incluye puntos nuevos y conserva puntos históricos inactivos', () => {
    const data = empty(); data.locations = [{ id: 'nuevo', name: 'Nuevo local', color: '#112233', active: true, is_pickup: true }, { id: 'historico', name: 'Local anterior', color: '#334455', active: false, is_pickup: true }];
    data.orders = [order({ location_id: 'nuevo' }), order({ id: 'old', location_id: 'historico' })];
    const report = monthlyReport(data, '2026-11'); expect(report.byLocation.map(entry => entry.id)).toEqual(['nuevo', 'historico']); expect(report.byLocation.map(entry => entry.total)).toEqual(['0.30', '0.30']);
  });
  it('no oculta un mínimo incumplido sumando stock de otro punto', () => {
    const data = empty(); data.items = [{ id: 'product-1', name: 'Producto', kind: 'product', unit: 'unidad', price: '1', minimum: '5', active: true, version: 1 }];
    data.stock = [{ item_id: 'product-1', location_id: 'nuevo', on_hand: '100', reserved: '0', shortage: '0' }, { item_id: 'product-1', location_id: 'otro', on_hand: '3', reserved: '0', shortage: '0' }];
    expect(monthlyReport(data, '2026-11').lowStock.map(item => item.id)).toEqual(['product-1']);
  });
});

describe('KALAK: cantidades, clientes únicos y preparación', () => {
  it('suma kilos fraccionarios sin error binario y no cuenta cancelados ni devueltos', () => {
    const data = empty(); const line = { id: 'l', product_id: 'kg', product_unit: 'kg' as const, product_name: 'Carne', quantity: .1, unit_price: '1200.00', reserved: 0, shortage: .1 };
    data.orders = [order({ total: '120.00', lines: [line] }), order({ id: 'second', total: '240.00', lines: [{ ...line, quantity: .2 }] }), order({ id: 'cancelled', status: 'cancelado', total: '999', lines: [line] }), order({ id: 'returned', status: 'entregado', returned_at: '2026-11-04T12:00:00Z', total: '999', lines: [line] })];
    const result = monthlyReport(data, '2026-11');
    expect(result.products[0]).toMatchObject({ units: .3, unit: 'kg', total: '360.00' });
    expect(result.uniqueClients).toBe(1); expect(result.count).toBe(2); expect(result.byLocation[0]).toMatchObject({ count: 2, uniqueClients: 1, pendingCount: 2, deliveredCount: 0 });
  });
  it('filtra preparación y movimientos por fecha, punto, producto, cliente y estado; conserva reversiones', async () => {
    const { operationalReport } = await import('./reports'); const data = empty();
    data.orders = [order(), order({ id: 'other', client_id: 'other', location_id: 'other' }), order({ id: 'delivered', status: 'entregado' })];
    data.movements = [{ id: 'm', item_id: 'product-1', location_id: 'mendieta', quantity: '-3', kind: 'delivery', reason: '', event_id: 'delivered', created_at: '2026-11-04T01:00:00Z' }, { id: 'r', item_id: 'product-1', location_id: 'mendieta', quantity: '3', kind: 'reversal', reason: '', event_id: 'delivered', created_at: '2026-11-04T02:00:00Z', reversal_of: 'm' }];
    const filters = { from: '2026-11-03', to: '2026-11-03', location: 'mendieta', product: 'product-1', client: 'client-1', status: 'all' };
    const result = operationalReport(data, filters);
    expect(result.pending).toMatchObject([{ quantity: '3', date: '2026-11-03', location: 'mendieta' }]); expect(result.count).toBe(2); expect(result.uniqueClients).toBe(1); expect(result.movements).toHaveLength(2);
    expect(operationalReport(data, { ...filters, status: 'entregado' }).pending).toEqual([]);
    expect(operationalReport(data, { ...filters, client: 'other' }).movements).toEqual([]);
  });
  it('separa efectivo, transferencia y entregados con deuda sin inventar cobros', () => {
    const data = empty(); data.orders = [order({ status: 'entregado' })];
    data.financial_movements = [{ id: 'cash', kind: 'payment', order_id: 'order-1', purchase_id: null, amount: '.10', method: 'efectivo', category: '', occurred_on: '2026-11-03', notes: '', reconciled: false, version: 1, created_at: '', reverses_id: null }, { id: 'transfer', kind: 'payment', order_id: 'order-1', purchase_id: null, amount: '.05', method: 'transferencia', category: '', occurred_on: '2026-11-03', notes: '', reconciled: false, version: 1, created_at: '', reverses_id: null }];
    const result = monthlyReport(data, '2026-11'); expect(result.byPaymentMethod.map(entry => entry.collections)).toEqual(['0.10', '0.05', '0.00']); expect(result.deliveredUnpaid[0]?.pending).toBe('0.15');
  });
});

describe('Casos históricos y ventas sin contacto', () => {
  it('no cuenta ventas espontáneas sin contacto como un cliente único', () => {
    const data = empty(); data.orders = [order({ client_id: null }), order({ id: 'two', client_id: null }), order({ id: 'three' })];
    expect(monthlyReport(data, '2026-11')).toMatchObject({ count: 3, uniqueClients: 1 });
  });
  it('mantiene alertas en puntos sin fila de stock y vincula las reversiones al pedido original', async () => {
    const { operationalReport } = await import('./reports'); const data = empty();
    data.items = [{ id: 'product-1', name: 'Producto', kind: 'product', unit: 'kg', price: '10', minimum: '5', active: true, version: 1 }];
    data.locations = [{ id: 'mendieta', name: 'Punto', color: '#ffffff', is_pickup: true, active: true }];
    data.orders = [order({ status: 'entregado' })];
    data.movements = [{ id: 'original', item_id: 'product-1', location_id: 'mendieta', quantity: '-.30', kind: 'delivery', reason: '', event_id: 'order-1', created_at: '2026-11-03T12:00:00Z' }, { id: 'reverse', item_id: 'product-1', location_id: 'mendieta', quantity: '.30', kind: 'reversal', reason: '', event_id: 'command', created_at: '2026-11-04T12:00:00Z', reversal_of: 'original' }];
    const result = operationalReport(data, { from: '2026-11-01', to: '2026-11-30', location: 'all', client: 'client-1', product: 'all', status: 'all' });
    expect(result.stock).toMatchObject([{ available: '0', low: true, minimum: '5' }]); expect(result.movements).toHaveLength(2); expect(result.movements[0]?.order?.id).toBe('order-1');
  });
});

describe('Conciliación de centavos facturados por pedido', () => {
  it('no redondea fracciones de centavo entre ventas distintas y concilia el Excel', async () => {
    const { reportWorksheets } = await import('./reports'); const data = empty();
    const line = { id: 'half-cent', product_id: 'tiny', product_unit: 'kg' as const, quantity: .5, unit_price: '.01', reserved: 0, shortage: 0 };
    data.orders = [order({ id: 'first', total: '.01', status: 'entregado', lines: [line] }), order({ id: 'second', total: '.01', status: 'entregado', lines: [line] })];
    const report = monthlyReport(data, '2026-11'); expect(report.total).toBe('0.02'); expect(report.products[0]?.total).toBe('0.02');
    const sheets = reportWorksheets(data, '2026-11', { from: '2026-11-01', to: '2026-11-30', location: 'all', product: 'all', client: 'all', status: 'all' }, 30);
    expect(sheets.find(sheet => sheet.name === 'Productos mes')?.rows[1]?.[3]).toEqual({ number: '0.02' });
    expect(sheets.find(sheet => sheet.name === 'Pedidos filtrados')?.rows.slice(1).map(row => row[9])).toEqual([{ number: '0.01' }, { number: '0.01' }]);
  });
  it('asigna el centavo sobrante una sola vez entre productos del mismo pedido', async () => {
    const { billedLineAmounts } = await import('./reports');
    const lines = ['a', 'b', 'c'].map(id => ({ id, product_id: id, quantity: .5, unit_price: '.01', reserved: 0, shortage: 0 }));
    const amounts = billedLineAmounts({ lines, total: '.02' }); expect([...amounts.values()]).toEqual(['0.01', '0.01', '0.00']);
    const data = empty(); data.orders = [order({ total: '.02', lines })];
    expect(monthlyReport(data, '2026-11').products.map(product => product.total)).toEqual(['0.01', '0.01', '0.00']);
  });
});


describe('Muestras gratis sin deuda ni ingresos ficticios', () => {
  it('mantiene una compra real con bolsa de regalo: una venta, comida cobrada, costo y cantidades de ambos productos', async () => {
    const { billedLineAmounts, operationalReport, reportWorksheets, snapshotCsv } = await import('./reports');
    const data = empty();
    data.orders = [order({ total: '3000.00', status: 'entregado', payment_method: 'efectivo', lines: [
      { id: 'food', product_id: 'food', quantity: '1.5', unit_price: '2000.00', list_unit_price: '2000.00', product_unit: 'kg', reserved: 0, shortage: 0 },
      { id: 'bag', product_id: 'bag', quantity: '1', unit_price: '0.00', list_unit_price: '9007199254740993.01', is_gift: true, product_unit: 'unidad', reserved: 0, shortage: 0 },
    ] })];
    data.items = [{ id: 'ingredient', name: 'Insumo', kind: 'ingredient', unit: 'unidad', price: '100.00', minimum: '0', active: true, version: 1 }];
    data.recipes = [
      { id: 'food-recipe', product_id: 'food', yield_quantity: 1, revision: 1, lines: [{ ingredient_id: 'ingredient', quantity: '4', unit: 'unidad' }], created_at: '' },
      { id: 'bag-recipe', product_id: 'bag', yield_quantity: 1, revision: 1, lines: [{ ingredient_id: 'ingredient', quantity: '2', unit: 'unidad' }], created_at: '' },
    ];
    const report = monthlyReport(data, '2026-11');
    expect(report).toMatchObject({ count: 1, deliveredCount: 1, total: '3000.00', delivered: '3000.00', receivableTotal: '3000.00', collections: '0.00', estimatedCost: '800.00', estimatedMargin: '2200.00' });
    expect(report.products).toMatchObject([{ id: 'food', units: 1.5, total: '3000.00' }, { id: 'bag', units: 1, total: '0.00' }]);
    expect([...billedLineAmounts(data.orders[0]!).entries()]).toEqual([['food', '3000.00'], ['bag', '0.00']]);
    const filters = { from: '2026-11-01', to: '2026-11-30', location: 'all', product: 'all', client: 'all', status: 'all' };
    expect(operationalReport(data, filters).count).toBe(1);
    const rows = reportWorksheets(data, '2026-11', filters, 30).find(sheet => sheet.name === 'Pedidos filtrados')!.rows;
    expect(rows[2]?.slice(7)).toEqual([{ number: '1' }, { number: '0.00' }, { number: '0.00' }, 'Sí', { number: '9007199254740993.01' }]);
    expect(snapshotCsv(data)).toContain('Regalo primera compra · Precio de lista histórico: 9007199254740993.01');
    // Gift value never becomes a proportional revenue allocation, even if old cached data has a nonzero price.
    expect(billedLineAmounts({ ...data.orders[0]!, lines: data.orders[0]!.lines.map(line => line.is_gift ? { ...line, unit_price: '999.00' } : line) }).get('bag')).toBe('0.00');
  });
  it('conserva los cobros originales y su reversión sin fabricar una entrada gratis', () => {
    const data = empty(); data.orders = [order({ status: 'entregado', payment_method: 'gratis' })];
    const base = { order_id: 'order-1', purchase_id: null, method: 'efectivo' as const, category: '', occurred_on: '2026-11-03', notes: '', reconciled: false, version: 1, created_at: '', reverses_id: null };
    data.financial_movements = [{ ...base, id: 'original', kind: 'payment', amount: '0.30' }, { ...base, id: 'reverse', kind: 'reversal', amount: '-0.30', reverses_id: 'original' }];
    const report = monthlyReport(data, '2026-11');
    expect(report).toMatchObject({ total: '0.00', collections: '0.00', cashNet: '0.00', receivableTotal: '0.00', receivables: [], deliveredUnpaid: [] });
    expect(report.movements.map(entry => entry.id)).toEqual(['original', 'reverse']);
    expect(report.byPaymentMethod[0]?.collections).toBe('0.00');
  });
  it('conserva el costo físico de muestras aunque no generen ingresos', () => {
    const data = empty(); data.orders = [order({ status: 'entregado', payment_method: 'gratis' })];
    data.items = [{ id: 'ingredient', name: 'Insumo', kind: 'ingredient', unit: 'kg', price: '2.00', minimum: '0', active: true, version: 1 }];
    data.recipes = [{ id: 'recipe', product_id: 'product-1', yield_quantity: 1, revision: 1, lines: [{ ingredient_id: 'ingredient', quantity: '1', unit: 'kg' }], created_at: '' }];
    expect(monthlyReport(data, '2026-11')).toMatchObject({ delivered: '0.00', estimatedCost: '6.00', estimatedMargin: '-6.00' });
  });

  it('conserva cantidades físicas, pero excluye valor catálogo gratis de todos los totales monetarios', async () => {
    const { billedLineAmounts, reportWorksheets } = await import('./reports');
    const data = empty();
    data.orders = [order({ status: 'entregado' }), order({ id: 'free-delivered', status: 'entregado', payment_method: 'gratis', total: '999.99' }), order({ id: 'free-pending', payment_method: 'gratis', total: '999.99' }), order({ id: 'free-cancelled', status: 'cancelado', payment_method: 'gratis', total: '999.99' }), order({ id: 'free-returned', status: 'entregado', returned_at: '2026-11-04', payment_method: 'gratis', total: '999.99' })];
    const report = monthlyReport(data, '2026-11');
    expect(report).toMatchObject({ count: 3, deliveredCount: 2, pendingCount: 1, total: '0.30', delivered: '0.30', pending: '0.00', cancelled: '0.00', returned: '0.00', collections: '0.00', cashNet: '0.00', receivableTotal: '0.30' });
    expect(report.products[0]).toMatchObject({ units: 9, total: '0.30' });
    expect(report.days).toEqual([{ date: '2026-11-03', total: '0.30' }]);
    expect(report.byLocation[0]).toMatchObject({ count: 3, total: '0.30' });
    expect(report.receivables.map(entry => entry.order.id)).toEqual(['order-1']);
    expect(report.deliveredUnpaid.map(entry => entry.order.id)).toEqual(['order-1']);
    expect([...billedLineAmounts(data.orders[1]!).values()]).toEqual(['0.00']);
    expect(data.orders[1]?.total).toBe('999.99');
    const sheets = reportWorksheets(data, '2026-11', { from: '2026-11-01', to: '2026-11-30', location: 'all', product: 'all', client: 'all', status: 'all' }, 30);
    expect(sheets.find(sheet => sheet.name === 'Productos mes')?.rows[1]?.[3]).toEqual({ number: '0.30' });
    expect(sheets.find(sheet => sheet.name === 'Pedidos filtrados')?.rows.slice(1).map(row => row[9])).toEqual([{ number: '0.30' }, { number: '0.00' }, { number: '0.00' }, { number: '0.00' }, { number: '0.00' }]);
  });
});
