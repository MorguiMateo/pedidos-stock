import { useMemo, useState } from 'react';
import { Plus, Package } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace';
import type { Item, ItemCategory } from '@shared/lib/types';
import { Button, Card, Empty, Input, Modal, Note, Select, Title, Toggle, d, errorText, formatDate, isValidDate, money, numberValue, qty, today } from '../stock/ui';

type Draft = { name: string; category: ItemCategory; unit: Item['unit']; presentation: string; package_size: string; weight_kg: string; price: string; price_effective_on: string; minimum: string; active: boolean; code: string; first_purchase_gift_eligible: boolean };
const blank = (): Draft => ({ name: '', category: 'alimento', unit: 'kg', presentation: '', package_size: '', weight_kg: '', price: '', price_effective_on: today(), minimum: '0', active: true, code: '', first_purchase_gift_eligible: false });
export default function CatalogPanel() {
  const ws = useWorkspace();
  const writable = ws.isConfigured && ws.isOnline && !ws.error && ws.data?.profile?.role === 'admin';
  const [search, setSearch] = useState('');
  const [inactive, setInactive] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const products = useMemo(() => (ws.data?.items ?? []).filter(p => p.kind === 'product' && (inactive || p.active) && `${p.name} ${p.presentation ?? ''} ${p.code ?? ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).sort((a, b) => a.name.localeCompare(b.name)), [ws.data?.items, inactive, search]);
  function edit(item?: Item) {
    setEditing(item ?? null); setError('');
    setDraft(item ? { name: item.name, category: item.category ?? 'alimento', unit: item.unit, presentation: item.presentation ?? '', package_size: item.package_size ?? '', weight_kg: item.weight_kg ?? '', price: item.price, price_effective_on: today(), minimum: item.minimum, active: item.active, code: item.code ?? '', first_purchase_gift_eligible: item.first_purchase_gift_eligible ?? false } : blank());
  }
  async function save() {
    if (!draft || !writable || busy || ws.isSaving) return;
    setError(''); setBusy(true);
    try {
      if (!draft.name.trim() || draft.name.trim().length > 160) throw new Error('Ingresá un nombre de 1 a 160 caracteres.');
      if (!isValidDate(draft.price_effective_on)) throw new Error('La fecha de vigencia debe ser válida.');
      if (!editing && draft.price_effective_on > today()) throw new Error('Un producto nuevo necesita un precio ya vigente. Después podés programar otro precio futuro.');
      const price = numberValue(draft.price, 'Precio');
      if (d(price).decimalPlaces() > 2) throw new Error('El precio admite hasta dos decimales.');
      const minimum = numberValue(draft.minimum, 'Mínimo');
      const package_size = draft.package_size.trim() ? numberValue(draft.package_size, 'Contenido por envase', { positive: true }) : null;
      const weight_kg = draft.weight_kg.trim() ? numberValue(draft.weight_kg, 'Peso de referencia', { positive: true }) : null;
      if (draft.unit === 'unidad' && package_size && !d(package_size).isInteger()) throw new Error('Un envase por unidad debe contener una cantidad entera.');
      if (draft.first_purchase_gift_eligible && draft.unit !== 'unidad') throw new Error('La bolsa de regalo debe venderse por unidad.');
      if (editing?.active && !draft.active && !window.confirm('¿Desactivar este producto para nuevas operaciones? Su historial y stock se conservarán.')) return;
      await ws.command('save_item', { ...(editing ? { id: editing.id } : {}), kind: 'product', name: draft.name.trim(), unit: draft.unit, category: draft.category, presentation: draft.presentation.trim(), package_size, price, price_effective_on: draft.price_effective_on, minimum, active: draft.active, code: draft.code.trim(), weight_kg, first_purchase_gift_eligible: draft.first_purchase_gift_eligible }, editing?.version);
      setDraft(null); setNotice(draft.price_effective_on > today() ? 'Precio futuro programado. El precio vigente no cambia hasta esa fecha; las ventas históricas se conservan.' : 'Producto guardado. Los pedidos existentes mantienen sus precios y cantidades históricos.');
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  if (ws.data?.profile?.role !== 'admin') return null;
  return <><Card><Title caption="Unidad comercial, presentaciones y precios vigentes" action={<Button disabled={!writable || busy || ws.isSaving} onClick={() => edit()}><Plus size={16} />Nuevo producto</Button>}><span className="flex items-center gap-2"><Package size={20} />Catálogo de productos</span></Title>{notice && <div className="mb-4"><Note>{notice}</Note></div>}<div className="mb-6 flex flex-wrap items-end gap-5"><div className="min-w-56 flex-1"><Input label="Buscar producto, presentación o código" value={search} onChange={setSearch} /></div><div className="pb-3"><Toggle label="Mostrar inactivos" value={inactive} onChange={setInactive} /></div></div>
    {!products.length ? <Empty title="Sin productos">Agregá el primer producto o revisá los filtros.</Empty> : <div className="divide-y divide-line-soft">{products.map(item => <article key={item.id} className="flex flex-wrap items-start justify-between gap-4 py-5 first:pt-0"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-ink">{item.name}</h3><span className="ui-badge bg-subtle text-[10px] uppercase tracking-wider text-stone-600">{item.category ?? 'alimento'}</span>{!item.active && <span className="text-xs text-red-600">Inactivo</span>}{item.first_purchase_gift_eligible && <span className="ui-badge bg-orange-100/70 text-orange-900">Regalo primera compra</span>}</div><p className="mt-2 text-sm text-stone-500">{item.presentation || 'Sin presentación'}{item.code ? ` · ${item.code}` : ''} · {item.package_size ? `${qty(item.package_size)} ${item.unit}/envase` : 'Sin contenido de envase'}{item.weight_kg ? ` · Peso: ${qty(item.weight_kg)} kg` : ''}</p><p className="mt-1 text-xs text-stone-500">Mínimo: {qty(item.minimum)} {item.unit} por ubicación · Vigencia: {item.price_effective_on && item.price_effective_on !== '0001-01-01' ? formatDate(item.price_effective_on) : 'Sin fecha histórica'}</p>{(ws.data?.product_prices ?? []).filter(p => p.product_id === item.id).sort((a, b) => b.effective_on.localeCompare(a.effective_on)).slice(0, 5).map(p => <p key={p.id} className={`mt-1 text-xs ${p.effective_on > today() ? 'text-orange-700' : 'text-stone-500'}`}>{p.effective_on > today() ? 'Programado' : 'Histórico'}: {money(p.price)} / {item.unit} desde {p.effective_on === '0001-01-01' ? 'fecha no registrada' : formatDate(p.effective_on)}</p>)}</div><div className="flex items-center gap-5"><div className="text-right"><p className="text-lg font-bold">{money(item.price)}</p><p className="text-xs text-stone-500">por {item.unit}</p></div><Button secondary disabled={!writable || busy || ws.isSaving} onClick={() => edit(item)}>Editar</Button></div></article>)}</div>}
    <div className="mt-4"><Note>Los productos se desactivan, no se borran. El historial se conserva. La presentación describe el envase; las cantidades y el precio se expresan en la unidad comercial.</Note></div>
    </Card>
    {draft && <Modal title={editing ? 'Editar producto' : 'Nuevo producto'} close={() => setDraft(null)} save={() => void save()} busy={busy || ws.isSaving} disabled={!writable} error={error}>
      <Input label="Nombre del producto" required maxLength={160} value={draft.name} onChange={name => setDraft({ ...draft, name })} /><div className="grid gap-4 sm:grid-cols-2"><Select label="Categoría" value={draft.category} onChange={category => setDraft({ ...draft, category })} options={[{ value: 'alimento', label: 'Alimento' }, { value: 'suplemento', label: 'Suplemento' }, { value: 'accesorio', label: 'Accesorio' }]} /><Select label="Unidad comercial" value={draft.unit} onChange={unit => setDraft({ ...draft, unit })} options={[{ value: 'kg', label: 'Kilogramos (kg)' }, { value: 'unidad', label: 'Unidad' }, ...(editing && editing.unit !== 'kg' && editing.unit !== 'unidad' ? [{ value: editing.unit, label: `Unidad histórica (${editing.unit})` }] : [])]} /></div>{editing && editing.unit !== draft.unit && <Note>El cambio de unidad no convierte el stock existente. El servidor impedirá cambiarla si ya hay operaciones.</Note>}<Input label="Presentación (por ejemplo bolsa o pote)" value={draft.presentation} onChange={presentation => setDraft({ ...draft, presentation })} /><div className="grid gap-4 sm:grid-cols-2"><Input label={`Contenido por envase (${draft.unit}, opcional)`} numeric value={draft.package_size} onChange={package_size => setDraft({ ...draft, package_size })} /><Input label="Peso de referencia (kg, opcional)" numeric value={draft.weight_kg} onChange={weight_kg => setDraft({ ...draft, weight_kg })} /><Input label={`Precio por ${draft.unit} (ARS)`} numeric value={draft.price} onChange={price => setDraft({ ...draft, price })} /><Input label="Precio vigente desde" type="date" value={draft.price_effective_on} onChange={price_effective_on => setDraft({ ...draft, price_effective_on })} /><Input label={`Mínimo por ubicación (${draft.unit})`} numeric value={draft.minimum} onChange={minimum => setDraft({ ...draft, minimum })} /><Input label="Código (opcional)" value={draft.code} onChange={code => setDraft({ ...draft, code })} /></div><Toggle label="Producto activo para nuevas operaciones" value={draft.active} onChange={active => setDraft({ ...draft, active })} /><Toggle label="Bolsa de regalo de primera compra" value={draft.first_purchase_gift_eligible} onChange={first_purchase_gift_eligible => setDraft({ ...draft, first_purchase_gift_eligible })} />{draft.first_purchase_gift_eligible && <Note>La bolsa debe venderse por unidad. Conserva su precio habitual; el regalo elegido en la primera compra se descuenta del stock al entregar.</Note>}<Note>Una vigencia futura programa el precio sin cambiar el actual ni las ventas anteriores. Para envases de 0,5 kg, usá unidad kg y contenido 0,5.</Note>
    </Modal>}
  </>;
}
