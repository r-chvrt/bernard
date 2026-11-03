// Stock disponible au format de l'API externe v1 (lecture seule), pensé pour proposer des recettes.
import { CATEGORIES } from '../public/catalog.js';
import { daysBetween } from './dates.js';
import { unitLabel } from './units.js';

const CATEGORY_LABEL = new Map(CATEGORIES.map((c) => [c.id, c.label]));
const round = (n) => Math.round(n * 1000) / 1000;

/** expired : périmé · expiring : périme dans `expiryDays` jours ou moins · ok · unknown : sans date. */
function expiryStatus(daysLeft, expiryDays) {
  if (daysLeft === null) return 'unknown';
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= expiryDays) return 'expiring';
  return 'ok';
}

/**
 * Le niveau de reste (¾, ½…) s'applique à l'entrée ouverte : quantité estimée = quantité × reste.
 * Sans niveau indiqué, on compte la quantité entière.
 */
const estimate = (p) => (p.state === 'open' && p.remaining ? round((p.quantity * p.remaining) / 100) : p.quantity);

export function buildStock({ products, spaces, settings, today, timezone }) {
  const spaceName = new Map(spaces.map((s) => [s.id, s.name]));
  const items = products
    .filter((p) => p.quantity > 0)
    .map((p) => {
      const daysLeft = p.expires_on ? daysBetween(today, p.expires_on) : null;
      return {
        id: p.id,
        name: p.name,
        category: p.category,
        category_label: CATEGORY_LABEL.get(p.category) ?? p.category,
        space: spaceName.get(p.space_id) ?? null,
        quantity: p.quantity,
        unit: p.unit,
        unit_label: unitLabel(p.unit, p.quantity),
        estimated_quantity: estimate(p),
        state: p.state,
        remaining: p.state === 'open' ? p.remaining ?? null : null,
        opened_on: p.opened_on ?? null,
        expires_on: p.expires_on ?? null,
        days_left: daysLeft,
        expiry_status: expiryStatus(daysLeft, settings.expiry_days),
      };
    });

  // Regroupement par aliment : même nom (sans tenir compte de la casse) et même unité.
  const groups = new Map();
  for (const it of items) {
    const key = `${it.name.toLowerCase()}\u0000${it.unit}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        name: it.name,
        category: it.category,
        category_label: it.category_label,
        unit: it.unit,
        quantity: 0,
        estimated_quantity: 0,
        open_quantity: 0,
        closed_quantity: 0,
        spaces: [],
        next_expiry: null,
        days_left: null,
        expiry_status: 'unknown',
        item_ids: [],
      };
      groups.set(key, g);
    }
    g.quantity += it.quantity;
    g.estimated_quantity += it.estimated_quantity;
    if (it.state === 'open') g.open_quantity += it.quantity;
    else g.closed_quantity += it.quantity;
    if (it.space && !g.spaces.includes(it.space)) g.spaces.push(it.space);
    if (it.expires_on && (!g.next_expiry || it.expires_on < g.next_expiry)) {
      g.next_expiry = it.expires_on;
      g.days_left = it.days_left;
      g.expiry_status = it.expiry_status;
    }
    g.item_ids.push(it.id);
  }
  const foods = [...groups.values()].map((g) => ({
    ...g,
    quantity: round(g.quantity),
    estimated_quantity: round(g.estimated_quantity),
    open_quantity: round(g.open_quantity),
    closed_quantity: round(g.closed_quantity),
    unit_label: unitLabel(g.unit, g.quantity),
  }));
  // Ce qui périme le plus tôt d'abord (à cuisiner en priorité), puis sans date, par nom.
  foods.sort((a, b) => (a.next_expiry ?? '9999').localeCompare(b.next_expiry ?? '9999') || a.name.localeCompare(b.name, 'fr'));

  return {
    version: 1,
    generated_at: new Date().toISOString(),
    today,
    timezone,
    expiry_days: settings.expiry_days,
    foods,
    items,
  };
}
