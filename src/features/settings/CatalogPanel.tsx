import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Button, Switch, Text } from 'react-native-paper';
import Decimal from '../../lib/decimal';
import type { Item, ItemCategory } from '../../lib/types';
import { useWorkspace } from '../../lib/workspace';
import { Action, Card, Form, Input, Note, Options, Title, accent, dateToday, errorText, numberValue, price, s, validDate } from '../stock/featureUi';

type Draft = { name: string; category: ItemCategory; unit: Item['unit']; presentation: string; package_size: string; price: string; price_effective_on: string; minimum: string; active: boolean; code: string; first_purchase_gift_eligible: boolean };
const blank = (): Draft => ({ name: '', category: 'alimento', unit: 'kg', presentation: '', package_size: '', price: '', price_effective_on: dateToday(), minimum: '0', active: true, code: '', first_purchase_gift_eligible: false });
export default function CatalogPanel() {
  const ws = useWorkspace();
  const writable = ws.isConfigured && ws.isOnline && !ws.error && ws.data?.profile?.role === 'admin';
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const products = useMemo(() => (ws.data?.items ?? []).filter(item => item.kind === 'product' && (showInactive || item.active) && `${item.name} ${item.presentation ?? ''} ${item.code ?? ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).sort((a, b) => a.name.localeCompare(b.name)), [ws.data?.items, showInactive, search]);
  function edit(item?: Item) {
    setEditing(item ?? null); setError('');
    setDraft(item ? { name: item.name, category: item.category ?? 'alimento', unit: item.unit, presentation: item.presentation ?? '', package_size: item.package_size ?? '', price: item.price, price_effective_on: dateToday(), minimum: item.minimum, active: item.active, code: item.code ?? '', first_purchase_gift_eligible: item.first_purchase_gift_eligible ?? false } : blank());
  }
  async function save() {
    if (!draft || !writable || ws.isSaving) return;
    setError('');
    try {
      if (!draft.name.trim() || draft.name.trim().length > 160) throw new Error('Ingresá un nombre de 1 a 160 caracteres.');
      if (!validDate(draft.price_effective_on)) throw new Error('La fecha de vigencia debe ser válida (AAAA-MM-DD).');
      if (!editing && draft.price_effective_on > dateToday()) throw new Error('Un producto nuevo necesita un precio ya vigente. Después podés programar otro precio futuro.');
      const itemPrice = numberValue(draft.price, 'Precio');
      if (new Decimal(itemPrice).decimalPlaces() > 2) throw new Error('El precio admite hasta dos decimales.');
      if (new Decimal(itemPrice).lt(0)) throw new Error('El precio no puede ser negativo.');
      const minimum = numberValue(draft.minimum, 'Mínimo');
      if (new Decimal(minimum).lt(0)) throw new Error('El mínimo no puede ser negativo.');
      const packageSize = draft.package_size.trim() ? numberValue(draft.package_size, 'Contenido por envase', { positive: true }) : null;
      if (draft.unit === 'unidad' && packageSize && !new Decimal(packageSize).isInteger()) throw new Error('Un envase de productos por unidad debe contener una cantidad entera de unidades.');
      if (draft.first_purchase_gift_eligible && draft.unit !== 'unidad') throw new Error('La bolsa de regalo debe venderse por unidad.');
      await ws.command('save_item', { ...(editing ? { id: editing.id } : {}), kind: 'product', name: draft.name.trim(), unit: draft.unit, category: draft.category, presentation: draft.presentation.trim(), package_size: packageSize, price: itemPrice, price_effective_on: draft.price_effective_on, minimum, active: draft.active, code: draft.code.trim(), weight_kg: editing?.weight_kg ?? null, first_purchase_gift_eligible: draft.first_purchase_gift_eligible }, editing?.version);
      setDraft(null); setNotice(draft.price_effective_on > dateToday() ? 'Precio futuro programado. El precio vigente no cambia hasta la fecha indicada; los pedidos históricos se conservan.' : 'Producto guardado. Los pedidos existentes mantienen sus precios y cantidades históricos.');
    } catch (caught) { setError(errorText(caught)); }
  }
  return <>
    <Card><View style={[s.row, { justifyContent: 'space-between' }]}><Title caption="Precio por unidad comercial; la presentación describe y el contenido calcula envases">Catálogo de productos</Title><Action icon="plus" disabled={!writable} onPress={() => edit()}>Nuevo producto</Action></View>
      <Input label="Buscar producto o presentación" value={search} onChange={setSearch} /><View style={s.row}><Switch value={showInactive} onValueChange={setShowInactive} color={accent} accessibilityLabel="Mostrar productos inactivos" /><Text>Mostrar inactivos</Text></View>
      {notice ? <Note>{notice}</Note> : null}{!writable ? <Note>Solo administración con conexión puede editar el catálogo.</Note> : null}
      {products.map(item => <View key={item.id} style={[s.line, s.row]}><View style={s.grow}><Text style={s.smallTitle}>{item.name}{item.active ? '' : ' · Inactivo'}</Text><Text style={s.caption}>{item.category ?? 'alimento'} · {item.presentation || 'Sin presentación'} · {price(item.price)} / {item.unit}</Text><Text style={s.caption}>{item.package_size ? `${item.package_size} ${item.unit} por envase` : 'Sin contenido de envase definido'} · Vigencia: {item.price_effective_on && item.price_effective_on !== '0001-01-01' ? item.price_effective_on : 'Sin fecha histórica'} · Mínimo {item.minimum} {item.unit}</Text>{(ws.data?.product_prices ?? []).filter(entry => entry.product_id === item.id).sort((a, b) => b.effective_on.localeCompare(a.effective_on)).slice(0, 5).map(entry => <Text key={entry.id} style={s.caption}>{entry.effective_on > dateToday() ? 'Programado' : 'Histórico'}: {price(entry.price)} / {item.unit} desde {entry.effective_on === '0001-01-01' ? 'fecha histórica no registrada' : entry.effective_on}</Text>)}</View><Button disabled={!writable} textColor={accent} onPress={() => edit(item)}>Editar</Button></View>)}
      {!products.length ? <Text style={s.caption}>Sin productos para estos filtros.</Text> : null}<Note>Los productos se desactivan, no se borran. Los inactivos no se ofrecen en nuevas ventas ni movimientos; su historial se conserva. El stock, cantidades y precio se expresan en kg o unidad; los envases no sustituyen la unidad comercial.</Note>
    </Card>
    <Form visible={!!draft} title={editing ? 'Editar producto' : 'Nuevo producto'} close={() => setDraft(null)} save={() => void save()} saving={ws.isSaving} disabled={!writable} error={error}>
      {draft ? <><Input label="Nombre del producto" value={draft.name} onChange={name => setDraft({ ...draft, name })} />
        <Options label="Categoría" value={draft.category} onChange={category => setDraft({ ...draft, category })} values={[{ value: 'alimento', label: 'Alimento' }, { value: 'suplemento', label: 'Suplemento' }, { value: 'accesorio', label: 'Accesorio' }]} />
        <Options label="Unidad comercial" value={draft.unit} onChange={unit => setDraft({ ...draft, unit })} values={[{ value: 'kg', label: 'Kilogramos (kg)' }, { value: 'unidad', label: 'Unidad' }, ...(editing && editing.unit !== 'kg' && editing.unit !== 'unidad' ? [{ value: editing.unit, label: `Unidad histórica (${editing.unit})` }] : [])]} />
        {editing && editing.unit !== draft.unit ? <Note>El cambio de unidad no convierte el stock existente. El servidor impedirá cambiarla si ya hay operaciones.</Note> : null}
        <Input label="Presentación (texto, por ejemplo bolsa o pote)" value={draft.presentation} onChange={presentation => setDraft({ ...draft, presentation })} />
        <Input label={`Contenido por envase (${draft.unit}, opcional)`} value={draft.package_size} onChange={package_size => setDraft({ ...draft, package_size })} numeric />
        <Input label={`Precio por ${draft.unit} ($)`} value={draft.price} onChange={price => setDraft({ ...draft, price })} numeric />
        <Input label="Vigente desde (AAAA-MM-DD)" value={draft.price_effective_on} onChange={price_effective_on => setDraft({ ...draft, price_effective_on })} />
        <Input label={`Stock mínimo por ubicación (${draft.unit})`} value={draft.minimum} onChange={minimum => setDraft({ ...draft, minimum })} numeric />
        <Input label="Código (opcional)" value={draft.code} onChange={code => setDraft({ ...draft, code })} />
        <View style={s.row}><Switch value={draft.active} onValueChange={active => setDraft({ ...draft, active })} color={accent} accessibilityLabel="Producto activo" /><Text>Producto activo para nuevas operaciones</Text></View>
        <View style={s.row}><Switch value={draft.first_purchase_gift_eligible} onValueChange={first_purchase_gift_eligible => setDraft({ ...draft, first_purchase_gift_eligible })} color={accent} accessibilityLabel="Bolsa de regalo de primera compra" /><Text>Bolsa de regalo de primera compra</Text></View>
        {draft.first_purchase_gift_eligible ? <Note>Se podrán cargar bolsas de regalo en la primera compra del cliente, sin volver gratis los alimentos ni otras líneas. Conserva su precio de venta habitual; la cantidad elegida se descuenta del stock al entregar.</Note> : null}
        <Note>Una vigencia futura programa el precio sin cambiar el actual. Editar precios no modifica ventas anteriores. Para vender envases de 0,5 kg, la unidad es kg y el contenido por envase es 0,5.</Note>
      </> : null}
    </Form>
  </>;
}
