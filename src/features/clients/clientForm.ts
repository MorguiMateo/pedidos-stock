import Decimal from '../../lib/decimal';
import { isValidDate, today } from '../../lib/format';
import type { Client, Pet } from '../../lib/types';

export const MAX_PHOTO_LENGTH = 550000;
export type ClientEditorProps = { client?: Client; initialName?: string; initialPhone?: string; onSaved: (id: string, client: Client) => void; onCancel: () => void };
export type PetDraft = Omit<Pet, 'species' | 'weight_kg'> & { species: 'perro' | 'gato' | ''; weight_kg: string; notes: string; age_years: string; original_age_years?: string };
export type ClientDraft = { id?: string; version?: number; name: string; phone: string; email: string; address: string; notes: string; preferred_location_id: string; pets: PetDraft[] };
export const blankClient = (): ClientDraft => ({ name: '', phone: '', email: '', address: '', notes: '', preferred_location_id: '', pets: [] });
export const clientDraft = (client: Client): ClientDraft => ({ ...blankClient(), id: client.id, version: client.version, name: client.name, phone: client.phone ?? '', email: client.email ?? '', address: client.address ?? '', notes: client.notes ?? '', preferred_location_id: client.preferred_location_id ?? '', pets: (client.pets ?? []).map(pet => ({ ...pet, species: pet.species ?? '', weight_kg: pet.weight_kg ?? '', notes: pet.notes ?? '', age_years: pet.age_years ?? '', original_age_years: pet.age_years })) });
const decimal = (value: string) => value.trim().replace(',', '.');
export function validateClient(draft: ClientDraft): string | null {
  if (!draft.name.trim()) return 'Ingresá el nombre del cliente.';
  if (draft.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) return 'Ingresá un correo electrónico válido.';
  if (draft.pets.length > 100) return 'Podés registrar hasta 100 mascotas por cliente.';
  for (const pet of draft.pets) {
    if (!pet.name.trim() || (pet.weight_kg.trim() && (!/^\d+(?:[.,]\d+)?$/.test(pet.weight_kg.trim()) || new Decimal(decimal(pet.weight_kg)).lte(0)))) return 'Cada mascota necesita nombre y un peso mayor a cero si lo indicás.';
    if (pet.age_years.trim() && (!/^\d+(?:[.,]\d{1,4})?$/.test(pet.age_years.trim()) || Number(decimal(pet.age_years)) > 50)) return 'Ingresá una edad entre 0 y 50 años (podés usar decimales).';
    if (pet.notes.length > 5000) return 'Las anotaciones de cada mascota admiten hasta 5000 caracteres.';
    if (pet.photo_data_url && (pet.photo_data_url.length > MAX_PHOTO_LENGTH || !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(pet.photo_data_url))) return 'La foto no es válida o es demasiado grande.';
  }
  if (JSON.stringify(draft.pets).length > 4000000) return 'Las fotos de las mascotas superan el límite total. Quitá algunas fotos.';
  return null;
}
export function clientPayload(draft: ClientDraft, recordedOn = today()) {
  return { ...(draft.id ? { id: draft.id } : {}), name: draft.name.trim(), phone: draft.phone.trim(), email: draft.email.trim(), address: draft.address.trim(), notes: draft.notes.trim(), preferred_location_id: draft.preferred_location_id || null, pets: draft.pets.map((pet): Pet => {
    const age = pet.age_years.trim() ? new Decimal(decimal(pet.age_years)).toString() : undefined;
    const unchanged = age !== undefined && pet.original_age_years !== undefined && new Decimal(age).eq(pet.original_age_years);
    return { name: pet.name.trim(), ...(pet.species ? { species: pet.species } : {}), weight_kg: pet.weight_kg.trim() ? new Decimal(decimal(pet.weight_kg)).toString() : null, diet: pet.diet.trim(), ...(pet.notes.trim() ? { notes: pet.notes.trim() } : {}), ...(pet.photo_data_url ? { photo_data_url: pet.photo_data_url } : {}), ...(age !== undefined ? { age_years: age, age_recorded_on: unchanged && pet.age_recorded_on ? pet.age_recorded_on : recordedOn } : {}) };
  }) };
}
/** Calendar-month estimate, based on the recorded observation, not a fabricated birthday. */
export function petAgeMonths(pet: Pick<Pet, 'age_years' | 'age_recorded_on'>, asOf = today()): number | null {
  if (pet.age_years === undefined || !Number.isFinite(Number(pet.age_years)) || Number(pet.age_years) < 0 || !pet.age_recorded_on || !isValidDate(pet.age_recorded_on) || !isValidDate(asOf)) return null;
  const [year = 0, month = 1, day = 1] = pet.age_recorded_on.split('-').map(Number);
  const [currentYear = 0, currentMonth = 1, currentDay = 1] = asOf.split('-').map(Number);
  const lastDay = new Date(Date.UTC(currentYear, currentMonth, 0)).getUTCDate();
  const elapsed = Math.max(0, (currentYear - year) * 12 + currentMonth - month - (currentDay < Math.min(day, lastDay) ? 1 : 0));
  return new Decimal(pet.age_years).times(12).floor().toNumber() + elapsed;
}
export function petAgeLabel(pet: Pick<Pet, 'age_years' | 'age_recorded_on'>, asOf = today()): string {
  const months = petAgeMonths(pet, asOf);
  if (months === null) return 'Edad sin registrar';
  const years = Math.floor(months / 12), remainder = months % 12;
  const current = [years ? `${years} ${years === 1 ? 'año' : 'años'}` : '', remainder || !years ? `${remainder} ${remainder === 1 ? 'mes' : 'meses'}` : ''].filter(Boolean).join(' y ');
  const reference = pet.age_recorded_on!.split('-').reverse().join('/');
  return `Edad actual estimada: ${current} · ${pet.age_years} ${Number(pet.age_years) === 1 ? 'año' : 'años'} al ${reference}`;
}
