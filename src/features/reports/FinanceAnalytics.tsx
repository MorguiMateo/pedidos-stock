import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, TouchableOpacity, View } from 'react-native';
import { Text } from 'react-native-paper';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { breakEven, consumptionForecast, financeHistory, financeMonth, parseBreakEvenDrafts, type BreakEvenInputs } from '../../lib/financeAnalytics';
import { monthLabel } from '../../lib/format';
import type { Snapshot } from '../../lib/types';
import { COLORS } from '../../lib/theme';
import { Blank, Card, Input, Note, Options, Title, dateLabel, price, s } from '../stock/featureUi';

type Props = { data: Snapshot; month: string; location: string };
const comparisons = [{ value: 'revenue', label: 'Ventas entregadas ($)' }, { value: 'orders', label: 'Pedidos válidos' }, { value: 'clients', label: 'Clientes únicos' }, { value: 'averageTicket', label: 'Ticket promedio ($)' }];
export default function FinanceAnalytics({ data, month, location }: Props) {
  const report = useMemo(() => financeMonth(data, month, location), [data, month, location]);
  const history = useMemo(() => financeHistory(data, month, location), [data, month, location]);
  const forecast = useMemo(() => consumptionForecast(data, month, location), [data, month, location]);
  const [selectedDate, setDate] = useState('');
  const [comparison, setComparison] = useState('revenue');
  const [productKey, setProduct] = useState('');
  const day = report.days.find(day => day.date === selectedDate) ?? report.days.find(day => day.count > 0) ?? report.days[0];
  const product = forecast.rows.find(row => row.key === productKey) ?? forecast.rows[0];
  const metric = (row: (typeof history)[number]) => comparison === 'orders' ? row.orders : comparison === 'clients' ? row.clients : comparison === 'averageTicket' ? row.averageTicket : row.revenue;
  const maximum = Math.max(1, ...history.map(row => Number(metric(row) ?? 0)));
  const forecastMax = Math.max(1, ...(product?.values.map(Number) ?? []), Number(product?.forecast ?? 0));
  const offset = (new Date(`${month}-01T12:00:00Z`).getUTCDay() + 6) % 7;
  const cells = [...Array.from({ length: offset }, () => null), ...report.days];
  const weeks = Array.from({ length: Math.ceil(cells.length / 7) }, (_, index) => Array.from({ length: 7 }, (_, weekday) => cells[index * 7 + weekday] ?? null));
  return <>
    <Card><Title caption={`${report.sales} pedidos entregados no gratis · importe facturado / pedidos · no equivale a cobros`}>Ticket promedio mensual</Title><Text style={s.value}>{report.averageTicket === null ? 'Sin ventas entregadas' : price(report.averageTicket)}</Text><Text style={s.caption}>{report.clients} clientes únicos del mes con pedido válido. Se deduplican por ID; anónimos excluidos. Un cliente puede retirar en varios puntos.</Text></Card>
    <Card><Title caption="Fecha de retiro · pendientes y entregados, sin cancelados ni devueltos. Son pedidos, no cobros.">Calendario financiero de pedidos</Title><Text style={s.smallTitle}>{monthLabel(month)}</Text>
      <View style={{ flexDirection: 'row' }}>{['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((name, index) => <Text key={index} style={{ flex: 1, textAlign: 'center', paddingVertical: 8 }}>{name}</Text>)}</View>
      {weeks.map((week, index) => <View key={index} style={{ flexDirection: 'row', gap: 2, marginBottom: 2 }}>{week.map((date, weekday) => date ? <TouchableOpacity key={date.date} accessibilityRole="button" accessibilityState={{ selected: day?.date === date.date }} accessibilityLabel={`${dateLabel(date.date)}: ${date.count} pedidos`} onPress={() => setDate(date.date)} style={{ flex: 1, minHeight: 68, padding: 4, borderRadius: 6, borderWidth: 1, borderColor: day?.date === date.date ? COLORS.primary : COLORS.border, backgroundColor: day?.date === date.date ? COLORS.orangeSoft : COLORS.surface }}><Text style={{ fontWeight: '700', fontSize: 12 }}>{Number(date.date.slice(8))}</Text>{date.points.map(point => <Text key={point.id} numberOfLines={1} style={{ color: point.color, fontSize: 10 }}>{point.name}: {point.count}</Text>)}</TouchableOpacity> : <View key={`blank-${weekday}`} style={{ flex: 1 }} />)}</View>)}
      {day ? <View style={{ gap: 6, paddingTop: 12 }}><Text style={s.smallTitle}>{dateLabel(day.date)} · {day.count} pedidos</Text>{day.points.length ? day.points.map(point => <Text key={point.id} style={{ color: point.color }}>{point.name}: {point.count} pedidos</Text>) : <Text style={s.caption}>Sin pedidos válidos en este día.</Text>}</View> : null}
    </Card>
    <Card><Title caption="Solo entregados · cantidades e importe histórico por retiro. Regalos/muestras separados; no se mezclan unidades.">Productos vendidos por punto y mes</Title>
      <DataTable headers={['Punto', 'Producto', 'Vendidos', 'Regalos / muestras', 'Importe']} rows={report.products.map(row => ({ key: row.key, values: [row.location, row.name, `${row.sold} ${row.unit}`, `${row.gifts} ${row.unit}`, price(row.revenue)] }))} empty="Sin productos entregados este mes." />
    </Card>
    <Card><Title caption="Clientes con pedido válido del mes, incluidos pendientes. Ticket solo sobre pedidos entregados no gratis.">Clientes y ticket por punto</Title><DataTable headers={['Punto', 'Clientes únicos', 'Pedidos', 'Ventas entregadas', 'Ticket promedio']} rows={report.points.map(point => ({ key: point.id, values: [point.name, String(point.clients), String(point.orders), price(point.revenue), point.averageTicket === null ? '—' : price(point.averageTicket)] }))} /><Text style={s.caption}>No sumes clientes entre puntos: pueden repetirse. Total único del mes: {report.clients}.</Text></Card>
    <Card><Title caption="Seis meses por fecha de retiro y punto elegido. El mes en curso puede estar incompleto. Ticket sin ventas: sin datos.">Comparación mes a mes</Title><Options label="Métrica a comparar" values={comparisons} value={comparison} onChange={setComparison} />
      {history.map(row => { const value = metric(row); return <View key={row.month} style={{ gap: 6, paddingTop: 12 }}><Text>{monthLabel(row.month)} · {value === null ? 'Sin datos' : comparison === 'revenue' || comparison === 'averageTicket' ? price(String(value)) : value}</Text><View style={{ height: 14, borderRadius: 6, backgroundColor: COLORS.border }}><View style={{ height: 14, borderRadius: 6, backgroundColor: COLORS.primary, width: `${Number(value ?? 0) / maximum * 100}%` }} /></View></View>; })}
    </Card>
    <Card><Title caption={`Estimación para ${monthLabel(forecast.forecastMonth)}: promedio simple de ${forecast.months.join(', ')}. Solo meses completos; incluye ceros desde la primera entrega. Sin ajuste estacional ni garantía de demanda.`}>Pronóstico de consumo</Title>
      {!product ? <Blank title="Sin historial en meses completos" text="El pronóstico requiere entregas anteriores al mes en curso." /> : <><Options label="Producto del pronóstico" value={product.key} onChange={setProduct} values={forecast.rows.map(row => ({ value: row.key, label: `${row.name} (${row.unit})` }))} /><View style={{ flexDirection: 'row', gap: 8, paddingVertical: 14 }}>{[...product.values, product.forecast].map((value, index) => <View key={index} style={{ flex: 1, gap: 8 }}><Text style={{ fontSize: 11, textAlign: 'center' }}>{value === null ? 'Sin datos' : `${value} ${product.unit}`}</Text><View style={{ height: 125, backgroundColor: COLORS.background, justifyContent: 'flex-end' }}><View style={{ height: `${value === null ? 0 : Number(value) / forecastMax * 100}%`, backgroundColor: index === 3 ? COLORS.orangeSoft : COLORS.muted, ...(index === 3 ? { borderWidth: 1, borderStyle: 'dashed', borderColor: COLORS.primary } : {}) }} /></View><Text style={{ fontSize: 10, textAlign: 'center' }}>{index === 3 ? `Estimado ${forecast.forecastMonth}` : forecast.months[index]}</Text></View>)}</View><Text style={s.caption}>{product.forecast === null ? 'Historial insuficiente: se necesitan tres meses completos desde la primera entrega observada del producto y unidad.' : `Consumo estimado: ${product.forecast} ${product.unit}. Demanda física entregada, incluidos regalos; no descuenta stock.`}</Text></>}
    </Card>
    <BreakEvenPanel key={data.profile?.id ?? 'local'} data={data} />
  </>;
}
function DataTable({ headers, rows, empty = 'Sin registros.' }: { headers: string[]; rows: { key: string; values: string[] }[]; empty?: string }) {
  if (!rows.length) return <Text style={s.caption}>{empty}</Text>;
  return <ScrollView horizontal accessibilityLabel={headers.join(', ')}><View><View style={{ flexDirection: 'row', backgroundColor: COLORS.background }}>{headers.map(header => <Text key={header} style={{ width: 135, padding: 10, fontWeight: '700', fontSize: 12 }}>{header}</Text>)}</View>{rows.map(row => <View key={row.key} style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.border }}>{row.values.map((value, index) => <Text key={index} style={{ width: 135, padding: 10, fontSize: 12 }}>{value}</Text>)}</View>)}</View></ScrollView>;
}
function BreakEvenPanel({ data }: { data: Snapshot }) {
  const storageKey = `kalak.break-even.v1.${data.profile?.id ?? 'local'}`;
  const [drafts, setDrafts] = useState<Record<string, BreakEvenInputs>>({});
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const saveQueue = useRef(Promise.resolve());
  const [selectedProduct, setProduct] = useState('');
  const products = data.items.filter(item => item.kind === 'product');
  const product = products.find(item => item.id === selectedProduct) ?? products[0];
  useEffect(() => { let active = true; void AsyncStorage.getItem(storageKey).then(raw => { if (active) { setDrafts(parseBreakEvenDrafts(raw)); setReady(true); } }).catch(() => { if (active) { setReady(true); setStorageError(true); } }); return () => { active = false; }; }, [storageKey]);
  function update(value: BreakEvenInputs) {
    if (!product || !ready) return;
    const next = { ...drafts, [product.id]: value }; setDrafts(next);
    // Serialize writes so an older keystroke cannot overwrite the final scenario.
    saveQueue.current = saveQueue.current.then(() => AsyncStorage.setItem(storageKey, JSON.stringify(next))).then(() => { setStorageError(false); }).catch(() => { setStorageError(true); });
  }
  const inputs = product ? drafts[product.id] ?? { fixed: '', variable: '', price: product.price } : { fixed: '', variable: '', price: '' };
  const result = breakEven(inputs);
  return <Card><Title caption="Simulación mensual por unidad comercial. Ingresá costos reales; no se inventan costos. Cada producto tiene su propio escenario, guardado solo en este dispositivo, sin sincronización.">Punto de equilibrio por producto</Title>
    {storageError ? <Note error>No se pudo guardar o leer el escenario local. Podés calcular durante esta sesión.</Note> : null}
    {!product ? <Text style={s.caption}>Agregá productos para calcular su equilibrio.</Text> : !ready ? <Text style={s.caption}>Cargando escenarios…</Text> : <><Options label="Producto a calcular" values={products.map(item => ({ value: item.id, label: `${item.name} (${item.unit})${!item.active ? ' · Archivado' : ''}` }))} value={product.id} onChange={setProduct} /><Input label="Costo fijo mensual asignado ($)" numeric value={inputs.fixed} onChange={fixed => update({ ...inputs, fixed })} /><Input label={`Costo variable por ${product.unit} ($)`} numeric value={inputs.variable} onChange={variable => update({ ...inputs, variable })} /><Input label={`Precio por ${product.unit} ($)`} numeric value={inputs.price} onChange={price => update({ ...inputs, price })} />
      {result.error ? <Text style={s.caption}>{result.error}</Text> : <Text style={s.smallTitle}>Equilibrio: {product.unit === 'unidad' ? result.units : result.exactUnits} {product.unit} / mes</Text>}{result.contribution !== null ? <Text>Contribución: {price(result.contribution)} / {product.unit} · Margen: {result.margin}%</Text> : null}
      <Text style={s.caption}>Costo fijo / (precio − costo variable). Redondeo hacia arriba: unidades enteras o 0,01 para otras unidades. Distribuí los costos fijos entre productos para no duplicarlos. Es una simulación, no una utilidad real.</Text>
    </>}
  </Card>;
}
