import React, { useState } from 'react';
import { View } from 'react-native';
import { Button, Switch, Text } from 'react-native-paper';
import { useWorkspace } from '../../lib/workspace';
import CatalogPanel from './CatalogPanel';
import UsersPanel from '../auth/UsersPanel';
import type { Location } from '../../lib/types';
import { Action, Blank, Card, Form, Heading, Input, Note, Options, Page, Title, dateLabel, errorText, accent, s } from '../stock/featureUi';

const colors = ['#8757D5', '#D95555', '#319C75', '#255B46', '#AA6A19', '#327BA4'];
const empty = { name: '', color: colors[0]!, active: true, is_pickup: true };
export default function SettingsScreen() {
  const workspace = useWorkspace();
  const admin = workspace.data?.profile?.role === 'admin';
  const writable = workspace.isConfigured && workspace.isOnline && !workspace.error && admin;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Location | null>(null);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  function edit(location?: Location) {
    setEditing(location ?? null); setForm(location ? { name: location.name, color: location.color, active: location.active !== false, is_pickup: location.is_pickup ?? location.id !== 'cocina' } : empty); setError(''); setOpen(true);
  }
  async function save() {
    if (!writable || workspace.isSaving) return;
    setError('');
    try {
      if (!form.name.trim() || form.name.trim().length > 120) throw new Error('Ingresá un nombre de 1 a 120 caracteres.');
      if (!/^#[a-f\d]{6}$/i.test(form.color)) throw new Error('El color debe ser hexadecimal, por ejemplo #255B46.');
      if ((workspace.data?.locations ?? []).some(location => location.id !== editing?.id && location.name.trim().toLocaleLowerCase() === form.name.trim().toLocaleLowerCase())) throw new Error('Ya hay una ubicación con ese nombre.');
      await workspace.command('save_location', { ...(editing ? { id: editing.id } : {}), ...form, name: form.name.trim() }, editing?.version);
      setOpen(false); setNotice('Ubicación guardada. Los registros históricos conservan su ubicación.');
    } catch (caught) { setError(errorText(caught)); }
  }
  return <Page refresh={workspace.refresh} loading={workspace.isLoading}>
    <Heading eyebrow="CONFIGURACIÓN" title="Catálogo, puntos y usuarios" subtitle="Administrá tus puntos sin cambiar el historial." action={<Action icon="plus" disabled={!writable} onPress={() => edit()}>Nueva ubicación</Action>} />
    {!writable ? <Note>Modo consulta. Solo administración con conexión puede guardar configuración.</Note> : null}
    {workspace.error ? <Note error>{errorText(workspace.error)}</Note> : null}{notice ? <Note>{notice}</Note> : null}
    <CatalogPanel />
    <Card><Title caption="Nombre, color y disponibilidad para nuevos pedidos">Puntos de retiro</Title><Note>Desactivar no elimina pedidos, movimientos ni existencias. Una ubicación inactiva no se ofrece para nuevos pedidos.</Note>
      {!(workspace.data?.locations ?? []).length ? <Blank title="Sin ubicaciones" text="Agregá tu primer punto de retiro." /> : workspace.data?.locations.map(location => <View key={location.id} style={[s.line, s.row]}><View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: location.color }} /><View style={s.grow}><Text style={s.smallTitle}>{location.name}</Text><Text style={s.caption}>{location.active === false ? 'Inactiva' : 'Activa'} · {(location.is_pickup ?? location.id !== 'cocina') ? 'Permite retiro' : 'Sin retiro de pedidos'}</Text></View><Button textColor={accent} disabled={!writable} onPress={() => edit(location)}>Editar</Button></View>)}
    </Card>
    {admin ? <UsersPanel /> : null}
    <Card><Title caption="Últimas operaciones registradas por el servidor">Auditoría operativa</Title>{!(workspace.data?.audit_events ?? []).length ? <Blank title="Sin eventos de auditoría" text="Las nuevas operaciones quedarán registradas con su identificador y fecha." /> : [...(workspace.data?.audit_events ?? [])].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).slice(0, 40).map(event => <View key={event.id} style={s.line}><Text style={s.smallTitle}>{event.operation} · {dateLabel(event.occurred_at)}</Text><Text style={s.caption}>Registro: {event.entity_id} · Operación: {event.command_id}</Text><Text style={s.caption}>Actor: {event.actor_id || 'Sin identificación (acceso compartido)'}</Text>{event.reason ? <Text style={s.caption}>{event.reason}</Text> : null}</View>)}</Card>
    <Form visible={open} title={editing ? 'Editar ubicación' : 'Nueva ubicación'} close={() => setOpen(false)} save={() => { void save(); }} saving={workspace.isSaving} disabled={!writable} error={error}>
      <Input label="Nombre" value={form.name} onChange={name => setForm(current => ({ ...current, name }))} />
      <Options label="Color" values={colors.map(color => ({ value: color, label: color, color }))} value={form.color} onChange={color => setForm(current => ({ ...current, color }))} />
      <Input label="Color personalizado (#RRGGBB)" value={form.color} onChange={color => setForm(current => ({ ...current, color }))} />
      <View style={s.row}><Switch value={form.active} onValueChange={active => setForm(current => ({ ...current, active }))} color={accent} accessibilityLabel="Ubicación activa" /><Text>Ubicación activa</Text></View>
      <View style={s.row}><Switch value={form.is_pickup} onValueChange={is_pickup => setForm(current => ({ ...current, is_pickup }))} color={accent} accessibilityLabel="Permite retiro de pedidos" /><Text>Permite retiro de pedidos</Text></View>

    </Form>
  </Page>;
}
