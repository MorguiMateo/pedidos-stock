import React, { useRef, useState } from 'react';
import { Image, View } from 'react-native';
import { Button, IconButton, Text, TextInput } from 'react-native-paper';
import { COLORS } from '../../lib/theme';
import { Chip } from '../../components/ui';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { duplicatePhoneClients } from '../../lib/clientHistory';
import { useWorkspace } from '../../lib/workspace';
import type { Client } from '../../lib/types';
import { errorText, Form, styles } from '../sales/components';
import { blankClient, clientDraft, clientPayload, validateClient, type PetDraft, type ClientEditorProps, petAgeLabel, MAX_PHOTO_LENGTH } from './clientForm';

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

  async function choosePhoto(index: number) {
    setError(''); setUploading(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) { setError('Permití el acceso a las fotos para elegir una imagen.'); return; }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, quality: 0.8 });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      const resize = Math.max(asset.width, asset.height) > 640 ? [{ resize: asset.width >= asset.height ? { width: 640 } : { height: 640 } }] : [];
      const photo = await ImageManipulator.manipulateAsync(asset.uri, resize, { compress: 0.65, format: ImageManipulator.SaveFormat.JPEG, base64: true });
      const url = `data:image/jpeg;base64,${photo.base64 ?? ''}`;
      if (!photo.base64 || url.length > MAX_PHOTO_LENGTH) throw new Error('La foto es demasiado grande. Elegí otra imagen.');
      setPet(index, 'photo_data_url', url);
    } catch (caught) { setError(errorText(caught)); } finally { setUploading(false); }
  }
  return <Form visible title={draft?.id ? 'Editar cliente' : 'Nuevo cliente'} onDismiss={onCancel} onSave={() => void save()} saving={busy || ws.isSaving || uploading} disabled={!available} error={error}>
      {draft ? <>
        <TextInput mode="outlined" style={{ backgroundColor: COLORS.surface }} accessibilityLabel="Nombre del cliente" label="Nombre del cliente" value={draft.name} onChangeText={name => setDraft({ ...draft, name })} />
        <TextInput mode="outlined" style={{ backgroundColor: COLORS.surface }} accessibilityLabel="Teléfono" label="Teléfono" keyboardType="phone-pad" value={draft.phone} onChangeText={phone => setDraft({ ...draft, phone })} />
        {duplicates.length ? <View style={styles.lineCard}>
          <Text style={styles.muted}>Teléfono ya registrado: {duplicates.map(client => client.name).join(', ')}. Revisá estos contactos antes de crear otro.</Text>
          {duplicates.map(client => <Button key={client.id} icon="account-search-outline" onPress={() => edit(client)}>Usar ficha de {client.name}</Button>)}
        </View> : null}
        <TextInput mode="outlined" style={{ backgroundColor: COLORS.surface }} accessibilityLabel="Correo electrónico" label="Correo electrónico" keyboardType="email-address" autoCapitalize="none" value={draft.email} onChangeText={email => setDraft({ ...draft, email })} />
        <TextInput mode="outlined" style={{ backgroundColor: COLORS.surface }} accessibilityLabel="Domicilio" label="Domicilio" value={draft.address} onChangeText={address => setDraft({ ...draft, address })} />
        <View>
          <Text style={styles.label}>Punto de retiro habitual</Text>
          <View style={styles.wrap}>
            <Chip selected={!draft.preferred_location_id} onPress={() => setDraft({ ...draft, preferred_location_id: '' })}>Sin preferencia</Chip>
            {pickupLocations.map(location => <Chip key={location.id} selected={draft.preferred_location_id === location.id} onPress={() => setDraft({ ...draft, preferred_location_id: location.id })}>{location.name}</Chip>)}
          </View>
          {draft.preferred_location_id && !pickupLocations.some(location => location.id === draft.preferred_location_id) ? <Text style={styles.muted}>Preferencia guardada: {ws.data?.locations.find(location => location.id === draft.preferred_location_id)?.name ?? 'Punto no disponible'} (no disponible para nuevos pedidos). Podés conservarla o elegir otra.</Text> : null}
        </View>
        <TextInput mode="outlined" style={{ backgroundColor: COLORS.surface }} accessibilityLabel="Notas" label="Notas" multiline value={draft.notes} onChangeText={notes => setDraft({ ...draft, notes })} />
        <View style={[styles.row, { justifyContent: 'space-between' }]}>
          <Text style={styles.label}>Mascotas</Text>
          <Button icon="plus" onPress={() => setDraft(current => ({ ...current, pets: [...current.pets, { name: '', species: 'perro', weight_kg: '', diet: '', notes: '', age_years: '' }] }))}>Agregar mascota</Button>
        </View>
        {draft.pets.map((pet, index) => <View key={index} style={styles.lineCard}>
          <View style={[styles.row, { justifyContent: 'space-between' }]}>
            <Text style={styles.label}>Mascota {index + 1}</Text>
            <IconButton icon="close" accessibilityLabel={`Quitar mascota ${index + 1}`} disabled={uploading} onPress={() => setDraft(current => current ? { ...current, pets: current.pets.filter((_, i) => i !== index) } : current)} />
          </View>
          <Text style={styles.label}>Especie</Text>
          <View style={styles.wrap}>
            <Chip selected={pet.species === 'perro'} accessibilityLabel={`Mascota ${index + 1}: perro`} onPress={() => setPet(index, 'species', 'perro')}>🐶 Perro</Chip>
            <Chip selected={pet.species === 'gato'} accessibilityLabel={`Mascota ${index + 1}: gato`} onPress={() => setPet(index, 'species', 'gato')}>🐱 Gato</Chip>
          </View>
          {!pet.species ? <Text style={styles.muted}>Especie sin registrar. Elegí perro o gato para completarla.</Text> : null}
          <TextInput mode="outlined" style={{ backgroundColor: COLORS.surface }} accessibilityLabel="Nombre" label="Nombre" value={pet.name} onChangeText={value => setPet(index, 'name', value)} />
          <TextInput mode="outlined" style={{ backgroundColor: COLORS.surface }} accessibilityLabel="Peso en kg (opcional)" label="Peso en kg (opcional)" keyboardType="decimal-pad" value={pet.weight_kg} onChangeText={value => setPet(index, 'weight_kg', value)} />

          <TextInput mode="outlined" style={{ backgroundColor: COLORS.surface }} accessibilityLabel={`Edad en años de mascota ${index + 1} (opcional)`} label="Edad en años (opcional)" keyboardType="decimal-pad" value={pet.age_years} onChangeText={value => setPet(index, 'age_years', value)} />
          {pet.age_recorded_on ? <Text style={styles.muted}>{petAgeLabel(pet)}</Text> : <Text style={styles.muted}>La fecha de referencia se registra al guardar la edad. Podés usar decimales (0,5 = 6 meses).</Text>}
          <TextInput mode="outlined" style={{ backgroundColor: COLORS.surface }} accessibilityLabel={`Anotaciones de mascota ${index + 1} (opcional)`} label="Anotaciones (opcional)" multiline value={pet.notes} onChangeText={value => setPet(index, 'notes', value)} />
          {pet.photo_data_url ? <><Image source={{ uri: pet.photo_data_url }} accessibilityLabel={`Foto de ${pet.name || 'mascota'}`} style={{ width: 120, height: 120, borderRadius: 12 }} /><Button onPress={() => setPet(index, 'photo_data_url', undefined)}>Quitar foto</Button></> : null}
          <Button disabled={busy || uploading} icon="image-plus" onPress={() => void choosePhoto(index)}>{uploading ? 'Procesando foto…' : pet.photo_data_url ? 'Cambiar foto' : 'Agregar foto (opcional)'}</Button>
          <TextInput mode="outlined" style={{ backgroundColor: COLORS.surface }} accessibilityLabel="Dieta" label="Dieta" multiline value={pet.diet} onChangeText={value => setPet(index, 'diet', value)} />
        </View>)}
      </> : null}
    </Form>;
}
