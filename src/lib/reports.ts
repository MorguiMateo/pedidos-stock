import Decimal from './decimal';
import type { FinancialMovement, LocationId, Order, Snapshot } from './types';
import { customerActivity } from './clientHistory';
import { excelNumber, type Worksheet } from './xlsx';
import { dailySummary } from './daily';
import { orderSaleAmount } from './orderAmounts';
import { estimatedRecipeCost, csvRows } from './operations';
import { isValidDate } from './format';
const sum = (values: string[]) => values.reduce((total, value) => total.plus(value), new Decimal(0));

export type CashCollectionEntry = Omit<FinancialMovement, 'location_id'> & {
  order: Order | undefined; client: string; location_id: string | null; location_name: string;
};
export type CashCollectionLocation = {
  id: string | null; name: string; color: string; count: number; received: string; refunds: string; net: string;
};
export type CashCollectionFilters = { from: string; to: string; location?: string };
/** Actual cash order ledger only, by inclusive movement date, never pickup/planned payment date.
 * Preserve cancelled/returned/deleted-order history and signed compensations: received includes
 * positive refund reversals; refunds includes negative receipt reversals. Both are gross flows.
 */
export function cashCollectionsReport(data: Snapshot, from: string, to: string, location = 'all') {
  const movements = new Map((data.financial_movements ?? []).map(entry => [entry.id, entry]));
  const orders = new Map(data.orders.map(order => [order.id, order]));
  const locations = new Map(data.locations.map(point => [point.id, point]));
  const validRange = isValidDate(from) && isValidDate(to) && from <= to;
  const entries: CashCollectionEntry[] = [];
  for (const movement of data.financial_movements ?? []) {
    if (!validRange || movement.method !== 'efectivo' || !movement.order_id || movement.kind === 'expense' || movement.occurred_on < from || movement.occurred_on > to) continue;
    const original = movement.reverses_id ? movements.get(movement.reverses_id) : undefined;
    if (movement.kind === 'reversal' && original?.kind === 'expense') continue;
    const order = orders.get(movement.order_id);
    const locationId = movement.location_id || original?.location_id || order?.location_id || (original?.order_id ? orders.get(original.order_id)?.location_id : null) || null;
    if (location !== 'all' && locationId !== location) continue;
    entries.push({ ...movement, order, client: order ? data.clients.find(client => client.id === order.client_id)?.name ?? order.client_id ?? 'Venta sin cliente' : 'Pedido no disponible', location_id: locationId, location_name: locationId ? locations.get(locationId)?.name ?? locationId : 'Sin punto atribuido' });
  }
  entries.sort((a, b) => a.occurred_on.localeCompare(b.occurred_on) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const totals = (rows: CashCollectionEntry[]) => ({
    received: sum(rows.filter(entry => new Decimal(entry.amount).gt(0)).map(entry => entry.amount)).toFixed(2),
    refunds: sum(rows.filter(entry => new Decimal(entry.amount).lt(0)).map(entry => entry.amount)).negated().toFixed(2),
    net: sum(rows.map(entry => entry.amount)).toFixed(2),
  });
  const locationIds = new Set<string | null>([
    ...data.locations.filter(point => point.is_pickup !== false && (location === 'all' || location === point.id)).map(point => point.id),
    ...entries.map(entry => entry.location_id),
  ]);
  const byLocation: CashCollectionLocation[] = [...locationIds].map(id => {
    const rows = entries.filter(entry => entry.location_id === id);
    return { id, name: id ? locations.get(id)?.name ?? id : 'Sin punto atribuido', color: id ? locations.get(id)?.color ?? '#666666' : '#666666', count: rows.length, ...totals(rows) };
  });
  return { entries, byLocation, ...totals(entries) };
}
/** Largest-remainder cent allocation reconciles charged lines to the billed charge (zero for gratis).
 * Fractions of a cent are allocated within each order, never rounded across different sales.
 */
export function billedLineAmounts(order: Pick<Order, 'lines' | 'total'> & Partial<Pick<Order, 'payment_method'>>): Map<string, string> {
  const cents = new Decimal(orderSaleAmount(order)).times(100).toDecimalPlaces(0);
  const weights = order.lines.map(line => line.is_gift ? new Decimal(0) : new Decimal(line.unit_price).times(line.quantity));
  const weightTotal = weights.reduce((total, value) => total.plus(value), new Decimal(0));
  const firstChargedIndex = order.lines.findIndex(line => !line.is_gift);
  const allocation = order.lines.map((line, index) => {
    const exact = weightTotal.gt(0) ? cents.times(weights[index]!).div(weightTotal) : index === firstChargedIndex ? cents : new Decimal(0);
    const floor = exact.floor();
    return { id: line.id, index, cents: floor, remainder: exact.minus(floor) };
  });
  const remaining = cents.minus(allocation.reduce((total, entry) => total.plus(entry.cents), new Decimal(0))).toNumber();
  const ranked = allocation.filter(entry => !order.lines[entry.index]!.is_gift).sort((a, b) => b.remainder.comparedTo(a.remainder) || a.id.localeCompare(b.id) || a.index - b.index);
  for (let index = 0; index < Math.min(remaining, ranked.length); index++) { const entry = ranked[index]!; entry.cents = entry.cents.plus(1); }
  return new Map(allocation.map(entry => [entry.id, entry.cents.div(100).toFixed(2)]));
}
export function monthlyReport(data: Snapshot, month: string, location: LocationId | 'all' = 'all') {
  const inLocation = (id: string) => location === 'all' || id === location;
  const orders = data.orders.filter(order => order.pickup_date.startsWith(`${month}-`) && inLocation(order.location_id));
  const active = orders.filter(order => order.status !== 'cancelado' && !order.returned_at);
  const total = (status?: string) => sum(orders.filter(order => status ? order.status === status && !order.returned_at : order.status !== 'cancelado' && !order.returned_at).map(orderSaleAmount)).toFixed(2);
  const products = new Map<string, { id: string; name: string; unit: string; units: number; total: Decimal }>();
  const days = new Map<string, Decimal>();
  for (const order of active) {
    days.set(order.pickup_date, (days.get(order.pickup_date) ?? new Decimal(0)).plus(orderSaleAmount(order)));
    const billed = billedLineAmounts(order);
    for (const line of order.lines) {
      const product = products.get(line.product_id) ?? { id: line.product_id, name: line.product_name || data.items.find(item => item.id === line.product_id)?.name || 'Producto archivado', unit: line.product_unit ?? data.items.find(item => item.id === line.product_id)?.unit ?? 'unidad', units: 0, total: new Decimal(0) };
      product.units = new Decimal(product.units).plus(line.quantity).toNumber(); product.total = product.total.plus(billed.get(line.id) ?? '0'); products.set(product.id, product);
    }
  }
  const locationIds = new Set([...data.locations.filter(entry => entry.is_pickup !== false).map(entry => entry.id), ...orders.map(order => order.location_id)]);
  const byLocation = [...locationIds].filter(inLocation).map(id => ({ id, name: data.locations.find(entry => entry.id === id)?.name ?? id, color: data.locations.find(entry => entry.id === id)?.color ?? '#255B46', count: active.filter(order => order.location_id === id).length, uniqueClients: new Set(active.filter(order => order.location_id === id).map(order => order.client_id).filter(Boolean)).size, deliveredCount: active.filter(order => order.location_id === id && order.status === 'entregado').length, pendingCount: active.filter(order => order.location_id === id && order.status === 'pendiente_entrega').length, total: sum(active.filter(order => order.location_id === id).map(orderSaleAmount)).toFixed(2) }));
  const purchaseTotal = sum(data.purchases.filter(purchase => purchase.status === 'recibida' && purchase.received_at && localDate(purchase.received_at).startsWith(`${month}-`)).map(purchase => purchase.total)).toFixed(2);
  const lowStock = data.items.filter(item => item.active && new Decimal(item.minimum).gt(0)).filter(item => {
    const balances = data.stock.filter(balance => balance.item_id === item.id && (item.kind === 'ingredient' ? balance.location_id === 'cocina' : inLocation(balance.location_id)));
    // A minimum is a per-location threshold, not a sum that hides shortages at another point.
    return balances.length ? balances.some(balance => new Decimal(balance.usable ?? balance.on_hand).minus(balance.reserved).lt(item.minimum)) : true;
  });
  const movements = (data.financial_movements ?? []).filter(movement => movement.occurred_on.startsWith(`${month}-`) && (!movement.order_id ? location === 'all' : inLocation(data.orders.find(order => order.id === movement.order_id)?.location_id ?? movement.location_id ?? '')));
  const collections = sum(movements.filter(movement => movement.order_id !== null).map(movement => movement.amount));
  const expenses = sum(movements.filter(movement => movement.order_id === null).map(movement => movement.amount)).negated();
  const receivables = data.orders.filter(order => inLocation(order.location_id)).map(order => {
    const paid = sum((data.financial_movements ?? []).filter(movement => movement.order_id === order.id).map(movement => movement.amount));
    const amountDue = order.status === 'cancelado' || order.returned_at ? new Decimal(0) : new Decimal(orderSaleAmount(order));
    return { order, client: data.clients.find(client => client.id === order.client_id)?.name ?? 'Cliente', paid: paid.toFixed(2), pending: Decimal.max(amountDue.minus(paid), 0).toFixed(2), credit: Decimal.max(paid.minus(amountDue), 0).toFixed(2) };
  }).filter(entry => new Decimal(entry.pending).gt(0) || new Decimal(entry.credit).gt(0));
  const payables = data.purchases.filter(purchase => purchase.status === 'recibida').map(purchase => {
    const paid = sum((data.financial_movements ?? []).filter(movement => movement.purchase_id === purchase.id).map(movement => movement.amount)).negated();
    return { purchase, paid: paid.toFixed(2), pending: Decimal.max(new Decimal(purchase.total).minus(paid), 0).toFixed(2), credit: Decimal.max(paid.minus(purchase.total), 0).toFixed(2) };
  }).filter(entry => new Decimal(entry.pending).gt(0) || new Decimal(entry.credit).gt(0));
  const costEstimates = data.items.filter(item => item.kind === 'product' && item.active).map(item => {
    const recipe = data.recipes.filter(recipe => recipe.product_id === item.id).sort((a, b) => b.revision - a.revision)[0];
    const unitCost = estimatedRecipeCost(recipe, data.items);
    const weight = new Decimal(item.weight_kg ?? 0);
    return { item, unitCost: unitCost?.toFixed(2) ?? null, costKg: unitCost && weight.gt(0) ? unitCost.div(weight).toFixed(2) : null, margin: unitCost ? new Decimal(item.price).minus(unitCost).toFixed(2) : null, recipeRevision: recipe?.revision ?? null };
  });
  let estimatedCost = new Decimal(0), missingCost = 0;
  for (const order of active.filter(order => order.status === 'entregado')) for (const line of order.lines) {
    const recipe = data.recipes.filter(recipe => recipe.product_id === line.product_id).sort((a, b) => b.revision - a.revision)[0];
    const cost = estimatedRecipeCost(recipe, data.items);
    if (cost === null) missingCost++; else estimatedCost = estimatedCost.plus(cost.times(line.quantity));
  }
  return {
    count: active.length, uniqueClients: new Set(active.map(order => order.client_id).filter(Boolean)).size, deliveredCount: active.filter(order => order.status === 'entregado').length, pendingCount: active.filter(order => order.status === 'pendiente_entrega').length, total: total(), delivered: total('entregado'), pending: total('pendiente_entrega'), cancelled: total('cancelado'), cancelledCount: orders.filter(order => order.status === 'cancelado').length,
    returned: sum(orders.filter(order => order.returned_at).map(orderSaleAmount)).toFixed(2),
    products: [...products.values()].sort((a, b) => b.total.comparedTo(a.total)).map(product => ({ ...product, total: product.total.toFixed(2) })),
    days: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, total]) => ({ date, total: total.toFixed(2) })), byLocation, purchaseTotal, lowStock,
    movements, byPaymentMethod: (['efectivo', 'transferencia', 'desconocido'] as const).map(method => ({ method, collections: sum(movements.filter(movement => movement.order_id !== null && movement.method === method).map(movement => movement.amount)).toFixed(2), net: sum(movements.filter(movement => movement.method === method).map(movement => movement.amount)).toFixed(2) })), deliveredUnpaid: receivables.filter(entry => entry.order.status === 'entregado' && !entry.order.returned_at && new Decimal(entry.pending).gt(0)), collections: collections.toFixed(2), expenses: expenses.toFixed(2), cashNet: collections.minus(expenses).toFixed(2), receivables, receivableTotal: sum(receivables.map(entry => entry.pending)).toFixed(2), payables, payableTotal: sum(payables.map(entry => entry.pending)).toFixed(2),
    costEstimates, estimatedCost: estimatedCost.toFixed(2), estimatedMargin: missingCost ? null : new Decimal(total('entregado')).minus(estimatedCost).toFixed(2), missingCost,
  };
}
export function snapshotCsv(data: Snapshot): string {
  const rows: unknown[][] = [['seccion', 'id', 'fecha', 'ubicacion', 'articulo_cliente', 'tipo_estado', 'cantidad', 'importe', 'referencia', 'notas']];
  const itemName = (id: string) => data.items.find(item => item.id === id)?.name ?? id;
  const place = (id: string) => data.locations.find(entry => entry.id === id)?.name ?? id;
  for (const item of data.items) rows.push(['catalogo', item.id, '', '', item.name, `${item.kind}/${item.category ?? 'alimento'}`, item.weight_kg ?? '', item.price, item.code, item.presentation]);
  for (const stock of data.stock) {
    rows.push(['stock_fisico', stock.item_id, data.updated_at, place(stock.location_id), itemName(stock.item_id), '', stock.on_hand, '', '', '']);
    rows.push(['stock_reservado', stock.item_id, data.updated_at, place(stock.location_id), itemName(stock.item_id), '', stock.reserved, '', '', '']);
  }
  for (const order of data.orders) for (const line of order.lines) rows.push(['pedidos', order.id, order.pickup_date, place(order.location_id), data.clients.find(client => client.id === order.client_id)?.name, order.returned_at ? 'devuelto' : order.status, line.quantity, billedLineAmounts(order).get(line.id), itemName(line.product_id), [order.notes, ...(line.is_gift ? [`Regalo primera compra · Precio de lista histórico: ${line.list_unit_price ?? line.unit_price}`] : [])].filter(Boolean).join(' · ')]);
  for (const movement of data.financial_movements ?? []) rows.push(['caja', movement.id, movement.occurred_on, '', '', `${movement.kind}/${movement.method}`, '', movement.amount, movement.order_id ?? movement.purchase_id, `${movement.category} · ${movement.reconciled ? 'Conciliado' : 'Sin conciliar'}${movement.transfer_name ? ` · Transferencia a nombre de: ${movement.transfer_name}` : ''} · ${movement.notes}`]);
  for (const movement of data.movements) rows.push(['movimientos_stock', movement.id, movement.created_at, place(movement.location_id), itemName(movement.item_id), movement.kind, movement.quantity, '', movement.event_id, movement.reason]);
  for (const batch of data.batches ?? []) for (const stock of (data.batch_stock ?? []).filter(stock => stock.batch_id === batch.id)) rows.push(['lotes', batch.id, batch.manufactured_on, place(stock.location_id), itemName(batch.item_id), `Vence ${batch.expires_on}`, stock.quantity, '', batch.code, '']);
  for (const purchase of data.purchases) for (const line of purchase.lines) rows.push(['compras', purchase.id, purchase.received_at ?? purchase.expected_date, '', purchase.supplier, purchase.status, line.quantity, new Decimal(line.unit_price).times(line.quantity).toFixed(2), itemName(line.ingredient_id), purchase.notes]);
  return csvRows(rows);
}
function localDate(timestamp: string) { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Argentina/Mendoza', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp)); }

export type ReportFilters = { from: string; to: string; location: string; product: string; client: string; status: string };
/** Date is always the order pickup date; cancellation/return remain auditable but never count as sales. */
export function operationalReport(data: Snapshot, filters: ReportFilters) {
  const orders = data.orders.filter(order => order.pickup_date >= filters.from && order.pickup_date <= filters.to && (filters.location === 'all' || order.location_id === filters.location) && (filters.client === 'all' || order.client_id === filters.client) && (filters.status === 'all' || (filters.status === 'devuelto' ? !!order.returned_at : !order.returned_at && order.status === filters.status)) && (filters.product === 'all' || order.lines.some(line => line.product_id === filters.product)));
  const active = orders.filter(order => order.status !== 'cancelado' && !order.returned_at);
  const pending = new Map<string, { product: string; name: string; unit: string; location: string; date: string; quantity: Decimal; shortage: Decimal }>();
  for (const order of active.filter(order => order.status === 'pendiente_entrega')) for (const line of order.lines.filter(line => filters.product === 'all' || line.product_id === filters.product)) {
    const key = `${line.product_id}/${order.location_id}/${order.pickup_date}`;
    const entry = pending.get(key) ?? { product: line.product_id, name: line.product_name ?? data.items.find(item => item.id === line.product_id)?.name ?? 'Producto archivado', unit: line.product_unit ?? data.items.find(item => item.id === line.product_id)?.unit ?? 'unidad', location: order.location_id, date: order.pickup_date, quantity: new Decimal(0), shortage: new Decimal(0) };
    entry.quantity = entry.quantity.plus(line.quantity); entry.shortage = entry.shortage.plus(line.shortage); pending.set(key, entry);
  }
  const stockBalances = [...data.stock];
  for (const item of data.items.filter(item => item.active && new Decimal(item.minimum).gt(0))) for (const location of data.locations.filter(location => location.active !== false && (data.profile?.role !== 'responsable' || location.id === data.profile.location_id) && (item.kind === 'ingredient' ? location.id === 'cocina' : location.is_pickup !== false))) {
    if (!stockBalances.some(balance => balance.item_id === item.id && balance.location_id === location.id)) stockBalances.push({ item_id: item.id, location_id: location.id, on_hand: '0', reserved: '0', shortage: '0' });
  }
  const stock = stockBalances.filter(balance => (filters.location === 'all' || balance.location_id === filters.location) && (filters.product === 'all' || balance.item_id === filters.product)).map(balance => {
    const item = data.items.find(item => item.id === balance.item_id);
    const available = new Decimal(balance.usable ?? balance.on_hand).minus(balance.reserved);
    return { ...balance, name: item?.name ?? balance.item_id, unit: item?.unit ?? 'unidad', minimum: item?.minimum ?? '0', usable: balance.usable ?? balance.on_hand, available: available.toString(), low: !!item?.active && new Decimal(item.minimum).gt(0) && available.lt(item.minimum) };
  });
  // Keep reversals and returned stock: a stock ledger is physical history, not a sales total.
  const movements = data.movements.filter(movement => localDate(movement.created_at) >= filters.from && localDate(movement.created_at) <= filters.to && (filters.location === 'all' || movement.location_id === filters.location) && (filters.product === 'all' || movement.item_id === filters.product)).map(movement => {
    const original = movement.reversal_of ? data.movements.find(entry => entry.id === movement.reversal_of) : null;
    const order = data.orders.find(order => order.id === movement.event_id || order.id === original?.event_id);
    return { ...movement, order, client: order ? data.clients.find(client => client.id === order.client_id)?.name ?? order.client_id : null };
  }).filter(movement => (filters.client === 'all' || movement.order?.client_id === filters.client) && (filters.status === 'all' || (filters.status === 'devuelto' ? !!movement.order?.returned_at : !movement.order?.returned_at && movement.order?.status === filters.status))).sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { orders, count: active.length, uniqueClients: new Set(active.map(order => order.client_id).filter(Boolean)).size, pending: [...pending.values()].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name)).map(entry => ({ ...entry, quantity: entry.quantity.toString(), shortage: entry.shortage.toString() })), stock, movements };
}

/** Counts and physical sample quantities include gratis; monetary sales and receivables do not.
 * Cash always uses genuine signed ledger entries, never the order's catalogue valuation.
 * Every report slice is exported with explicit filter and date semantics.
 */
export function reportWorksheets(data: Snapshot, month: string, filters: ReportFilters, inactivityDays: number, dailyDate = filters.to, cashFilters: CashCollectionFilters = filters): Worksheet[] {
  const report = monthlyReport(data, month, filters.location);
  const operational = operationalReport(data, filters);
  const daily = dailySummary(data, dailyDate, filters.location);
  const customers = customerActivity(data, month, filters.to);
  const cashLocation = cashFilters.location ?? filters.location;
  const cash = cashCollectionsReport(data, cashFilters.from, cashFilters.to, cashLocation);
  const place = (id: string) => data.locations.find(location => location.id === id)?.name ?? id;
  const item = (id: string) => data.items.find(item => item.id === id)?.name ?? id;
  return [
    { name: 'Filtros y resumen', rows: [['Informe KALAK', month], ['Punto', filters.location === 'all' ? 'Todos' : place(filters.location)], ['Operativo desde', filters.from], ['Operativo hasta', filters.to], ['Producto', filters.product], ['Cliente', filters.client], ['Estado', filters.status], ['Días sin compra', inactivityDays], ['Ventas: retiro del mes; excluye cancelados, devoluciones e importes gratis. Cantidades y pedidos incluyen muestras gratis. Clientes: compras no gratuitas entregadas hasta la fecha final. Caja: solo movimientos reales.'], ['Pedidos', report.count], ['Clientes únicos', report.uniqueClients], ['Entregados', report.deliveredCount], ['Pendientes', report.pendingCount], ['Total general histórico', report.total], ['Entregados importe', report.delivered], ['Pendientes importe', report.pending], ['Cancelados importe', report.cancelled], ['Devueltos importe', report.returned], ['Cobros netos', report.collections], ['Egresos netos', report.expenses], ['Flujo neto', report.cashNet]] },
    { name: 'Resumen diario', rows: [['Fecha', dailyDate], ['Punto', filters.location], ['Pedidos válidos', daily.count], ['Importe histórico', daily.sales], ['Entregados importe', daily.delivered], ['Cobros netos', daily.collections], ['Egresos netos', daily.expenses], ['Flujo neto', daily.cashNet]] },
    { name: 'Productos mes', rows: [['Producto', 'Cantidad', 'Unidad', 'Importe histórico'], ...report.products.map(entry => [entry.name, entry.units, entry.unit, entry.total]), ['TOTAL GENERAL', '', '', report.total]] },
    { name: 'Ventas por día', rows: [['Retiro', 'Importe'], ...report.days.map(entry => [entry.date, entry.total])] },
    { name: 'Puntos', rows: [['Punto', 'Pedidos', 'Clientes únicos', 'Entregados', 'Pendientes', 'Importe histórico'], ...report.byLocation.map(entry => [entry.name, entry.count, entry.uniqueClients, entry.deliveredCount, entry.pendingCount, entry.total])] },
    { name: 'Preparación', rows: [['Fecha retiro', 'Punto', 'Producto', 'Cantidad pendiente', 'Unidad', 'Faltante stock'], ...operational.pending.map(entry => [entry.date, place(entry.location), entry.name, entry.quantity, entry.unit, entry.shortage])] },
    { name: 'Clientes', rows: [['Nombre', 'Teléfono', 'Alta conocida', 'Primera compra entregada', 'Última compra entregada', 'Pedidos válidos', 'Compras entregadas', 'Compras del mes', 'Venta histórica entregada', 'Días desde compra', 'Supera umbral sin compra'], ...customers.map(entry => [entry.client.name, entry.client.phone ?? '', entry.createdOn, entry.firstPurchase, entry.lastPurchase, entry.orderCount, entry.purchaseCount, entry.monthlyPurchases, entry.totalSales, entry.daysSincePurchase, entry.daysSincePurchase !== null && entry.daysSincePurchase >= inactivityDays ? 'Sí' : 'No'])] },
    { name: 'Cohortes clientes', rows: [['Mes', month], ['Altas registradas (todos los puntos)', customers.filter(entry => entry.createdOn?.startsWith(`${month}-`)).length], ['Primera compra entregada (todos los puntos)', customers.filter(entry => entry.firstPurchase?.startsWith(`${month}-`)).length], ['Sin compras entregadas conocidas', customers.filter(entry => !entry.lastPurchase).length]] },
    { name: 'Saldos pedidos', rows: [['Pedido', 'Cliente', 'Retiro', 'Punto', 'Estado', 'Total', 'Cobrado neto', 'Deuda', 'Crédito'], ...report.receivables.map(entry => [entry.order.id, entry.client, entry.order.pickup_date, place(entry.order.location_id), entry.order.returned_at ? 'devuelto' : entry.order.status, entry.order.total, entry.paid, entry.pending, entry.credit])] },
    { name: 'Entregados sin cobrar', rows: [['Pedido', 'Cliente', 'Retiro', 'Punto', 'Pendiente'], ...report.deliveredUnpaid.map(entry => [entry.order.id, entry.client, entry.order.pickup_date, place(entry.order.location_id), entry.pending])] },
    { name: 'Caja', rows: [['Fecha movimiento', 'Tipo', 'Medio', 'Importe firmado', 'Pedido', 'Transferencia a nombre de', 'Categoría', 'Notas', 'Conciliado'], ...report.movements.map(entry => [entry.occurred_on, entry.kind, entry.method, entry.amount, entry.order_id, entry.transfer_name, entry.category, entry.notes, entry.reconciled ? 'Sí' : 'No'])] },
    { name: 'Medios de cobro', rows: [['Medio', 'Cobros netos', 'Flujo neto'], ...report.byPaymentMethod.map(entry => [entry.method, entry.collections, entry.net])] },
    { name: 'Efectivo resumen', rows: [['Cobros en efectivo: solo movimientos reales de pedidos'], ['Desde (fecha de movimiento)', cashFilters.from], ['Hasta (inclusive)', cashFilters.to], ['Punto', cashLocation === 'all' ? 'Todos' : place(cashLocation)], ['Entradas (incluye reversión de reintegros)', cash.received], ['Salidas (reintegros y reversión de cobros)', cash.refunds], ['Efectivo neto', cash.net]] },
    { name: 'Efectivo por punto', rows: [['Punto', 'Movimientos', 'Entradas', 'Reintegros y reversiones', 'Efectivo neto'], ...cash.byLocation.map(entry => [entry.name, entry.count, entry.received, entry.refunds, entry.net]), ['TOTAL', cash.entries.length, cash.received, cash.refunds, cash.net]] },
    { name: 'Efectivo detalle', rows: [['Fecha de movimiento', 'Punto', 'Pedido', 'Cliente', 'Tipo', 'Importe firmado', 'Reversión de', 'Notas'], ...cash.entries.map(entry => [entry.occurred_on, entry.location_name, entry.order_id, entry.client, entry.kind, entry.amount, entry.reverses_id, entry.notes])] },
    { name: 'Stock y mínimos', rows: [['Producto', 'Punto', 'Unidad', 'Físico', 'Reservado', 'Disponible no vencido', 'Mínimo', 'Alerta', 'Utilizable no vencido'], ...operational.stock.map(entry => [entry.name, place(entry.location_id), entry.unit, entry.on_hand, entry.reserved, entry.available, entry.minimum, entry.low ? 'Bajo mínimo' : '', entry.usable])] },
    { name: 'Movimientos stock', rows: [['Fecha', 'Producto', 'Punto', 'Cliente asociado', 'Estado pedido', 'Tipo', 'Cantidad firmada', 'Motivo', 'Referencia', 'Reversión de'], ...operational.movements.map(entry => [entry.created_at, item(entry.item_id), place(entry.location_id), entry.client, entry.order?.returned_at ? 'devuelto' : entry.order?.status, entry.kind, entry.quantity, entry.reason, entry.event_id, entry.reversal_of])] },
    { name: 'Pedidos filtrados', rows: [['Pedido', 'Retiro', 'Cliente', 'Punto', 'Estado', 'Producto', 'Unidad', 'Cantidad', 'Precio cobrado histórico', 'Importe facturado asignado a línea', 'Regalo primera compra', 'Precio de lista histórico (no facturado si es regalo)'], ...operational.orders.flatMap(order => order.lines.filter(line => filters.product === 'all' || line.product_id === filters.product).map(line => [order.id, order.pickup_date, data.clients.find(client => client.id === order.client_id)?.name ?? 'Venta sin cliente', place(order.location_id), order.returned_at ? 'devuelto' : order.status, line.product_name ?? item(line.product_id), line.product_unit ?? data.items.find(item => item.id === line.product_id)?.unit, line.quantity, line.unit_price, billedLineAmounts(order).get(line.id), line.is_gift ? 'Sí' : 'No', line.list_unit_price ?? line.unit_price]))] },
  ].map(sheet => ({ ...sheet, rows: sheet.rows.map((row, index) => row.map((value, column) => {
    const numericColumns: Record<string, number[]> = { 'Filtros y resumen': [1], 'Resumen diario': [1], 'Productos mes': [1, 3], 'Ventas por día': [1], 'Puntos': [1, 2, 3, 4, 5], 'Preparación': [3, 5], 'Clientes': [5, 6, 7, 8, 9], 'Cohortes clientes': [1], 'Saldos pedidos': [5, 6, 7, 8], 'Entregados sin cobrar': [4], 'Caja': [3], 'Medios de cobro': [1, 2], 'Efectivo resumen': [1], 'Efectivo por punto': [1, 2, 3, 4], 'Efectivo detalle': [5], 'Stock y mínimos': [3, 4, 5, 6, 8], 'Movimientos stock': [6], 'Pedidos filtrados': [7, 8, 9, 11] };
    return index > 0 && numericColumns[sheet.name]?.includes(column) && typeof value === 'string' && /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) ? excelNumber(value) : value;
  })) }));
}
