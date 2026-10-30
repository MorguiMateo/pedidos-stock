import { COLORS } from '../../lib/theme';
import React, { useMemo, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import * as Crypto from 'expo-crypto';
import { downloadFile, downloadText } from '../../lib/exportFile';
import { Button, Text } from 'react-native-paper';
import { BarChart, LineChart } from 'react-native-gifted-charts';
import { useWorkspace } from '../../lib/workspace';
import OperationalReports from './OperationalReports';
import FinanceAnalytics from './FinanceAnalytics';
import { buildXlsx } from '../../lib/xlsx';
import { cashCollectionsReport, monthlyReport, snapshotCsv, reportWorksheets } from '../../lib/reports';
import { dailySummary } from '../../lib/daily';
import { DatePicker } from '../sales/components';
import type { FinancialMovement, PaymentMethod } from '../../lib/types';
import { Action, Blank, Card, Form, Heading, Input, Note, Options, Page, Title, d, dateLabel, dateToday, errorText, accent, numberValue, price, s, validDate } from '../stock/featureUi';

type FinanceForm = 'expense' | 'reverse' | null;
const methodNames = { transferencia: 'Transferencia', efectivo: 'Efectivo', desconocido: 'Sin especificar', gratis: 'Gratis' };
const kindNames = { payment: 'Cobro', expense: 'Egreso', refund: 'Reintegro', reversal: 'Reversión' };
export default function ReportsScreen() {
  const workspace = useWorkspace();
  const { data } = workspace;
  const { width } = useWindowDimensions();
  const chartWidth = Math.max(190, Math.min(width - 126, 940));
  const writable = workspace.isConfigured && workspace.isOnline && !workspace.error && data?.profile?.role === 'admin';
  const [month, setMonth] = useState(dateToday().slice(0, 7));
  const [dailyDate, setDailyDate] = useState(dateToday);
  const [cashFrom, setCashFrom] = useState(`${dateToday().slice(0, 7)}-01`);
  const [cashTo, setCashTo] = useState(dateToday);
  const [cashLocation, setCashLocation] = useState('all');
  const [cashLimit, setCashLimit] = useState(30);
  const [location, setLocation] = useState('all');
  const [from, setFrom] = useState(`${dateToday().slice(0, 7)}-01`);
  const [to, setTo] = useState(dateToday);
  const [product, setProduct] = useState('all');
  const [client, setClient] = useState('all');
  const [status, setStatus] = useState('all');
  const [inactivityDays, setInactivityDays] = useState('30');
  const filters = { from, to, product, client, status, location };
  const [form, setForm] = useState<FinanceForm>(null);
  const [selected, setSelected] = useState<FinancialMovement | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('transferencia');
  const [category, setCategory] = useState('Gastos generales');
  const [date, setDate] = useState(dateToday);
  const [notes, setNotes] = useState('');
  const [purchaseId, setPurchaseId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [exporting, setExporting] = useState(false);
  const [ledgerLimit, setLedgerLimit] = useState(30);
  const report = useMemo(() => data ? monthlyReport(data, month, location) : null, [data, month, location]);
  const daily = data && validDate(dailyDate) ? dailySummary(data, dailyDate, location) : null;
  const validCashRange = validDate(cashFrom) && validDate(cashTo) && cashFrom <= cashTo;
  const cashReport = useMemo(() => data && validCashRange ? cashCollectionsReport(data, cashFrom, cashTo, cashLocation) : null, [data, validCashRange, cashFrom, cashTo, cashLocation]);
  function changeMonth(delta: number) { const value = new Date(`${month}-15T12:00:00Z`); value.setUTCMonth(value.getUTCMonth() + delta); setMonth(value.toISOString().slice(0, 7)); setLedgerLimit(30); }
  function expense() { setForm('expense'); setSelected(null); setError(''); setAmount(''); setNotes(''); setDate(dateToday()); setPurchaseId(''); setCategory('Gastos generales'); }
  async function save() {
    if (!writable || workspace.isSaving) return;
    setError('');
    try {
      if (form === 'reverse') {
        if (!selected || !notes.trim()) throw new Error('Ingresá el motivo de reversión.');
        await workspace.command('reverse_financial_movement', { id: selected.id, reason: notes.trim() });
      } else {
        const value = numberValue(amount, 'Importe', { positive: true });
        if (d(value).decimalPlaces() > 2) throw new Error('El importe admite dos decimales.');
        if (!validDate(date)) throw new Error('Ingresá una fecha válida (AAAA-MM-DD).');
        if (!category.trim()) throw new Error('Ingresá una categoría.');
        await workspace.command('record_expense', { amount: value, method, category: category.trim(), occurred_on: date, notes: notes.trim(), ...(purchaseId ? { purchase_id: purchaseId } : {}) });
      }
      setForm(null); setNotice('Movimiento guardado. El registro original y las reversiones conservan trazabilidad.');
    } catch (caught) { setError(errorText(caught)); }
  }
  async function reconcile(movement: FinancialMovement) {
    setError('');
    try { await workspace.command('reconcile_movement', { id: movement.id, reconciled: !movement.reconciled }, movement.version); }
    catch (caught) { setError(errorText(caught)); }
  }
  async function exportData(kind: 'json' | 'csv' | 'xlsx') {
    if (!data || exporting) return;
    setExporting(true); setError('');
    try {
      // A recovery JSON always comes from the server, never from an incomplete cache.
      if (kind === 'json') {
        const full = await workspace.exportData();
        const filename = `pedidos-stock-respaldo-${dateToday()}.json`;
        const payload_hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify(full));
        const body = JSON.stringify({ ...full, integrity: { algorithm: 'SHA-256', payload_hash } }, null, 2) + '\n';
        await downloadText(filename, body, 'application/json;charset=utf-8');
      } else if (kind === 'xlsx') {
        if (!validDate(from) || !validDate(to) || !validDate(dailyDate) || from > to || !validCashRange || !/^\d+$/.test(inactivityDays)) throw new Error('Revisá las fechas y el umbral de días antes de exportar.');
        await downloadFile(`KALAK-informes-${month}.xlsx`, buildXlsx(reportWorksheets(data, month, filters, Number(inactivityDays), dailyDate, { from: cashFrom, to: cashTo, location: cashLocation })), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      } else await downloadText(`pedidos-stock-${dateToday()}.csv`, snapshotCsv(data), 'text/csv;charset=utf-8');
      setNotice(kind === 'json' ? 'Respaldo completo preparado para descargar o compartir.' : kind === 'xlsx' ? 'Excel preparado con todas las hojas del informe y sus filtros.' : 'CSV preparado con catálogo, pedidos, caja, stock, compras y lotes del último estado sincronizado.');
    } catch (caught) { setError(errorText(caught)); } finally { setExporting(false); }
  }
  return <Page refresh={workspace.refresh} loading={workspace.isLoading}>
    <Heading eyebrow="FINANZAS E INFORMES" title="Ventas, caja y cuentas" subtitle="La entrega no confirma un cobro. Cada importe tiene su propio registro." action={<Action icon="minus-circle-outline" disabled={!writable} onPress={expense}>Registrar egreso</Action>} />
    {!writable ? <Note>Modo consulta. Los egresos, reversiones y conciliaciones requieren administración con conexión. Los informes pueden mostrar el último estado sincronizado.</Note> : null}
    {workspace.error ? <Note error>{errorText(workspace.error)}</Note> : null}{error && !form ? <Note error>{error}</Note> : null}{notice ? <Note>{notice}</Note> : null}
    <Card><View style={[s.row, { flexWrap: 'wrap', justifyContent: 'space-between', gap: 4 }]}><Button compact textColor={accent} accessibilityLabel="Mes anterior" onPress={() => changeMonth(-1)}>Anterior</Button><Text style={[s.sectionTitle, { flex: 1, minWidth: 70, textAlign: 'center' }]}>{month}</Text><Button compact textColor={accent} accessibilityLabel="Mes siguiente" onPress={() => changeMonth(1)}>Siguiente</Button></View><Options label="Punto de retiro" values={[{ value: 'all', label: 'Todos los puntos' }, ...(data?.locations ?? []).filter(entry => entry.is_pickup !== false).map(entry => ({ value: entry.id, label: entry.name, color: entry.color }))]} value={location} onChange={setLocation} /></Card>
    {!report ? <Card><Blank title="Sin datos sincronizados" text="Conectá el servidor para consultar tus números." /></Card> : <>
      <View style={s.wrap}><Metric label="Importe de pedidos del mes" value={price(report.total)} caption="No cancelados ni devueltos · fecha de retiro" /><Metric label="Ventas entregadas" value={price(report.delivered)} caption="Fecha de retiro · no equivale a cobrado" /><Metric label="Cobros netos del mes" value={price(report.collections)} caption="Fecha del movimiento · incluye reintegros/reversiones" /><Metric label="Pendiente de cobro" value={price(report.receivableTotal)} caption="Todos los períodos · no solo este mes" /></View>
      <View style={s.wrap}><Metric label="Pedidos válidos" value={String(report.count)} caption={`${report.uniqueClients} clientes únicos · ${report.deliveredCount} entregados · ${report.pendingCount} pendientes`} /></View>
      <Card>
        <Title caption="Solo cobros y reintegros efectivos en efectivo; no ventas previstas ni transferencias. Independiente del mes y los demás filtros.">Efectivo cobrado por punto</Title>
        <DatePicker label="Efectivo · desde (inclusive)" value={cashFrom} onChange={value => { setCashFrom(value); setCashLimit(30); }} />
        <DatePicker label="Efectivo · hasta (inclusive)" value={cashTo} onChange={value => { setCashTo(value); setCashLimit(30); }} />
        <Options label="Punto del cobro en efectivo" values={[{ value: 'all', label: 'Todos los puntos' }, ...(data?.locations ?? []).filter(entry => entry.is_pickup !== false).map(entry => ({ value: entry.id, label: entry.name, color: entry.color }))]} value={cashLocation} onChange={value => { setCashLocation(value); setCashLimit(30); }} />
        {!validCashRange ? <Note error>La fecha desde debe ser anterior o igual a la fecha hasta.</Note> : cashReport ? <>
          <Text style={s.caption}>{dateLabel(cashFrom)} al {dateLabel(cashTo)} · ambas fechas incluidas · por fecha efectiva del movimiento.</Text>
          <View style={s.wrap}><Metric label="Efectivo recibido" value={price(cashReport.received)} caption="Entradas efectivas; incluye reversiones de reintegros" /><Metric label="Reintegros / correcciones" value={price(cashReport.refunds)} caption="Salidas y contramovimientos" /><Metric label="Efectivo neto cobrado" value={price(cashReport.net)} caption="Recibido menos reintegros / correcciones; no descuenta gastos" /></View>
          {cashReport.byLocation.map(point => <View key={point.id ?? 'unattributed'} style={[s.line, { borderTopColor: `${point.color}66` }]}><Text style={[s.smallTitle, { color: point.color }]}>{point.name} · Neto {price(point.net)}</Text><Text style={s.caption}>Recibido {price(point.received)} · Reintegros / correcciones {price(point.refunds)} · {point.count} movimientos</Text></View>)}
          {!cashReport.entries.length ? <Blank title="Sin cobros en efectivo en este período y punto" text="Los pedidos por pagar, transferencias y medios previstos no se cuentan como efectivo cobrado." /> : <>
            <Text style={s.smallTitle}>Detalle de efectivo</Text>
            {[...cashReport.entries].sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.created_at.localeCompare(a.created_at)).slice(0, cashLimit).map(entry => <View key={entry.id} style={s.line}><View style={s.row}><View style={s.grow}><Text style={s.smallTitle}>{entry.client} · {entry.location_name}</Text><Text style={s.caption}>{dateLabel(entry.occurred_on)} · {kindNames[entry.kind]}{entry.reverses_id ? ' / corrección' : ''} · {entry.reconciled ? 'Conciliado' : 'Sin conciliar'}</Text>{entry.order ? <Text style={s.caption}>Pedido {entry.order.id.slice(0, 8)} · Retiro {dateLabel(entry.order.pickup_date)}</Text> : <Text style={s.caption}>Sin pedido asociado</Text>}{entry.notes ? <Text style={s.caption}>{entry.notes}</Text> : null}</View><Text style={[s.smallTitle, d(entry.amount).lt(0) && s.danger]}>{price(entry.amount)}</Text></View></View>)}
            {cashReport.entries.length > cashLimit ? <Button textColor={accent} onPress={() => setCashLimit(limit => limit + 30)}>Ver más cobros en efectivo</Button> : null}
          </>}
        </> : null}
      </Card>
      <Card><Title caption="Fecha elegida y filtro de punto actual; independiente del mes del informe">Resumen diario</Title><Input label="Día a consultar (AAAA-MM-DD)" value={dailyDate} onChange={setDailyDate} />{daily ? <View style={s.wrap}><Metric label="Pedidos del día" value={String(daily.count)} caption={`Importe: ${price(daily.sales)} · Entregados: ${price(daily.delivered)}`} /><Metric label="Cobros netos del día" value={price(daily.collections)} caption="Por fecha efectiva de cobro / reintegro" /><Metric label="Egresos del día" value={price(daily.expenses)} caption="Gastos y pagos registrados" /><Metric label="Flujo de caja del día" value={price(daily.cashNet)} caption="No equivale a utilidad" /></View> : <Note error>Elegí una fecha válida para consultar el resumen diario.</Note>}</Card>
      <Card><Title caption="Importe de pedidos no cancelados ni devueltos, por fecha de retiro">Evolución mensual</Title>{report.days.length ? <View style={{ paddingTop: 12, overflow: 'hidden' }}><LineChart data={report.days.map(day => ({ value: d(day.total).toNumber(), label: day.date.slice(8), dataPointText: price(day.total) }))} width={chartWidth} height={180} color={COLORS.primary} thickness={3} areaChart startFillColor={COLORS.primary} endFillColor={COLORS.surface} startOpacity={0.5} endOpacity={0.1} yAxisTextStyle={{ color: COLORS.muted, fontSize: 10 }} xAxisLabelTextStyle={{ color: COLORS.muted, fontSize: 10 }} hideDataPoints noOfSections={4} yAxisThickness={0} xAxisThickness={0} rulesColor={COLORS.border} adjustToWidth /></View> : <Blank title="Este mes no tiene pedidos" text="La evolución aparece con los pedidos del período." />}</Card>
      <Card><Title caption="Todos los puntos configurados, incluidos los históricos del período">Comparación por punto</Title>{d(report.total).gt(0) ? <View style={{ overflow: 'hidden' }}><BarChart data={report.byLocation.map(entry => ({ value: d(entry.total).toNumber(), label: entry.name, frontColor: entry.color }))} width={chartWidth} height={160} barWidth={Math.min(48, chartWidth / Math.max(report.byLocation.length * 2, 6))} spacing={22} noOfSections={3} yAxisThickness={0} xAxisThickness={0} rulesColor={COLORS.border} yAxisTextStyle={{ color: COLORS.muted, fontSize: 10 }} xAxisLabelTextStyle={{ color: COLORS.muted, fontSize: 10 }} /></View> : <Text style={s.caption}>Sin importes en este período.</Text>}{report.byLocation.map(entry => <View key={entry.id} style={s.row}><Text style={[s.smallTitle, s.grow, { color: entry.color }]}>{entry.name}</Text><View><Text>{price(entry.total)}</Text><Text style={s.caption}>{entry.count} pedidos · {entry.uniqueClients} clientes · {entry.deliveredCount} entregados · {entry.pendingCount} pendientes</Text></View></View>)}</Card>
      <Card><Title caption="Caja por fecha efectiva de movimiento">Ingresos y egresos</Title><View style={s.wrap}><Metric label="Egresos netos" value={price(report.expenses)} caption={location === 'all' ? 'Pagos a proveedores y gastos registrados' : 'Los egresos generales se muestran en Todos los puntos'} /><Metric label="Flujo neto" value={price(report.cashNet)} caption="Cobros menos egresos, no utilidad" /></View>{report.byPaymentMethod.map(entry => <Text key={entry.method} style={s.caption}>{methodNames[entry.method]} · Cobros netos {price(entry.collections)} · Flujo neto {price(entry.net)}</Text>)}<Note>Los cobros se registran en el detalle del pedido. La caja incluye únicamente movimientos efectivamente registrados.</Note></Card>
      <Card><Title caption="Saldo actual por pedido, incluyendo anticipos">Cuentas pendientes y saldos a favor</Title>{!report.receivables.length ? <Blank title="Sin saldos pendientes registrados" text="Los pedidos sin cobro y los reintegros pendientes de pedidos cancelados o devueltos aparecen aquí." /> : report.receivables.map(entry => <View key={entry.order.id} style={[s.line, s.row]}><View style={s.grow}><Text style={s.smallTitle}>{entry.client} · {entry.order.id.slice(0, 8)}</Text><Text style={s.caption}>{entry.order.returned_at ? 'Devuelto · reintegro pendiente' : `Retiro ${dateLabel(entry.order.pickup_date)}`} · Total {price(entry.order.total)} · Cobrado neto {price(entry.paid)}</Text></View><Text style={[s.smallTitle, d(entry.pending).gt(0) && s.danger]}>{d(entry.credit).gt(0) ? `A devolver / a favor ${price(entry.credit)}` : `Debe ${price(entry.pending)}`}</Text></View>)}</Card>
      <Card><Title caption="Todos los períodos; entrega confirmada no equivale a cobro">Entregados pendientes de cobro</Title>{!report.deliveredUnpaid.length ? <Text style={s.caption}>Sin deuda en pedidos entregados.</Text> : report.deliveredUnpaid.map(entry => <View key={entry.order.id} style={s.line}><Text style={s.smallTitle}>{entry.client} · Debe {price(entry.pending)}</Text><Text style={s.caption}>{dateLabel(entry.order.pickup_date)} · {data?.locations.find(location => location.id === entry.order.location_id)?.name ?? entry.order.location_id}</Text></View>)}</Card>
      <Card><Title caption="Pedidos válidos por retiro, incluidos pendientes y regalos. Ventas efectivas en Productos vendidos por punto y mes">Productos del mes</Title>{report.products.map(product => <View key={product.id} style={[s.line, s.row]}><Text style={[s.smallTitle, s.grow]}>{product.name} · {product.units} {product.unit}</Text><Text>{price(product.total)}</Text></View>)}<Text style={s.smallTitle}>TOTAL GENERAL: {price(report.total)}</Text><Text style={s.caption}>Pendientes de entrega {price(report.pending)} · Cancelados {price(report.cancelled)} · Devueltos {price(report.returned)}</Text></Card>
      {data ? <FinanceAnalytics data={data} month={month} location={location} /> : null}
      {data ? <OperationalReports data={data} month={month} filters={filters} onChange={next => { setFrom(next.from); setTo(next.to); setProduct(next.product); setClient(next.client); setStatus(next.status); }} inactivityDays={inactivityDays} onInactivityDays={setInactivityDays} /> : null}
      <Card><Title caption="Compará con banco o efectivo y marcá solo lo verificado">Conciliación de caja</Title>{!report.movements.length ? <Blank title="Sin movimientos de caja este mes" text="Los cobros, reintegros, pagos y gastos se registran por separado de los pedidos." /> : [...report.movements].sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.created_at.localeCompare(a.created_at)).slice(0, ledgerLimit).map(movement => {
        const reversed = (data?.financial_movements ?? []).some(row => row.reverses_id === movement.id);
        return <View key={movement.id} style={s.line}><View style={s.row}><View style={s.grow}><Text style={s.smallTitle}>{kindNames[movement.kind]} · {movement.category || 'Sin categoría'}</Text><Text style={s.caption}>{dateLabel(movement.occurred_on)} · {methodNames[movement.method]} · {movement.reconciled ? 'Conciliado' : 'Sin conciliar'}</Text><Text style={s.caption}>{movement.notes || 'Sin nota'}{movement.order_id ? ` · Pedido ${movement.order_id.slice(0, 8)}` : ''}{movement.purchase_id ? ` · Compra ${movement.purchase_id.slice(0, 8)}` : ''}</Text></View><Text style={[s.smallTitle, d(movement.amount).lt(0) && s.danger]}>{price(movement.amount)}</Text></View><View style={s.wrap}><Button disabled={!writable || workspace.isSaving} textColor={accent} onPress={() => { void reconcile(movement); }}>{movement.reconciled ? 'Desmarcar conciliación' : 'Marcar conciliado'}</Button>{!reversed && !movement.reverses_id ? <Button disabled={!writable || workspace.isSaving} textColor={COLORS.danger} onPress={() => { setSelected(movement); setNotes(''); setError(''); setForm('reverse'); }}>Revertir con motivo</Button> : <Text style={s.caption}>{reversed ? 'Revertido' : 'Contramovimiento'}</Text>}</View></View>;
      })}{report.movements.length > ledgerLimit ? <Button textColor={accent} onPress={() => setLedgerLimit(limit => limit + 30)}>Ver más movimientos</Button> : null}</Card>
      <Card><Title caption="Tu información, en formatos portables">Exportar y respaldar</Title><View style={s.wrap}><Action secondary disabled={!writable || exporting} loading={exporting} onPress={() => { void exportData('json'); }}>Respaldo completo JSON</Action><Action secondary disabled={!data || exporting} onPress={() => { void exportData('xlsx'); }}>Exportar Excel (.xlsx)</Action><Action secondary disabled={!data || exporting} onPress={() => { void exportData('csv'); }}>Datos completos CSV</Action></View><Text style={s.caption}>JSON: respaldo completo del servidor para recuperación. Excel: informes con sus filtros y todas las hojas. CSV: datos del último estado sincronizado para planillas (separador ;). En web se descarga el archivo; en el celular se comparte un archivo Excel, JSON o CSV que podés guardar fuera del dispositivo. Actualizado: {data ? dateLabel(data.updated_at) : '—'}.</Text></Card>
    </>}
    <Form visible={form !== null} title={form === 'reverse' ? 'Revertir movimiento de caja' : 'Registrar pago / gasto'} close={() => setForm(null)} save={() => { void save(); }} saving={workspace.isSaving} disabled={!writable} error={error} submitLabel={form === 'reverse' ? 'Crear reversión' : 'Registrar egreso'}>
      {form === 'expense' ? <><Input label="Importe ($)" value={amount} onChange={setAmount} numeric /><Options label="Medio de pago" values={([{ value: 'transferencia', label: 'Transferencia' }, { value: 'efectivo', label: 'Efectivo' }] as const).map(value => ({ ...value }))} value={method} onChange={setMethod} /><Input label="Categoría" value={category} onChange={setCategory} /><Input label="Fecha del pago (AAAA-MM-DD)" value={date} onChange={setDate} /><Input label="Notas / comprobante" value={notes} onChange={setNotes} multiline /><Note>Se registra una salida de dinero. No modifica existencias ni el estado de un pedido.</Note></> : <><Note>El original no se borra. Se crea un contramovimiento de igual importe con signo opuesto.</Note><Text>{selected ? `${dateLabel(selected.occurred_on)} · ${price(selected.amount)}` : ''}</Text><Input label="Motivo obligatorio" value={notes} onChange={setNotes} multiline /></>}
    </Form>
  </Page>;
}
function Metric({ label, value, caption }: { label: string; value: string; caption: string }) { return <View style={[s.summary, { alignSelf: 'stretch' }]}><Text style={s.metricLabel}>{label}</Text><Text style={s.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.7}>{value}</Text><Text style={s.caption}>{caption}</Text></View>; }
