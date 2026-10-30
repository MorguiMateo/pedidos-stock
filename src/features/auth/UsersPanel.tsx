import React, { useState } from 'react';
import { View } from 'react-native';
import { Button, Text, TextInput } from 'react-native-paper';
import { useWorkspace } from '../../lib/workspace';
import type { WorkspaceMember } from '../../lib/types';
import { Chip, Notice, Panel } from '../../components/ui';
import { COLORS } from '../../lib/theme';

export function InternalUsersPanel() {
  const ws = useWorkspace();
  const [draft, setDraft] = useState<WorkspaceMember | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  if (ws.data?.profile?.role !== 'admin') return null;
  const members = ws.data.members ?? [];
  const save = async () => {
    if (!draft || busy) return;
    setError(''); setSaved('');
    if (!draft.display_name.trim() || !draft.role) return setError('Indicá nombre y rol.');
    if (draft.role === 'responsable' && !draft.location_id) return setError('Elegí el punto de retiro de esta persona.');
    setBusy(true);
    try {
      await ws.setMember({ ...draft, location_id: draft.role === 'admin' ? null : draft.location_id });
      setSaved('Permisos guardados.'); setDraft(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudieron guardar los permisos.'); } finally { setBusy(false); }
  };
  return <Panel><Text variant="titleMedium">Usuarios internos</Text><Text>Las personas solicitan su cuenta desde el ingreso. Habilitá a cada una con su propio rol; los responsables solo acceden a Ventas, Clientes y Stock de su punto, sin Resumen ni Ajustes.</Text>
    {error ? <Notice tone="error" text={error} /> : null}{saved ? <Notice text={saved} /> : null}
    {members.map(member => <View key={member.id} style={{ borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingVertical: 10, gap: 4 }}>
      <Text variant="titleSmall">{member.display_name || member.email || 'Sin nombre'}</Text><Text variant="bodySmall">{member.email} · {member.active ? member.role === 'admin' ? 'Administradora' : `Responsable · ${ws.data?.locations.find(location => location.id === member.location_id)?.name ?? 'Sin punto'}` : 'Sin acceso'}</Text>
      <Button compact disabled={busy} onPress={() => { setDraft({ ...member, role: member.role ?? 'responsable', active: member.role ? member.active : true }); setError(''); setSaved(''); }}>Editar acceso</Button>
    </View>)}
    {!members.length ? <Text variant="bodySmall">Todavía no hay solicitudes de acceso.</Text> : null}
    {draft ? <View style={{ gap: 12 }}><TextInput mode="outlined" style={{ backgroundColor: COLORS.surface }} label="Nombre de la persona" value={draft.display_name} onChangeText={display_name => setDraft({ ...draft, display_name })} disabled={busy} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><Chip selected={draft.role === 'admin'} disabled={busy} onPress={() => setDraft({ ...draft, role: 'admin', location_id: null })}>Administradora</Chip><Chip selected={draft.role === 'responsable'} disabled={busy} onPress={() => setDraft({ ...draft, role: 'responsable' })}>Responsable de punto (acceso limitado)</Chip></View>
      {draft.role === 'responsable' ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{ws.data.locations.filter(location => location.is_pickup && location.active !== false).map(location => <Chip key={location.id} selected={draft.location_id === location.id} disabled={busy} onPress={() => setDraft({ ...draft, location_id: location.id })}>{location.name}</Chip>)}</View> : null}
      <Chip selected={draft.active} disabled={busy} onPress={() => setDraft({ ...draft, active: !draft.active })}>Acceso habilitado</Chip><Button mode="contained" buttonColor={COLORS.primary} textColor={COLORS.ink} contentStyle={{ minHeight: 48 }} loading={busy} disabled={busy || !ws.isOnline} onPress={() => void save()}>Guardar permisos</Button><Button disabled={busy} onPress={() => setDraft(null)}>Cancelar</Button>
    </View> : null}
  </Panel>;
}
export default InternalUsersPanel;
