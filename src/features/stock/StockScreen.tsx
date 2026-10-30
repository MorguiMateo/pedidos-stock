import React, { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { router } from 'expo-router';
import ProductionScreen from '../production/ProductionScreen';
import { useWorkspace } from '../../lib/workspace';
import type { Item, Movement, StockBalance } from '../../lib/types';
import { Action, Blank, Card, Form, Heading, Input, Note, Options, Page, Title, d, errorText, numberValue, qty, s, dateLabel } from './featureUi';

type Draft = { kind: 'initial' | 'adjust' | 'transfer' | 'reverse'; item_id: string; location_id: string; to: string; quantity: string; reason: string; movement?: Movement };
const movementNames: Record<string, string> = { adjustment: 'Ajuste', adjust: 'Ajuste', transfer_in: 'Transferencia recibida', transfer_out: 'Transferencia enviada', delivery: 'Entrega', order_delivery: 'Entrega', delivery_edit: 'Edición de pedido entregado', reversal: 'Reversión' };

export default function StockScreen() {
  const ws = useWorkspace();
  const admin = ws.data?.profile?.role === 'admin';
  const writable = admin && ws.isOnline && ws.isConfigured && !ws.error;
  const [location, setLocation] = useState('');
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [limit, setLimit] = useState(30);
  const locations = ws.data?.locations ?? [];
  const products = (ws.data?.items ?? []).filter(item => item.kind === 'product');
  const active = products.filter(item => item.active);
  const options = locations.map(item => ({ value: item.id, label: item.name, color: item.color }));
  useEffect(() => { if (!locations.some(item => item.id === location)) setLocation(ws.data?.profile?.location_id ?? locations[0]?.id ?? ''); }, [ws.data?.locations, ws.data?.profile?.location_id, location]);
  const stock = (product: string, point: string): StockBalance => ws.data?.stock.find(row => row.item_id === product && row.location_id === point) ?? { item_id: product, location_id: point, on_hand: '0', reserved: '0', shortage: '0' };
  const visible = products.filter(item => (item.active || showInactive) && item.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const movements = [...(ws.data?.movements ?? [])].filter(movement => movement.location_id === location && visible.some(item => item.id === movement.item_id)).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const target = products.find(item => item.id === draft?.item_id);
  const open = (kind: Draft['kind'], item?: Item, movement?: Movement) => {
    setError(''); setNotice('');
    const physicalLocation = locations.find(point => point.id === location && point.is_pickup !== false && point.id !== 'cocina')?.id ?? locations.find(point => point.is_pickup !== false && point.id !== 'cocina' && point.active !== false)?.id ?? '';
    setDraft({ kind, item_id: item?.id ?? movement?.item_id ?? '', location_id: movement?.location_id ?? physicalLocation, to: locations.find(point => point.id !== physicalLocation && point.id !== 'cocina' && point.is_pickup !== false && point.active !== false)?.id ?? '', quantity: '', reason: '', movement });
  };
  const save = async () => {
    if (!draft || !writable || busy || ws.isSaving) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (draft.kind === 'transfer' && !draft.reason.trim()) throw new Error('Ingresá un motivo para conservar el historial.');
      if (draft.kind === 'reverse') {
        if (!draft.movement) throw new Error('Elegí el movimiento a revertir.');
        await ws.command('reverse_movement', { id: draft.movement.id, reason: 'Reversión de movimiento de stock' });
      } else {
        if (!target || !locations.some(point => point.id === draft.location_id && point.active !== false)) throw new Error('Elegí un producto y una ubicación activa.');
        const value = numberValue(draft.quantity, 'Cantidad', { integer: target.unit === 'unidad', ...(draft.kind === 'adjust' ? { nonzero: true } : { positive: true }) });
        if (draft.kind === 'transfer') {
          if (draft.to === draft.location_id || !locations.some(point => point.id === draft.to && point.active !== false)) throw new Error('Elegí un destino activo diferente del origen.');
          const origin = stock(target.id, draft.location_id);
          if (d(value).gt(d(origin.usable ?? origin.on_hand).minus(origin.reserved))) throw new Error('No alcanza el stock libre del origen; no se puede transferir lo reservado ni los lotes vencidos.');
          await ws.command('transfer_stock', { item_id: target.id, from_location_id: draft.location_id, to_location_id: draft.to, quantity: value, reason: draft.reason.trim() });
        } else {
          await ws.command('adjust_stock', { item_id: target.id, location_id: draft.location_id, quantity: value, reason: draft.kind === 'initial' ? 'Inventario inicial' : 'Ajuste de inventario' });
        }
      }
      setDraft(null); setNotice('Movimiento guardado. El stock y las reservas se actualizaron.');
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return <Page refresh={ws.refresh} loading={ws.isLoading}>
    <Heading eyebrow="INVENTARIO" title="Stock por ubicación" subtitle="Stock físico, reservas y disponibilidad para nuevos pedidos." action={admin ? <Action icon="plus" disabled={!writable} onPress={() => open('initial')}>Inventario inicial</Action> : undefined} />
    {ws.error ? <Note error>{errorText(ws.error)}</Note> : null}{notice ? <Note>{notice}</Note> : null}
    {!admin ? <Note>Consulta de stock de tu punto. Las cargas iniciales, ajustes y transferencias los registra una administradora.</Note> : !ws.isOnline ? <Note>Sin conexión: podés consultar la información de esta sesión, pero no guardar cambios.</Note> : null}
    <Options label="Ubicación" values={options} value={location} onChange={setLocation} />
    {location === 'cocina' ? <><ProductionScreen embedded />
      {(ws.data?.stock ?? []).some(balance => balance.location_id === 'cocina' && d(balance.on_hand).gt(0) && products.some(item => item.id === balance.item_id)) ? <Card><Title>Stock anterior en cocina</Title><Text>Estos saldos reales son anteriores a la planificación. Trasladalos al punto que los reciba; no se suman a la producción prevista.</Text>{products.filter(item => d(stock(item.id, 'cocina').on_hand).gt(0)).map(item => <View key={item.id} style={s.line}><Text>{item.name}: {qty(stock(item.id, 'cocina').on_hand)} {item.unit}</Text>{admin ? <Button disabled={!writable} onPress={() => { open('transfer', item); setDraft(current => current ? { ...current, location_id: 'cocina' } : current); }}>Trasladar a un punto</Button> : null}</View>)}</Card> : null}
    </> : <>
    <Input label="Buscar producto" value={search} onChange={setSearch} />
    {admin ? <Button onPress={() => setShowInactive(value => !value)}>{showInactive ? 'Ocultar productos inactivos' : 'Ver productos inactivos'}</Button> : null}
    {admin ? <View style={s.wrap}><Action secondary icon="swap-horizontal" disabled={!writable || !active.length} onPress={() => open('transfer')}>Transferir a un punto</Action><Action secondary icon="pencil-outline" disabled={!writable || !active.length} onPress={() => open('adjust')}>Ajustar inventario</Action><Button onPress={() => router.push('/settings')}>Administrar catálogo</Button></View> : null}
    <Card><Title caption="Las cantidades están expresadas en la unidad comercial del producto: kg o unidad.">Existencias</Title>
      {!visible.length ? <Blank title="Sin productos" text="Creá el catálogo en Ajustes y cargá el inventario inicial, sin necesidad de recetas ni compras." /> : visible.map(item => {
        const row = stock(item.id, location);
        const free = d(row.usable ?? row.on_hand).minus(row.reserved);
        const low = free.lte(item.minimum);
        return <View key={item.id} style={s.line}><Text style={s.smallTitle}>{item.name}{!item.active ? ' · Inactivo' : ''}</Text>
          <Text style={s.caption}>{item.presentation || 'Sin presentación configurada'}{item.package_size ? ` · ${qty(item.package_size)} ${item.unit} por envase` : ''}</Text>
          <View style={s.wrap}><Text style={s.stat}>Físico: {qty(row.on_hand)} {item.unit}</Text><Text style={s.stat}>Reservado: {qty(row.reserved)} {item.unit}</Text><Text style={[s.stat, low ? s.statLow : s.statOk]}>Disponible: {qty(free.toString())} {item.unit}</Text></View>
          <Text style={s.caption}>Mínimo: {qty(item.minimum)} {item.unit}{d(row.shortage).gt(0) ? ` · Faltan ${qty(row.shortage)} ${item.unit} para completar pedidos` : ''}</Text>
          {low ? <Note error>{free.lte(0) ? 'Sin disponibilidad para nuevos pedidos.' : 'Este producto alcanzó el stock mínimo.'}</Note> : null}
          {admin ? <View style={s.wrap}><Button disabled={!writable} onPress={() => open('adjust', item)}>Ajustar</Button><Button disabled={!writable || !item.active} onPress={() => open('transfer', item)}>Transferir</Button></View> : null}
        </View>;
      })}
    </Card>
    <Card><Title caption="Los ajustes registran diferencias y nunca borran movimientos anteriores.">Historial de stock</Title>
      {!movements.length ? <Text>Sin movimientos en esta ubicación.</Text> : <ScrollView horizontal><View>{movements.slice(0, limit).map(movement => <View key={movement.id} style={[s.tableRow, { alignItems: 'center', gap: 12 }]}><Text style={[s.cell, { width: 120 }]}>{dateLabel(movement.created_at)}</Text><View style={{ width: 220, gap: 4 }}><Text>{products.find(item => item.id === movement.item_id)?.name}</Text><Text style={s.caption}>{movementNames[movement.kind] ?? movement.kind} · {movement.reason}</Text></View><Text style={s.cell}>{qty(movement.quantity)} {products.find(item => item.id === movement.item_id)?.unit}</Text>{admin && !movement.reversed_by && !movement.reversal_of && ['adjustment', 'adjust', 'transfer', 'transfer_in', 'transfer_out'].includes(movement.kind) ? <Button disabled={!writable} onPress={() => open('reverse', undefined, movement)}>Revertir</Button> : null}</View>)}</View></ScrollView>}
      {movements.length > limit ? <Button onPress={() => setLimit(limit + 30)}>Ver más movimientos</Button> : null}
    </Card>
    </>}
    <Form visible={!!draft} title={draft?.kind === 'transfer' ? 'Transferir stock' : draft?.kind === 'reverse' ? 'Revertir movimiento' : draft?.kind === 'initial' ? 'Cargar inventario inicial' : 'Ajustar inventario'} close={() => setDraft(null)} save={() => void save()} saving={busy || ws.isSaving} disabled={!writable} error={error}>
      {draft ? <>{draft.kind === 'reverse' ? <Note>Se registrará un movimiento compensatorio. El original y su motivo se conservan.</Note> : <>
        <Options label="Producto" values={products.filter(item => item.active || item.id === draft.item_id).map(item => ({ value: item.id, label: `${item.name} (${item.unit})` }))} value={draft.item_id} onChange={item_id => setDraft({ ...draft, item_id })} />
        <Options label={draft.kind === 'transfer' ? 'Origen' : 'Ubicación'} values={options.filter(point => (point.value !== 'cocina' && locations.find(item => item.id === point.value)?.is_pickup !== false || point.value === 'cocina' && draft.kind === 'transfer' && d(stock(draft.item_id, 'cocina').on_hand).gt(0)) && locations.find(item => item.id === point.value)?.active !== false)} value={draft.location_id} onChange={location_id => setDraft({ ...draft, location_id })} />
        {draft.kind === 'transfer' ? <Options label="Destino" values={options.filter(point => point.value !== 'cocina' && point.value !== draft.location_id && locations.find(item => item.id === point.value)?.is_pickup !== false && locations.find(item => item.id === point.value)?.active !== false)} value={draft.to} onChange={to => setDraft({ ...draft, to })} /> : null}
        <Input label={draft.kind === 'adjust' ? `Diferencia de stock (${target?.unit ?? 'unidad'}; negativa para merma)` : `Cantidad (${target?.unit ?? 'unidad'})`} numeric value={draft.quantity} onChange={quantity => setDraft({ ...draft, quantity })} />
        {target ? <Text>Stock físico: {qty(stock(target.id, draft.location_id).on_hand)} {target.unit} · reservado: {qty(stock(target.id, draft.location_id).reserved)} {target.unit}</Text> : null}
        {draft.kind === 'initial' ? <Note>La cantidad se suma al stock actual. Cargá cada inventario inicial una sola vez; para corregir un saldo usá un ajuste.</Note> : null}
      </>}{draft.kind === 'transfer' ? <Input label="Motivo obligatorio" value={draft.reason} onChange={reason => setDraft({ ...draft, reason })} multiline /> : null}</> : null}
    </Form>
  </Page>;
}
