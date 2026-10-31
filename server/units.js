// Unités disponibles. `step` = pas utilisé par les boutons −/+.
export const UNITS = [
  { id: 'unité', plural: 'unités', step: 1 },
  { id: 'paquet', plural: 'paquets', step: 1 },
  { id: 'boîte', plural: 'boîtes', step: 1 },
  { id: 'bouteille', plural: 'bouteilles', step: 1 },
  { id: 'pot', plural: 'pots', step: 1 },
  { id: 'sachet', plural: 'sachets', step: 1 },
  { id: 'brique', plural: 'briques', step: 1 },
  { id: 'barquette', plural: 'barquettes', step: 1 },
  { id: 'kg', plural: 'kg', step: 0.5 },
  { id: 'g', plural: 'g', step: 100 },
  { id: 'L', plural: 'L', step: 0.5 },
  { id: 'cL', plural: 'cL', step: 10 },
];

export const UNIT_IDS = new Set(UNITS.map((u) => u.id));
export const DEFAULT_UNIT = 'unité';

export function unitLabel(unit, quantity) {
  const u = UNITS.find((x) => x.id === unit);
  if (!u) return unit;
  return quantity > 1 ? u.plural : u.id;
}
