import React, { useState } from 'react';
import { View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import type { AuditEvent } from '../../lib/types';
import { useWorkspace } from '../../lib/workspace';
import { currency, dateLabel, styles } from './components';
import { saleQuantity } from './orderPresentation';

const operations: Record<string, string> = { delete_order: 'Pedido eliminado', append_spontaneous_sale: 'Venta sumada al pedido', set_order_payment_method: 'Medio de pago actualizado', save_order: 'Pedido guardado', deliver_order: 'Entrega registrada', cancel_order: 'Pedido cancelado', reschedule_order: 'Fecha de retiro modificada', record_payment: 'Pago registrado', record_refund: 'Reintegro registrado', return_order: 'Devolución registrada', reverse_financial_movement: 'Movimiento financiero revertido' };
const fields: Record<string, string> = { client_id: 'Cliente', pickup_date: 'Fecha de retiro', pickup_time: 'Hora de retiro', location_id: 'Punto', sale_kind: 'Tipo de venta', status: 'Estado', payment_status: 'Pago', payment_method: 'Medio de pago', paid_amount: 'Cobrado neto', total: 'Total', lines: 'Productos', notes: 'Notas', transfer_name: 'Nombre de transferencia', uber: 'Retira Uber', packages: 'Bultos totales', prepared_packages: 'Bultos preparados', delivery_notes: 'Preparación / entrega', returned_at: 'Devuelto', return_reason: 'Motivo de devolución', restocked: 'Stock reintegrado' };
const labels: Record<string, string> = { pendiente_entrega: 'Pendiente de entrega', entregado: 'Entregado', cancelado: 'Cancelado', pagado: 'Pagado', no_pagado: 'Por pagar', pedido: 'Pedido', espontanea: 'Venta espontánea', efectivo: 'Efectivo', transferencia: 'Transferencia', gratis: 'Gratis', desconocido: 'Sin definir' };

export function OrderHistory({ orderId }: { orderId: string }) {
  const ws = useWorkspace();
  const [open, setOpen] = useState(false);
  const events = (ws.data?.audit_events ?? []).filter(event => event.entity_id === orderId || event.before_data?.order_id === orderId || event.after_data?.order_id === orderId).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const display = (key: string, value: unknown): string => {
    if (value == null || value === '') return '—';
    if (key === 'client_id') return ws.data?.clients.find(client => client.id === value)?.name ?? 'Cliente no disponible';
    if (key === 'location_id') return ws.data?.locations.find(point => point.id === value)?.name ?? String(value);
    if (key === 'pickup_date') return dateLabel(String(value));
    if (key === 'returned_at') return value ? 'Sí' : 'No';
    if (key === 'total' || key === 'paid_amount') return currency(String(value));
    if (typeof value === 'boolean') return value ? 'Sí' : 'No';
    if (key === 'lines' && Array.isArray(value)) return value.map((line: Record<string, unknown>) => {
      const product = ws.data?.items.find(item => item.id === line.product_id);
      return `${saleQuantity(String(line.quantity ?? 0))} ${line.product_unit ?? product?.unit ?? 'unidad'} × ${line.product_name ?? product?.name ?? 'Producto archivado'} · ${line.is_gift === true ? `Regalo (precio de lista ${currency(String(line.list_unit_price ?? line.unit_price ?? 0))})` : currency(String(line.unit_price ?? 0))}${line.product_package_size ? ` · envase ${line.product_package_size} ${line.product_unit ?? product?.unit ?? ''}` : ''}`;
    }).join('\n') || 'Sin productos';
    return labels[String(value)] ?? String(value);
  };
  const changes = (event: AuditEvent) => Object.entries(fields).flatMap(([key, label]) => {
    const before = event.before_data?.[key];
    const after = event.after_data?.[key];
    if (before === undefined && after === undefined) return [];
    const previous = display(key, before);
    const next = display(key, after);
    return previous !== next ? [{ key, label, previous, next }] : [];
  });
  return <View style={{ gap: 10 }}><Button icon="history" onPress={() => setOpen(current => !current)}>{open ? 'Ocultar historial' : 'Ver historial de modificaciones'} ({events.length})</Button>{open ? events.length ? events.map(event => {
    const actor = ws.data?.members?.find(member => member.id === event.actor_id)?.display_name || (ws.data?.profile?.id === event.actor_id ? ws.data.profile.display_name : event.actor_id) || 'Registro anterior';
    const timestamp = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Mendoza', dateStyle: 'short', timeStyle: 'short' }).format(new Date(event.occurred_at));
    const rows = changes(event);
    return <View key={event.id} style={styles.lineCard}><Text style={{ fontWeight: '700' }}>{operations[event.operation] ?? 'Pedido actualizado'}</Text><Text style={styles.muted}>{timestamp} · {actor}</Text>{event.reason ? <Text style={styles.muted}>{event.reason}</Text> : null}{rows.length ? rows.map(row => <View key={row.key} style={{ gap: 3 }}><Text style={{ fontWeight: '600' }}>{row.label}</Text><Text style={styles.muted}>Antes: {row.previous}</Text><Text>Después: {row.next}</Text></View>) : <Text style={styles.muted}>Registro histórico sin detalle de cambios.</Text>}</View>;
  }) : <Text style={styles.muted}>No hay modificaciones registradas para este pedido.</Text> : null}</View>;
}
