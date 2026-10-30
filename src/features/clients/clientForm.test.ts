import { describe, expect, it } from 'vitest';
import { blankClient, clientDraft, clientPayload, petAgeLabel, petAgeMonths, validateClient } from './clientForm';
import type { Client } from '../../lib/types';
const existing: Client = { id: 'client', name: 'Ana', version: 2, pets: [{ name: 'Nube', species: 'gato', weight_kg: '4', diet: '', age_years: '3', age_recorded_on: '2026-01-30', notes: 'Rescatada' }] };
describe('pet age observations', () => {
  it('counts completed calendar months, including short months and year boundaries', () => {
    const pet = existing.pets![0]!;
    expect(petAgeMonths(pet, '2026-02-27')).toBe(36);
    expect(petAgeMonths(pet, '2026-02-28')).toBe(37);
    expect(petAgeMonths(pet, '2027-01-30')).toBe(48);
    expect(petAgeLabel(pet, '2026-10-30')).toContain('3 años y 9 meses');
    expect(petAgeLabel(pet, '2026-10-30')).toContain('3 años al 30/01/2026');
  });
  it('records a new observation only when age changes, retaining all existing metadata', () => {
    const draft = clientDraft(existing);
    draft.pets[0]!.notes = 'Nueva anotación';
    expect(clientPayload(draft, '2026-10-30').pets[0]).toMatchObject({ age_years: '3', age_recorded_on: '2026-01-30', notes: 'Nueva anotación' });
    draft.pets[0]!.age_years = '3,0';
    expect(clientPayload(draft, '2026-10-30').pets[0]!.age_recorded_on).toBe('2026-01-30');
    draft.pets[0]!.age_years = '4';
    expect(clientPayload(draft, '2026-10-30').pets[0]).toMatchObject({ age_years: '4', age_recorded_on: '2026-10-30' });
    draft.pets[0]!.age_years = '';
    expect(clientPayload(draft).pets[0]).not.toHaveProperty('age_recorded_on');
  });
  it('supports fractional years and optional unknown age', () => {
    expect(petAgeMonths({ age_years: '0.5', age_recorded_on: '2026-10-30' }, '2026-11-30')).toBe(7);
    expect(petAgeMonths({}, '2026-11-30')).toBeNull();
    const draft = clientDraft(existing); draft.pets[0]!.age_years = '-1';
    expect(validateClient(draft)).toContain('edad');
    draft.pets[0]!.age_years = '51'; expect(validateClient(draft)).toContain('edad');
    draft.pets[0]!.age_years = ''; expect(validateClient(draft)).toBeNull();
  });
  it('rejects executable image formats and oversized photos before saving', () => {
    const draft = clientDraft(existing); draft.pets[0]!.photo_data_url = 'data:image/svg+xml,<svg onload="evil()"/>';
    expect(validateClient(draft)).toContain('foto');
    draft.pets[0]!.photo_data_url = `data:image/jpeg;base64,/9j/${'A'.repeat(550000)}`;
    expect(validateClient(draft)).toContain('foto');
    expect(validateClient({ ...blankClient(), name: 'Nombre' })).toBeNull();
  });
});
