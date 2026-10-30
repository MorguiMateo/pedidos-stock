import { describe, it, expect } from 'vitest';
import { csvRows, expiryFourMonths, recipePercentages } from './operations';
describe('Operaciones de inventario y exportación', () => {
  it('calcula cuatro meses calendario y limita al fin del mes', () => {
    expect(expiryFourMonths('2026-10-31')).toBe('2027-02-28');
    expect(expiryFourMonths('2027-10-31')).toBe('2028-02-29');
    expect(expiryFourMonths('2026-01-15')).toBe('2026-05-15');
  });
  it('normaliza kg/g y no mezcla volumen o unidades en porcentajes', () => {
    expect(recipePercentages([{ ingredient_id: 'a', quantity: '1', unit: 'kg' }, { ingredient_id: 'b', quantity: '500', unit: 'g' }, { ingredient_id: 'c', quantity: '1', unit: 'l' }])).toEqual(['66.67', '33.33', null]);
  });
  it('exporta CSV con saltos, comillas, separadores y fórmulas neutralizadas', () => {
    expect(csvRows([['=HYPERLINK("x")', 'A;B', 'línea\nnueva', '-1.25']])).toBe('\uFEFF"\'=HYPERLINK(""x"")";"A;B";"línea\nnueva";"-1.25"');
  });
});
