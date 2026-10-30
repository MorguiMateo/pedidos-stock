import { useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { duplicatePhoneClients } from '@shared/lib/clientHistory';
import { useWorkspace } from '@/lib/workspace';
import type { Client } from '@shared/lib/types';
import { Button, Field, Modal, Note, Select, Textarea, errorText } from '../reports/ui';
import { blankClient, clientDraft, clientPayload, validateClient, type PetDraft, type ClientEditorProps, petAgeLabel } from '@shared/features/clients/clientForm';
import { preparePetPhoto } from './petPhoto';

export function ClientEditor({ client, initialName = '', initialPhone = '', onSaved, onCancel }: ClientEditorProps) {
  const ws = useWorkspace();
  const [draft, setDraft] = useState(() => client ? clientDraft(client) : { ...blankClient(), name: initialName, phone: initialPhone });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const saving = useRef(false);
  const available = ws.isConfigured && ws.isOnline;
  const disabled = !available || ws.isSaving || busy || uploading;
  const duplicates = duplicatePhoneClients(ws.data?.clients ?? [], draft.phone, draft.id);
  const pickupLocations = (ws.data?.locations ?? []).filter(location => (location.is_pickup ?? location.id !== 'cocina') && location.active !== false && (ws.data?.profile?.role !== 'responsable' || location.id === ws.data.profile.location_id));
  const edit = (existing: Client) => { setError(''); setDraft(clientDraft(existing)); };
  const setPet = <Field extends keyof PetDraft>(index: number, field: Field, value: PetDraft[Field]) => setDraft(current => ({ ...current, pets: current.pets.map((pet, i) => i === index ? { ...pet, [field]: value } : pet) }));
  async function save() {
    if (disabled || saving.current) return;
    const validation = validateClient(draft);
    if (validation) return setError(validation);
    if (duplicates.length) return setError('Ya hay un cliente con este teléfono. Usá su ficha existente o corregí el teléfono para evitar duplicados.');
    saving.current = true; setBusy(true); setError('');
    try {
      const payload = clientPayload(draft);
      const result = await ws.command('save_client', payload, draft.version);
      onSaved(result.id, { ...payload, id: result.id, version: (draft.version ?? 0) + 1 });
    } catch (caught) { setError(errorText(caught)); } finally { saving.current = false; setBusy(false); }
  }

  async function choosePhoto(index: number, file: File) {
    setError(''); setUploading(true);
    try { setPet(index, 'photo_data_url', await preparePetPhoto(file)); }
    catch (caught) { setError(errorText(caught)); } finally { setUploading(false); }
  }
  return <Modal title={draft.id ? 'Editar cliente' : 'Nuevo cliente'} close={onCancel} save={() => void save()} busy={busy || ws.isSaving || uploading} disabled={!available} error={error}>
      <Field label="Nombre del cliente" required autoComplete="name" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} />
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Teléfono" type="tel" autoComplete="tel" value={draft.phone} onChange={event => setDraft({ ...draft, phone: event.target.value })} /><Field label="Correo electrónico" type="email" autoComplete="email" value={draft.email} onChange={event => setDraft({ ...draft, email: event.target.value })} /></div>
      {duplicates.length ? <Note error>Teléfono ya registrado: {duplicates.map(client => client.name).join(', ')}. {duplicates.map(client => <Button key={client.id} secondary className="mt-3" onClick={() => edit(client)}>Usar ficha de {client.name}</Button>)}</Note> : null}
      <Field label="Domicilio" autoComplete="street-address" value={draft.address} onChange={event => setDraft({ ...draft, address: event.target.value })} />
      <Select label="Punto de retiro habitual" value={draft.preferred_location_id} onChange={preferred_location_id => setDraft({ ...draft, preferred_location_id })} options={[{ value: '', label: 'Sin preferencia' }, ...pickupLocations.map(location => ({ value: location.id, label: location.name })), ...(draft.preferred_location_id && !pickupLocations.some(location => location.id === draft.preferred_location_id) ? [{ value: draft.preferred_location_id, label: `${ws.data?.locations.find(location => location.id === draft.preferred_location_id)?.name ?? 'Punto guardado'} (no disponible para nuevos pedidos)` }] : [])]} />
      <Textarea label="Notas del cliente" value={draft.notes} onChange={notes => setDraft({ ...draft, notes })} />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 pt-4"><h3 className="font-semibold">Sus mascotas</h3><Button secondary onClick={() => setDraft(current => current ? { ...current, pets: [...current.pets, { name: '', species: 'perro', weight_kg: '', diet: '', notes: '', age_years: '' }] } : current)}><Plus size={16} />Agregar mascota</Button></div>
      {draft.pets.map((pet, index) => <fieldset key={index} className="grid gap-4 rounded-xl border border-stone-200 bg-white p-4"><legend className="px-2 text-sm font-medium">Mascota {index + 1}</legend><div className="flex justify-end"><Button secondary disabled={uploading} aria-label={`Quitar mascota ${index + 1}`} onClick={() => setDraft(current => current ? { ...current, pets: current.pets.filter((_, i) => i !== index) } : current)}><Trash2 size={15} />Quitar</Button></div><div className="grid gap-4 sm:grid-cols-2"><Field label={`Nombre de mascota ${index + 1}`} required value={pet.name} onChange={event => setPet(index, 'name', event.target.value)} /><Select label={`Especie de mascota ${index + 1}`} value={pet.species} onChange={value => setPet(index, 'species', value as PetDraft['species'])} options={[{ value: '', label: 'Sin registrar' }, { value: 'perro', label: 'Perro' }, { value: 'gato', label: 'Gato' }]} /></div><Field label={`Peso en kg de mascota ${index + 1} (opcional)`} inputMode="decimal" value={pet.weight_kg} onChange={event => setPet(index, 'weight_kg', event.target.value)} /><Field label={`Edad en años de mascota ${index + 1} (opcional)`} inputMode="decimal" placeholder="Ej.: 3 o 0,5" value={pet.age_years} onChange={event => setPet(index, 'age_years', event.target.value)} /><p className="text-xs text-stone-500">{pet.age_recorded_on ? petAgeLabel(pet) : 'La fecha de referencia se registra al guardar la edad. 0,5 años = 6 meses.'}</p><Textarea label={`Anotaciones de mascota ${index + 1} (opcional)`} value={pet.notes} onChange={value => setPet(index, 'notes', value)} />{pet.photo_data_url ? <div className="flex items-center gap-3"><img className="h-28 w-28 rounded-xl object-cover" src={pet.photo_data_url} alt={`Foto de ${pet.name || 'mascota'}`} /><Button secondary onClick={() => setPet(index, 'photo_data_url', undefined)}>Quitar foto</Button></div> : null}<Field label={`Foto de mascota ${index + 1} (opcional)`} type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void choosePhoto(index, file); }} /><p className="text-xs text-stone-500">JPG, PNG o WebP, hasta 10 MB. Se guarda una copia reducida.</p><Textarea label={`Dieta de mascota ${index + 1}`} value={pet.diet} onChange={value => setPet(index, 'diet', value)} /></fieldset>)}
    </Modal>;
}
