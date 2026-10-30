import { ClientEditor } from './ClientEditor';
import { petAgeLabel } from './clientForm';
import React, { useMemo, useState } from 'react';
import { Image, View } from 'react-native';
import { Button, Chip, IconButton, Text, TextInput } from 'react-native-paper';
import { Calendar } from 'react-native-calendars';
import Decimal from '../../lib/decimal';
import { COLORS } from '../../lib/theme';
import { billedLineAmounts } from '../../lib/reports';
import { monthlyClientReport } from '../../lib/calendar';
import { clientHistory, customerActivity, normalizedPhone } from '../../lib/clientHistory';
import type { Client } from '../../lib/types';
import { useWorkspace } from '../../lib/workspace';
import { calendarTheme, currency, dateLabel, dateNow, Empty, Page, palette, Panel, styles } from '../sales/components';
import { RescheduleOrderButton } from '../sales/PickupScheduling';

const monthLabel = (month: string) => new Date(`${month}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });

export default function ClientsScreen() {
  const ws = useWorkspace();
  const [search, setSearch] = useState('');
  const [month, setMonth] = useState(() => dateNow().slice(0, 7));
  const [monthPicker, setMonthPicker] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [draft, setDraft] = useState<Client | 'new' | null>(null);
  const available = ws.isConfigured && ws.isOnline;
  const disabled = !available || ws.isSaving;
  const clients = useMemo(() => (ws.data?.clients ?? []).filter(client => [client.name, client.phone, client.email, client.address, client.notes, ...(client.pets ?? []).map(pet => `${pet.name} ${pet.species ?? ''} ${pet.diet}`)].some(value => value?.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) || (normalizedPhone(search).length >= 3 && normalizedPhone(client.phone).includes(normalizedPhone(search)))).sort((a, b) => a.name.localeCompare(b.name)), [ws.data?.clients, search]);
  const activity = useMemo(() => ws.data ? customerActivity(ws.data, month, dateNow()) : [], [ws.data, month]);
  const edit = (client: Client) => setDraft(client);
  return <Page eyebrow="CLIENTES" title="Cada cliente, su historia." subtitle="Contactos, mascotas y consumo mensual en un solo lugar." action={<Button mode="contained" buttonColor={COLORS.primary} textColor={COLORS.ink} contentStyle={{ minHeight: 48 }} icon="account-plus-outline" disabled={disabled} onPress={() => { setDraft('new'); }}>Nuevo cliente</Button>}>
    <TextInput mode="outlined" accessibilityLabel="Buscar por cliente, contacto o mascota" label="Buscar por cliente, contacto o mascota" left={<TextInput.Icon icon="magnify" />} value={search} onChangeText={setSearch} />
    <Panel><View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}><Text variant="titleMedium">Resumen mensual</Text><Button icon="calendar-month-outline" onPress={() => setMonthPicker(!monthPicker)}>{monthLabel(month)}</Button></View>{monthPicker ? <Calendar current={`${month}-01`} firstDay={1} theme={calendarTheme} onMonthChange={value => setMonth(value.dateString.slice(0, 7))} onDayPress={value => { setMonth(value.dateString.slice(0, 7)); setMonthPicker(false); }} /> : null}<Text style={styles.muted}>Pedidos por fecha de retiro, sin cancelados. El consumo incluye solo entregados y utiliza el precio histórico de cada línea, no el precio actual del catálogo.</Text></Panel>
    {clients.length ? clients.map(client => {
      const report = ws.data ? monthlyClientReport(ws.data, client.id, month) : null;
      const history = ws.data ? clientHistory(ws.data, client.id, month) : null;
      const customer = activity.find(entry => entry.client.id === client.id);
      const open = expanded === client.id;
      return <Panel key={client.id}><View style={[styles.row, { justifyContent: 'space-between' }]}><View style={{ flex: 1, gap: 4 }}><Text variant="titleMedium" style={{ color: palette.ink }}>{client.name}</Text><Text style={styles.muted}>{[client.phone, client.email].filter(Boolean).join(' · ') || 'Sin contacto registrado'}</Text></View><IconButton icon="pencil-outline" accessibilityLabel={`Editar ${client.name}`} disabled={disabled} onPress={() => edit(client)} /><IconButton icon={open ? 'chevron-up' : 'chevron-down'} accessibilityState={{ expanded: open }} accessibilityLabel={`${open ? 'Ocultar' : 'Ver'} detalle de ${client.name}`} onPress={() => setExpanded(open ? null : client.id)} /></View><View style={styles.wrap}><Chip compact>{report?.count ?? 0} pedidos del mes</Chip><Chip compact>{report?.deliveredCount ?? 0} entregados</Chip><Chip compact>{currency(report?.deliveredAmount ?? '0')} consumidos</Chip></View>{open ? <>
        <Text style={styles.muted}>Punto de retiro habitual: {client.preferred_location_id ? ws.data?.locations.find(location => location.id === client.preferred_location_id)?.name ?? 'Punto no disponible' : 'Sin preferencia registrada'}</Text>
        {client.address ? <Text style={styles.muted}>Domicilio: {client.address}</Text> : null}{client.notes ? <Text style={styles.muted}>Notas: {client.notes}</Text> : null}
        <Text style={styles.label}>Actividad del cliente</Text><Text style={styles.muted}>Alta: {customer?.createdOn ? dateLabel(customer.createdOn) : 'Sin fecha registrada'} · Primera compra: {customer?.firstPurchase ? dateLabel(customer.firstPurchase) : 'Sin compra entregada'} · Última compra: {customer?.lastPurchase ? dateLabel(customer.lastPurchase) : 'Sin compra entregada'}</Text><View style={styles.wrap}><Chip compact>{customer?.orderCount ?? 0} pedidos válidos históricos</Chip><Chip compact>{customer?.purchaseCount ?? 0} compras entregadas</Chip><Chip compact>{currency(customer?.totalSales ?? '0')} ventas entregadas</Chip><Chip compact>{customer?.monthlyPurchases ?? 0} compras en el mes</Chip></View><Text style={styles.muted}>Las compras son entregas no devueltas por fecha de retiro. El alta del contacto no se infiere de sus pedidos.</Text>
        <Text style={styles.label}>Cuenta del mes · {monthLabel(month)}</Text>
        <View style={styles.wrap}><Chip compact>{currency(report?.total ?? '0')} en pedidos</Chip><Chip compact>{currency(history?.paid ?? '0')} cobrado neto</Chip><Chip compact>{currency(history?.due ?? '0')} por cobrar</Chip>{new Decimal(history?.credit ?? 0).gt(0) ? <Chip compact>{currency(history?.credit ?? '0')} a favor</Chip> : null}</View>
        <Text style={styles.muted}>Importes de los pedidos con retiro en el mes elegido. Los cobros netos incluyen reintegros y reversiones; no se compensan deudas con saldos de otros pedidos.</Text>
        <Text style={styles.label}>Mascotas</Text>{client.pets?.length ? client.pets.map((pet, i) => <View key={`${pet.name}-${i}`} style={styles.lineCard}><Text style={{ fontWeight: '600', color: palette.ink }}>{pet.species === 'perro' ? '🐶 ' : pet.species === 'gato' ? '🐱 ' : ''}{pet.name}{pet.weight_kg ? ` · ${pet.weight_kg} kg` : ''}</Text>{pet.photo_data_url ? <Image source={{ uri: pet.photo_data_url }} accessibilityLabel={`Foto de ${pet.name}`} style={{ width: 96, height: 96, borderRadius: 12 }} /> : null}{pet.age_years !== undefined ? <Text style={styles.muted}>{petAgeLabel(pet)}</Text> : null}{pet.notes ? <Text style={styles.muted}>Anotaciones: {pet.notes}</Text> : null}<Text style={styles.muted}>{pet.species === 'perro' ? 'Perro' : pet.species === 'gato' ? 'Gato' : 'Especie sin registrar'} · Dieta: {pet.diet || 'Sin especificar'}</Text></View>) : <Text style={styles.muted}>Sin mascotas registradas.</Text>}
        <Text style={styles.label}>Consumo entregado · {monthLabel(month)}</Text>{report?.consumption.length ? report.consumption.map(item => <View key={`${item.product_id}-${item.unit}`} style={[styles.row, { justifyContent: 'space-between' }]}><Text style={{ flex: 1, color: palette.ink }}>{item.name} · {item.quantity} {item.unit}</Text><Text style={styles.muted}>{currency(item.amount)}</Text></View>) : <Text style={styles.muted}>No hay entregas en este mes.</Text>}
        <Text style={styles.label}>Historial de pedidos · {history?.count ?? 0} válidos en total</Text>
        {history?.orders.length ? history.orders.map(({ order, paid, due, credit }) => <View key={order.id} style={styles.lineCard}>
          <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}><Text style={{ color: palette.ink, fontWeight: '600' }}>#{order.id.slice(0, 8)} · {dateLabel(order.pickup_date)}</Text><Chip compact>{order.returned_at ? 'Devuelto' : order.status === 'entregado' ? 'Entregado' : order.status === 'cancelado' ? 'Cancelado' : 'Pendiente de entrega'}</Chip></View>
          <Text style={styles.muted}>{ws.data?.locations.find(location => location.id === order.location_id)?.name ?? 'Punto no disponible'}{order.pickup_time ? ` · ${order.pickup_time}` : ''}</Text>
          {order.lines.map(line => <View key={line.id} style={[styles.row, { justifyContent: 'space-between' }]}><Text style={{ flex: 1, color: palette.ink }}>{line.quantity} {line.product_unit ?? ws.data?.items.find(item => item.id === line.product_id)?.unit ?? 'unidad'} × {line.product_name ?? ws.data?.items.find(item => item.id === line.product_id)?.name ?? 'Producto archivado'}</Text><Text style={styles.muted}>{currency(billedLineAmounts(order).get(line.id) ?? '0')}</Text></View>)}
          <Text style={styles.muted}>Total: {currency(order.total)} · Cobrado neto: {currency(paid)} · Por cobrar: {currency(due)}{new Decimal(credit).gt(0) ? ` · A favor: ${currency(credit)}` : ''}</Text>
          {order.notes ? <Text style={styles.muted}>Notas: {order.notes}</Text> : null}
          <RescheduleOrderButton order={order} />
        </View>) : <Text style={styles.muted}>Este cliente todavía no tiene pedidos asociados.</Text>}
      </> : null}</Panel>;
    }) : <Empty icon="account-search-outline" title="Sin clientes para mostrar" description={search ? 'Probá con otro nombre, contacto o mascota.' : 'Creá un cliente para registrar sus contactos y mascotas.'} />}
    {draft ? <ClientEditor key={draft === 'new' ? 'new' : draft.id} client={draft === 'new' ? undefined : draft} onCancel={() => setDraft(null)} onSaved={(id) => { setExpanded(id); setDraft(null); }} /> : null}
  </Page>;
}
