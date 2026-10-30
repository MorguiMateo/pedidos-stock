import { useState } from 'react';
import { Users, ShieldCheck, UserRound } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace';
import type { WorkspaceMember } from '@shared/lib/types';
import { Button, Card, Empty, Input, Modal, Note, Select, Title, Toggle, errorText } from '../stock/ui';
export default function UsersPanel() {
  const ws = useWorkspace();
  const [draft, setDraft] = useState<WorkspaceMember | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const writable = ws.data?.profile?.role === 'admin' && ws.isOnline && ws.isConfigured && !ws.error;
  if (ws.data?.profile?.role !== 'admin') return null;
  const points = ws.data.locations.filter(p => p.is_pickup && p.active !== false);
  async function save() {
    if (!draft || !writable || busy || ws.isSaving) return;
    setError('');
    if (!draft.display_name.trim() || !draft.role) return setError('Indicá nombre y rol.');
    if (draft.role === 'responsable' && !points.some(p => p.id === draft.location_id)) return setError('Elegí un punto de retiro activo para esta persona.');
    if ((!draft.active || draft.role !== (ws.data?.members ?? []).find(p => p.id === draft.id)?.role) && !window.confirm('¿Confirmar estos cambios de acceso? Los nuevos permisos se aplicarán a esta cuenta.')) return;
    setBusy(true);
    try { await ws.setMember({ ...draft, display_name: draft.display_name.trim(), location_id: draft.role === 'admin' ? null : draft.location_id }); setDraft(null); setNotice('Permisos guardados.'); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return <><Card><Title caption="Cuentas personales, roles y solicitudes de acceso"><span className="flex items-center gap-2"><Users size={20} />Usuarios internos</span></Title><p className="mb-5 text-sm leading-relaxed text-stone-500">Las personas solicitan su cuenta desde el ingreso. Habilitá su rol y punto: los responsables acceden a Ventas, Clientes y Stock de su punto, sin Resumen ni Ajustes.</p>{notice && <div className="mb-4"><Note>{notice}</Note></div>}{!(ws.data.members ?? []).length ? <Empty title="Sin solicitudes de acceso">Las nuevas cuentas aparecerán acá para su aprobación.</Empty> : <div className="divide-y divide-line-soft">{(ws.data.members ?? []).map(member => <div key={member.id} className="flex flex-wrap items-center gap-3 py-4"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-orange-700">{member.role === 'admin' ? <ShieldCheck size={20} /> : <UserRound size={20} />}</div><div className="min-w-0 flex-1"><h3 className="font-semibold">{member.display_name || member.email || 'Sin nombre'}</h3><p className="mt-1 break-all text-xs text-stone-500">{member.email}</p><p className="mt-1 text-xs text-stone-500">{member.active && member.role ? member.role === 'admin' ? 'Administradora · acceso global' : `Responsable · ${ws.data?.locations.find(p => p.id === member.location_id)?.name ?? 'Sin punto'}` : member.role ? 'Acceso deshabilitado' : 'Pendiente de aprobación'}</p></div><Button secondary disabled={!writable || busy || ws.isSaving} onClick={() => { setDraft({ ...member, role: member.role ?? 'responsable', active: member.role ? member.active : true }); setError(''); }}>Editar acceso</Button></div>)}</div>}</Card>
  {draft && <Modal title="Editar acceso" close={() => setDraft(null)} save={() => void save()} busy={busy || ws.isSaving} disabled={!writable} error={error} submitLabel="Guardar permisos"><Input label="Nombre de la persona" required value={draft.display_name} onChange={display_name => setDraft({ ...draft, display_name })} /><Select label="Rol" value={draft.role ?? ''} options={[{ value: 'admin', label: 'Administradora · acceso completo' }, { value: 'responsable', label: 'Responsable de punto · acceso limitado' }]} onChange={role => setDraft({ ...draft, role: role === 'admin' ? 'admin' : 'responsable', location_id: role === 'admin' ? null : draft.location_id })} />{draft.role === 'responsable' && <Select label="Punto de retiro asignado" value={draft.location_id ?? ''} options={points.map(p => ({ value: p.id, label: p.name }))} onChange={location_id => setDraft({ ...draft, location_id })} />}<Toggle label="Acceso habilitado" value={draft.active} onChange={active => setDraft({ ...draft, active })} /><Note>Una administradora accede a todos los puntos. Una persona responsable solo puede operar en su punto asignado.</Note></Modal>}
  </>;
}
