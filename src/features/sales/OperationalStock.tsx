import React from 'react';
import { View } from 'react-native';
import { Text } from 'react-native-paper';
import { operationalAvailability, physicalContainers } from '../../lib/availability';
import type { Item, Location, Order, StockBalance } from '../../lib/types';
import { COLORS } from '../../lib/theme';
import { dateLabel, Panel, styles } from './components';

export function OperationalStock({ items, stock, orders, locations, day }: { items: Item[]; stock: StockBalance[]; orders: Order[]; locations: Location[]; day: string }) {
  const groups = operationalAvailability(items, stock, orders, locations, day);
  return <Panel><Text variant="titleMedium">Stock y pendientes · {dateLabel(day)}</Text><Text style={styles.muted}>Pendiente del día disminuye al entregar y aumenta con cada pedido. El stock físico es el actual, no una proyección. Reservas, compromisos y disponible incluyen TODOS los días; no cambian con filtros de cliente, producto, estado o pago.</Text>{groups.map(({ location, products }) => <View key={location.id} style={[styles.lineCard, { borderLeftWidth: 3, borderLeftColor: location.color }]}><Text variant="titleSmall" style={{ color: location.color }}>{location.name}</Text>{products.length ? products.map(row => <View key={row.item.id} style={{ gap: 4, borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 10 }}><Text style={{ fontWeight: '700' }}>{row.item.name} · {row.item.unit}</Text><Text>Pendiente este día: {row.pending} · Reservado este día: {row.selectedReserved} · Faltante este día: {row.selectedShortage}</Text><Text style={styles.muted}>Físico actual: {row.physical}{row.item.package_size ? ` (${physicalContainers(row.physical, row.item.package_size)} envases de ${row.item.package_size} ${row.item.unit})` : ''} · Apto hoy (sin vencidos): {row.usable} · Reservado global: {row.reserved}</Text><Text style={styles.muted}>Comprometido global: {row.committed} · Disponible para nuevos pedidos: {row.available}</Text>{row.shortage !== '0' ? <Text style={{ color: COLORS.danger }}>Faltante global: {row.shortage} {row.item.unit}</Text> : null}{row.belowMinimum ? <Text style={{ color: COLORS.warning }}>Disponible en mínimo o por debajo · mínimo: {row.item.minimum} {row.item.unit}</Text> : null}</View>) : <Text style={styles.muted}>Sin productos.</Text>}</View>)}</Panel>;
}
