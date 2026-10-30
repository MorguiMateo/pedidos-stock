import { useState } from 'react';
import { Download, MapPin, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace';
import { downloadText } from '@/lib/exportFile';
import type { Location } from '@shared/lib/types';
import CatalogPanel from './CatalogPanel';
import UsersPanel from './UsersPanel';
import { Button, Card, Empty, Heading, Input, Modal, Note, Title, Toggle, errorText, formatDate, today } from '../stock/ui';
const colors = ['#8757D5', '#D95555', '#319C75', '#255B46', '#AA6A19', '#327BA4'];
const empty = { name: '', color: colors[0]!, active: true, is_pickup: true };
type Tab = 'catalog' | 'locations' | 'users' | 'audit';
export default function SettingsScreen() {
  const ws = useWorkspace();
  const admin = ws.data?.profile?.role === 'admin';
  const writable = ws.isConfigured && ws.isOnline && !ws.error && admin;
  const [tab, setTab] = useState<Tab>('catalog');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Location | null>(null);
  const [draft, setDraft] = useState(empty);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  function edit(location?: Location) { setEditing(location ?? null); setDraft(location ? { name: location.name, color: location.color, active: location.active !== false, is_pickup: location.is_pickup ?? location.id !== 'cocina' } : empty); setError(''); setOpen(true); }
  async function save() {
    if (!writable || busy || ws.isSaving) return;
    setError(''); setBusy(true);
    try {
      if (!draft.name.trim() || draft.name.trim().length > 120) throw new Error('Ingresá un nombre de 1 a 120 caracteres.');
      if (!/^#[a-f\d]{6}$/i.test(draft.color)) throw new Error('El color debe ser hexadecimal, por ejemplo #255B46.');
      if ((ws.data?.locations ?? []).some(p => p.id !== editing?.id && p.name.trim().toLocaleLowerCase() === draft.name.trim().toLocaleLowerCase())) throw new Error('Ya hay una ubicación con ese nombre.');
      if (editing?.active !== false && editing && !draft.active && !window.confirm('¿Desactivar esta ubicación para nuevos pedidos? Los registros y las existencias se conservan.')) return;
      await ws.command('save_location', { ...(editing ? { id: editing.id } : {}), ...draft, name: draft.name.trim() }, editing?.version);
      setOpen(false); setNotice('Ubicación guardada. Los registros históricos conservan su ubicación.');
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  async function exportBackup() {
    if (!writable || exporting) return;
    setExporting(true); setNotice('');
    try {
      const backup = await ws.exportData();
      if (!backup || backup.format !== 'pedidos-stock' || !backup.raw_tables) throw new Error('No se recibió un respaldo completo del servidor. Intentá nuevamente.');
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(backup)));
      const payload_hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      await downloadText(`pedidos-stock-respaldo-${today()}.json`, JSON.stringify({ ...backup, integrity: { algorithm: 'SHA-256', payload_hash } }, null, 2) + '\n', 'application/json;charset=utf-8');
      setNotice('Copia completa descargada desde el servidor. Guardala en un lugar privado.');
    } catch (e) { setNotice(''); setError(errorText(e)); } finally { setExporting(false); }
  }
  if (!admin) return <Card><Empty title="Acceso reservado a administración">Tu cuenta puede operar Ventas, Clientes y Stock del punto asignado.</Empty></Card>;
  const tabs: { id: Tab; label: string }[] = [{ id: 'catalog', label: 'Catálogo' }, { id: 'locations', label: 'Puntos de retiro' }, { id: 'users', label: 'Usuarios' }, { id: 'audit', label: 'Auditoría y respaldo' }];
  return <div className="space-y-6"><Heading eyebrow="ADMINISTRACIÓN" title="Configuración" subtitle="Catálogo, puntos y accesos. Los cambios conservan tu historial operativo." action={<Button secondary disabled={ws.isLoading || ws.isRefreshing} onClick={() => void ws.refresh()}><RefreshCw size={16} className={ws.isRefreshing ? 'animate-spin' : ''} />Actualizar</Button>} />{!writable && <Note>Modo consulta. Solo administración con conexión puede guardar configuración.</Note>}{ws.error && <Note error>{errorText(ws.error)}</Note>}{error && !open && <Note error>{error}</Note>}{notice && <Note>{notice}</Note>}
    <nav aria-label="Secciones de configuración" className="flex flex-wrap gap-1 border-b border-line">{tabs.map(t => <button key={t.id} onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined} className={`-mb-px min-h-11 border-b-2 px-3.5 py-2 text-sm font-semibold transition-colors ${tab === t.id ? 'border-brand text-orange-800' : 'border-transparent text-stone-500 hover:border-stone-300 hover:text-ink'}`}>{t.label}</button>)}</nav>
    {tab === 'catalog' && <CatalogPanel />}
    {tab === 'locations' && <Card><Title caption="Nombre, color y disponibilidad para nuevos pedidos" action={<Button disabled={!writable || busy || ws.isSaving} onClick={() => edit()}><Plus size={16} />Nueva ubicación</Button>}><span className="flex items-center gap-2"><MapPin size={19} />Puntos de retiro</span></Title><Note>Desactivar no elimina pedidos, movimientos ni existencias. Una ubicación inactiva no se ofrece para nuevos pedidos.</Note><div className="mt-4 divide-y divide-line-soft">{!(ws.data?.locations ?? []).length ? <Empty title="Sin ubicaciones">Agregá tu primer punto de retiro.</Empty> : ws.data?.locations.map(location => <div key={location.id} className="flex items-center gap-4 py-5"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: `${location.color}18`, color: location.color }}><MapPin size={22} /></div><div className="min-w-0 flex-1"><h3 className="font-semibold">{location.name}</h3><p className="mt-1 text-xs text-stone-500">{location.active === false ? 'Inactiva' : 'Activa'} · {(location.is_pickup ?? location.id !== 'cocina') ? 'Permite retiro de pedidos' : 'Sin retiro de pedidos'}</p></div><Button secondary disabled={!writable || busy || ws.isSaving} onClick={() => edit(location)}>Editar</Button></div>)}</div></Card>}
    {tab === 'users' && <UsersPanel />}
    {tab === 'audit' && <><Card><Title caption="Copia actualizada desde el backend" action={<Button disabled={!writable || exporting || ws.isSaving} onClick={() => void exportBackup()}><Download size={16} />{exporting ? 'Exportando…' : 'Exportar JSON completo'}</Button>}>Respaldo de datos</Title><p className="text-sm leading-relaxed text-stone-500">Descargá una copia completa con datos, tablas originales, identificadores de comandos e integridad. Contiene información privada del negocio y sus clientes.</p></Card><Card><Title caption="Últimas 40 operaciones registradas por el servidor"><span className="flex items-center gap-2"><ShieldCheck size={19} />Auditoría operativa</span></Title>{!(ws.data?.audit_events ?? []).length ? <Empty title="Sin eventos de auditoría">Las operaciones quedarán registradas con su identificador, actor y fecha.</Empty> : <div className="divide-y divide-line-soft">{[...(ws.data?.audit_events ?? [])].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).slice(0, 40).map(event => <article key={event.id} className="space-y-1 py-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{event.operation}</h3><time className="text-xs text-stone-500">{formatDate(event.occurred_at)} · {new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Mendoza', hour: '2-digit', minute: '2-digit' }).format(new Date(event.occurred_at))}</time></div><p className="break-all text-xs text-stone-500">Registro: {event.entity_id} · Operación: {event.command_id}</p><p className="break-all text-xs text-stone-500">Actor: {event.actor_id || 'Sin identificación (acceso compartido)'}</p>{event.reason && <p className="text-sm text-stone-600">{event.reason}</p>}</article>)}</div>}</Card></>}
    {open && <Modal title={editing ? 'Editar ubicación' : 'Nueva ubicación'} close={() => setOpen(false)} save={() => void save()} busy={busy || ws.isSaving} disabled={!writable} error={error}><Input label="Nombre de la ubicación" required maxLength={120} value={draft.name} onChange={name => setDraft({ ...draft, name })} /><fieldset><legend className="mb-2 text-xs font-semibold text-stone-600">Color del punto</legend><div className="flex flex-wrap gap-3">{colors.map(color => <button type="button" key={color} aria-label={`Color ${color}`} aria-pressed={draft.color === color} onClick={() => setDraft({ ...draft, color })} style={{ backgroundColor: color }} className={`h-10 w-10 rounded-xl border-4 ${draft.color === color ? 'border-stone-800 ring-2 ring-stone-300' : 'border-transparent'}`} />)}</div></fieldset><Input label="Color personalizado (#RRGGBB)" value={draft.color} onChange={color => setDraft({ ...draft, color })} /><Toggle label="Ubicación activa" value={draft.active} onChange={active => setDraft({ ...draft, active })} /><Toggle label="Permite retiro de pedidos" value={draft.is_pickup} onChange={is_pickup => setDraft({ ...draft, is_pickup })} /></Modal>}
  </div>;
}
