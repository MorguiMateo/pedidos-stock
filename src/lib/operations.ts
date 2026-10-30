import Decimal from './decimal';
import type { Item, Recipe, RecipeLine, Unit } from './types';

export function convertQuantity(value: string, from: Unit, to: Unit): Decimal {
  const family = (unit: Unit) => unit === 'g' || unit === 'kg' ? 'mass' : unit === 'ml' || unit === 'l' ? 'volume' : 'count';
  if (family(from) !== family(to)) throw new Error('Unidades incompatibles');
  if (from === to) return new Decimal(value);
  return new Decimal(value).times(from === 'kg' || from === 'l' ? 1000 : '.001');
}
/** Percentages only compare mass with mass, never grams with litres or units. */
export function recipePercentages(lines: RecipeLine[]): (string | null)[] {
  const mass = lines.map(line => line.unit === 'kg' || line.unit === 'g' ? convertQuantity(line.quantity || '0', line.unit, 'kg') : null);
  const total = mass.reduce<Decimal>((sum, value) => sum.plus(value ?? 0), new Decimal(0));
  return mass.map(value => value && total.gt(0) ? value.div(total).times(100).toFixed(2) : null);
}
export function estimatedRecipeCost(recipe: Recipe | undefined, items: Item[]) {
  if (!recipe) return null;
  let total = new Decimal(0);
  for (const line of recipe.lines) {
    const ingredient = items.find(item => item.id === line.ingredient_id);
    if (!ingredient) return null;
    try { total = total.plus(convertQuantity(line.quantity, line.unit, ingredient.unit).times(ingredient.price)); } catch { return null; }
  }
  return total.div(recipe.yield_quantity);
}
export function expiryFourMonths(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) return '';
  const end = new Date(Date.UTC(year, month + 3 + 1, 0));
  return new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), Math.min(day, end.getUTCDate()))).toISOString().slice(0, 10);
}
export function csvRows(rows: unknown[][]): string {
  // Neutralize spreadsheet formula cells while keeping the export human-readable.
  return '\uFEFF' + rows.map(row => row.map(value => {
    let cell = value == null ? '' : String(value);
    if (/^[\s]*[=+@-]/.test(cell) && !/^-?\d+(\.\d+)?$/.test(cell)) cell = `'${cell}`;
    return `"${cell.replace(/"/g, '""')}"`;
  }).join(';')).join('\r\n');
}
