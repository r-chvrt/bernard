import { CATEGORIES, DICTIONARY, guessCategory, norm } from './catalog.js';

/* ================= Utilitaires ================= */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = (id) => `<svg aria-hidden="true"><use href="#i-${id}"/></svg>`;
const numFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const round = (n) => Math.round(n * 1000) / 1000;
const plural = (n, one, many) => (n > 1 ? many : one);

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
const fmtDate = (s) => (s ? s.split('-').reverse().join('/') : '');
const fmtDateShort = (s) => (s ? s.split('-').reverse().slice(0, 2).join('/') : '');

function parseQty(v) {
  const n = Number(String(v).replace(',', '.').trim());
  return Number.isFinite(n) ? n : NaN;
}

const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* stockage indisponible */ }
  },
};

/* ================= API ================= */

async function api(method, path, body) {
  // Toute requête d'écriture est envoyée en JSON (exigé par le serveur, protection CSRF).
  const write = method !== 'GET';
  const res = await fetch(path, {
    method,
    headers: write ? { 'Content-Type': 'application/json' } : {},
    body: write ? JSON.stringify(body ?? {}) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Erreur ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ================= État ================= */

const S = { spaces: [], products: [], history: [], units: [], remaining_levels: [], settings: {}, loaded: false };
const UI = {
  view: 'all',
  q: '',
  space: store.get('f-space', ''),
  category: '',
  expiry: '',
  sort: store.get('f-sort', 'expiry'),
};

async function refresh() {
  const data = await api('GET', '/api/state');
  Object.assign(S, data, { loaded: true });
  if (UI.space && !S.spaces.some((s) => String(s.id) === UI.space)) UI.space = '';
  render();
}

const spaceName = (id) => S.spaces.find((s) => s.id === id)?.name ?? '—';
const unitOf = (id) => S.units.find((u) => u.id === id) || { id, plural: id, step: 1 };
const unitLabel = (unit, q) => (q > 1 ? unitOf(unit).plural : unit);
const categoryOf = (id) => CATEGORIES.find((c) => c.id === id) || CATEGORIES.at(-1);
const qtyLabel = (p) => `${numFmt.format(p.quantity)} ${unitLabel(p.unit, p.quantity)}`;

/** Indicateurs d'un produit (calculés avec les seuils des paramètres). */
function status(p, today = localToday()) {
  const st = { expired: false, soon: false, daysLeft: null, openDays: null, openLong: false };
  if (p.expires_on) {
    st.daysLeft = daysBetween(today, p.expires_on);
    st.expired = st.daysLeft < 0;
    st.soon = !st.expired && st.daysLeft <= S.settings.expiry_days;
  }
  if (p.state === 'open' && p.opened_on) {
    st.openDays = Math.max(0, daysBetween(p.opened_on, today));
    st.openLong = st.openDays >= S.settings.open_days;
  }
  return st;
}

/* ================= Toasts ================= */

function toast(message, { error = false, action, onAction, duration = 5000 } = {}) {
  const el = document.createElement('div');
  el.className = `toast${error ? ' error' : ''}`;
  el.setAttribute('role', error ? 'alert' : 'status');
  el.innerHTML = `<span>${esc(message)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action;
    b.addEventListener('click', () => { el.remove(); onAction(); });
    el.append(b);
  }
  const box = $('#toasts');
  box.append(el);
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(() => el.remove(), action ? Math.max(duration, 7000) : duration);
}
const fail = (err) => toast(err.message || 'Une erreur est survenue', { error: true });

/* ================= Navigation ================= */

const VIEWS = {
  '#/': 'all', '': 'all', '#/ouverts': 'open', '#/fermes': 'closed', '#/parametres': 'settings',
};
const TITLES = { all: 'Tout le stock', open: 'Produits ouverts', closed: 'Produits fermés' };

function onRoute() {
  UI.view = VIEWS[location.hash] || 'all';
  document.body.classList.remove('filters-open');
  $('.sidebar-backdrop').hidden = true;
  closeMenu();
  render();
  $('#main').focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function render() {
  if (!S.loaded) return;
  $('#loading').hidden = true;
  $$('.tabs a').forEach((a) => {
    if (a.dataset.view === UI.view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const settings = UI.view === 'settings';
  $('#view-list').hidden = settings;
  $('#view-settings').hidden = !settings;
  document.title = `${settings ? 'Paramètres' : TITLES[UI.view]} · Bernard`;
  if (settings) renderSettings();
  else renderList();
}

/* ================= Vues produits ================= */

const EXPIRY_FILTERS = [
  { id: '', label: 'Toutes les dates' },
  { id: 'expired', label: 'Périmés' },
  { id: 'soon', label: 'Bientôt périmés' },
  { id: 'alert', label: 'Périmés ou bientôt' },
  { id: 'openlong', label: 'Ouverts depuis longtemps', notIn: 'closed' },
  { id: 'dated', label: 'Avec date de péremption' },
  { id: 'undated', label: 'Sans date de péremption' },
];
const SORTS = [
  { id: 'expiry', label: 'Péremption proche' },
  { id: 'name', label: 'Nom (A → Z)' },
  { id: 'category', label: 'Catégorie' },
  { id: 'space', label: 'Espace' },
  { id: 'opened', label: 'Ouverture la plus ancienne' },
  { id: 'recent', label: 'Ajout récent' },
];

function viewBase() {
  return S.products.filter((p) => UI.view === 'all' || (UI.view === 'open' ? p.state === 'open' : p.state === 'closed'));
}

function matchExpiry(p, filter, today) {
  if (!filter) return true;
  const st = status(p, today);
  switch (filter) {
    case 'expired': return st.expired;
    case 'soon': return st.soon;
    case 'alert': return st.expired || st.soon;
    case 'openlong': return st.openLong;
    case 'dated': return Boolean(p.expires_on);
    case 'undated': return !p.expires_on;
    default: return true;
  }
}

/** Le produit passe-t-il les filtres actifs ? `except` ignore un filtre (pour les compteurs de la sidebar). */
function matches(p, today, except = null) {
  const q = norm(UI.q);
  if (q && !norm(p.name).includes(q)) return false;
  if (except !== 'space' && UI.space && String(p.space_id) !== UI.space) return false;
  if (except !== 'category' && UI.category && p.category !== UI.category) return false;
  if (except !== 'expiry' && !matchExpiry(p, UI.expiry, today)) return false;
  return true;
}

function sortProducts(list) {
  const byName = (a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }) || a.id - b.id;
  const spacePos = (id) => S.spaces.findIndex((s) => s.id === id);
  const catPos = (id) => CATEGORIES.findIndex((c) => c.id === id);
  const far = '9999-12-31';
  const sorters = {
    name: byName,
    expiry: (a, b) => (a.expires_on || far).localeCompare(b.expires_on || far) || byName(a, b),
    category: (a, b) => catPos(a.category) - catPos(b.category) || byName(a, b),
    space: (a, b) => spacePos(a.space_id) - spacePos(b.space_id) || byName(a, b),
    opened: (a, b) => (a.opened_on || far).localeCompare(b.opened_on || far) || byName(a, b),
    recent: (a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id,
  };
  return list.sort(sorters[UI.sort] || byName);
}

function renderSummary(base, shown, today) {
  // Le résumé tient compte de la recherche, de l'espace et de la catégorie, mais pas du filtre de date.
  const scope = base.filter((p) => matches(p, today, 'expiry'));
  const sts = scope.map((p) => status(p, today));
  const count = (fn) => sts.filter(fn).length;
  const cards = [{ label: plural(shown.length, 'entrée affichée', 'entrées affichées'), value: shown.length }];
  if (UI.view === 'all') {
    const open = scope.filter((p) => p.state === 'open').length;
    cards.push({ label: plural(open, 'ouvert', 'ouverts'), value: open, cls: 'open' });
    cards.push({ label: plural(scope.length - open, 'fermé', 'fermés'), value: scope.length - open });
  }
  const soon = count((s) => s.soon);
  const expired = count((s) => s.expired);
  cards.push({ label: `${plural(soon, 'bientôt périmé', 'bientôt périmés')} (≤ ${S.settings.expiry_days} j)`, value: soon, cls: 'warn', filter: 'soon' });
  cards.push({ label: plural(expired, 'périmé', 'périmés'), value: expired, cls: 'danger', filter: 'expired' });
  if (UI.view !== 'closed') {
    const long = count((s) => s.openLong);
    cards.push({ label: `${plural(long, 'ouvert', 'ouverts')} depuis ≥ ${S.settings.open_days} j`, value: long, cls: 'warn', filter: 'openlong' });
  }
  $('#summary').innerHTML = cards
    .map((c) =>
      c.filter
        ? `<button type="button" class="stat ${c.cls || ''}" data-filter="${c.filter}" aria-pressed="${UI.expiry === c.filter}"
             title="Afficher uniquement ces produits"><b>${c.value}</b><span>${esc(c.label)}</span></button>`
        : `<div class="stat ${c.cls || ''}"><b>${c.value}</b><span>${esc(c.label)}</span></div>`,
    )
    .join('');
}

function renderSidebar(base, today) {
  const countBy = (except, fn) => base.filter((p) => matches(p, today, except) && fn(p)).length;
  const item = (group, value, label, n, iconHtml = '') => {
    const active = (UI[group] || '') === value;
    return `<button type="button" class="fitem" data-fgroup="${group}" data-fvalue="${esc(value)}" aria-pressed="${active}"
      ${n === 0 && !active ? 'data-empty' : ''}>${iconHtml}<span class="flabel">${esc(label)}</span><span class="n">${n}</span></button>`;
  };

  const spaces = [item('space', '', 'Tous les espaces', countBy('space', () => true))]
    .concat(S.spaces.map((s) => item('space', String(s.id), s.name, countBy('space', (p) => p.space_id === s.id))));

  const cats = [item('category', '', 'Toutes les catégories', countBy('category', () => true), '<span class="cat-icon" aria-hidden="true">✳️</span>')];
  for (const c of CATEGORIES) {
    const n = countBy('category', (p) => p.category === c.id);
    if (n > 0 || UI.category === c.id) cats.push(item('category', c.id, c.label, n, `<span class="cat-icon" aria-hidden="true">${c.icon}</span>`));
  }

  const dates = EXPIRY_FILTERS.filter((f) => f.notIn !== UI.view).map((f) =>
    item('expiry', f.id, f.label, countBy('expiry', (p) => matchExpiry(p, f.id, today))));

  const active = [UI.space, UI.category, UI.expiry].filter(Boolean).length;
  $('#sidebar-body').innerHTML = `
    <section class="fgroup"><h3>Espace</h3><div class="flist">${spaces.join('')}</div></section>
    <section class="fgroup"><h3>Catégorie</h3><div class="flist">${cats.join('')}</div></section>
    <section class="fgroup"><h3>Péremption</h3><div class="flist">${dates.join('')}</div></section>
    ${active ? '<button type="button" class="link-btn reset" data-action="reset-filters">Réinitialiser les filtres</button>' : ''}`;
  const badge = $('#filters-count');
  badge.hidden = !active;
  badge.textContent = active;
}

function remainingLevel(p) {
  return S.remaining_levels.find((l) => l.value === p.remaining) || null;
}

function gaugeHtml(value) {
  // 4 barres : plein = 4, ¾ = 3, ½ = 2, ¼ = 1, presque vide = 0 (contour seul)
  const filled = value == null ? 0 : Math.round(value / 25);
  return `<span class="gauge${value == null ? ' unknown' : value <= 25 ? ' low' : ''}" aria-hidden="true">${[1, 2, 3, 4]
    .map((i) => `<i${i <= filled ? ' class="on"' : ''}></i>`).join('')}</span>`;
}

function badges(p, st) {
  const out = [
    p.state === 'open' ? '<span class="badge open">Ouvert</span>' : '<span class="badge closed">Fermé</span>',
  ];
  if (st.expired) out.push(`<span class="badge expired">⛔ Périmé${st.daysLeft === -1 ? ' depuis hier' : ` depuis ${-st.daysLeft} j`}</span>`);
  else if (st.soon) {
    const txt = st.daysLeft === 0 ? "Périme aujourd'hui" : st.daysLeft === 1 ? 'Périme demain' : `Périme dans ${st.daysLeft} j`;
    out.push(`<span class="badge soon">⏳ ${txt}</span>`);
  }
  if (st.openLong) out.push(`<span class="badge long">Ouvert depuis ${st.openDays} j</span>`);
  return out.join('');
}

function itemHtml(p, today) {
  const st = status(p, today);
  const cls = ['item', p.state === 'open' && 'is-open', st.soon && 'is-soon', st.expired && 'is-expired'].filter(Boolean).join(' ');
  const cat = categoryOf(p.category);
  const meta = [`<span>${icon('pin')}${esc(spaceName(p.space_id))}</span>`];
  if (p.expires_on) meta.push(`<span>Péremption : ${fmtDate(p.expires_on)}</span>`);
  if (p.state === 'open' && p.opened_on) meta.push(`<span>Ouvert le ${fmtDate(p.opened_on)}${st.openLong ? '' : ` (${st.openDays} j)`}</span>`);
  const name = esc(p.name);
  const step = unitOf(p.unit).step;
  let level = '';
  if (p.state === 'open') {
    const l = remainingLevel(p);
    level = `<button type="button" class="level-btn" data-act="level" aria-haspopup="menu" aria-expanded="false"
        aria-label="Reste dans ${name} : ${l ? esc(l.label) : 'non indiqué'}. Modifier">
        ${gaugeHtml(l?.value)}<span><span class="lw">Reste </span>${l ? esc(l.short) : '?'}</span></button>`;
  }
  return `<li class="${cls}" data-id="${p.id}">
    <span class="cat-badge" role="img" aria-label="${esc(cat.label)}" title="${esc(cat.label)}">${cat.icon}</span>
    <div class="item-main">
      <div class="item-title"><span class="name">${name}</span>${badges(p, st)}</div>
      <div class="item-meta">${meta.join('')}</div>
    </div>
    <div class="item-side">
      ${level}
      <div class="qty-box">
        <button type="button" class="icon-btn" data-act="dec" aria-label="Retirer ${esc(numFmt.format(step))} ${esc(p.unit)} de ${name}">${icon('minus')}</button>
        <button type="button" class="qty-btn" data-act="qty" aria-label="Quantité : ${esc(qtyLabel(p))}. Modifier">${esc(qtyLabel(p))}</button>
        <button type="button" class="icon-btn" data-act="inc" aria-label="Ajouter ${esc(numFmt.format(step))} ${esc(p.unit)} de ${name}">${icon('plus')}</button>
      </div>
      <div class="actions">
        ${p.state === 'closed' ? `<button type="button" class="btn btn-sm open-btn" data-act="open" aria-label="Ouvrir ${name}">Ouvrir</button>` : ''}
        <button type="button" class="icon-btn" data-act="edit" aria-label="Modifier ${name}" title="Modifier">${icon('edit')}</button>
        <button type="button" class="icon-btn danger" data-act="delete" aria-label="Supprimer ${name}" title="Supprimer">${icon('trash')}</button>
      </div>
    </div>
  </li>`;
}

function emptyHtml() {
  if (!S.spaces.length) {
    return `<div class="big">🗄️</div><h2>Créez d'abord un espace de rangement</h2>
      <p>Placard, frigo, congélateur… Chaque produit est rangé dans un espace.</p>
      <div class="row-actions"><a class="btn btn-primary" href="#/parametres">Ouvrir les paramètres</a></div>`;
  }
  if (!S.products.length) {
    return `<div class="big">🧺</div><h2>Votre stock est vide</h2>
      <p>Ajoutez vos premiers produits : seuls le nom, l'espace, la quantité et l'état sont nécessaires.
      Vous pouvez aussi charger quelques exemples pour découvrir l'application.</p>
      <div class="row-actions">
        <button type="button" class="btn btn-primary" data-action="add">${icon('plus')} Ajouter un produit</button>
        <button type="button" class="btn" data-action="demo">Charger des exemples</button>
      </div>`;
  }
  if (UI.q || UI.space || UI.category || UI.expiry) {
    return `<div class="big">🔎</div><h2>Aucun produit ne correspond</h2>
      <p>Essayez une autre recherche ou retirez les filtres.</p>
      <div class="row-actions"><button type="button" class="btn" data-action="reset-filters">Réinitialiser les filtres</button></div>`;
  }
  return UI.view === 'open'
    ? `<div class="big">📦</div><h2>Aucun produit ouvert</h2><p>Utilisez le bouton « Ouvrir » d'un produit fermé pour le faire apparaître ici.</p>`
    : `<div class="big">✨</div><h2>Aucun produit fermé</h2><p>Les produits ajoutés avec l'état « Fermé » apparaîtront ici.</p>
       <div class="row-actions"><button type="button" class="btn btn-primary" data-action="add">${icon('plus')} Ajouter un produit</button></div>`;
}

function filterDescription() {
  const parts = [];
  if (UI.q) parts.push(`recherche « ${UI.q} »`);
  if (UI.space) parts.push(`espace : ${spaceName(Number(UI.space))}`);
  if (UI.category) parts.push(`catégorie : ${categoryOf(UI.category).label}`);
  if (UI.expiry) parts.push(EXPIRY_FILTERS.find((f) => f.id === UI.expiry).label.toLowerCase());
  return parts;
}

function renderList() {
  const today = localToday();
  $('#list-title').textContent = TITLES[UI.view];
  if ($('#f-q').value !== UI.q) $('#f-q').value = UI.q;
  if (UI.view === 'closed' && UI.expiry === 'openlong') UI.expiry = '';
  $('#sort-label').textContent = SORTS.find((s) => s.id === UI.sort)?.label ?? '';

  const base = viewBase();
  const shown = sortProducts(base.filter((p) => matches(p, today)));
  renderSummary(base, shown, today);
  renderSidebar(base, today);

  const parts = filterDescription();
  const info = $('#filter-info');
  info.hidden = parts.length === 0;
  info.innerHTML = parts.length
    ? `<span>Filtres : ${esc(parts.join(' · '))}</span><button type="button" class="link-btn" data-action="reset-filters">Tout afficher</button>`
    : '';

  $('#list').innerHTML = shown.map((p) => itemHtml(p, today)).join('');
  const empty = $('#empty');
  empty.hidden = shown.length > 0;
  if (!shown.length) empty.innerHTML = emptyHtml();
  const noData = S.products.length === 0;
  $('.toolbar').hidden = noData;
  $('#summary').hidden = noData;
  $('.layout').classList.toggle('no-sidebar', noData);

  renderPrint(shown, today, parts);
}

/* ================= Impression ================= */

function renderPrint(products, today, filterParts) {
  const now = new Date();
  const rows = [];
  let lastGroup = null;
  const groupOf = UI.sort === 'space' ? (p) => spaceName(p.space_id) : UI.sort === 'category' ? (p) => categoryOf(p.category).label : null;
  for (const p of products) {
    if (groupOf && groupOf(p) !== lastGroup) {
      lastGroup = groupOf(p);
      rows.push(`<tr class="print-group"><td colspan="7">${esc(lastGroup)}</td></tr>`);
    }
    const st = status(p, today);
    let exp = p.expires_on ? fmtDate(p.expires_on) : '—';
    if (st.expired) exp = `<span class="p-expired">${exp} — PÉRIMÉ</span>`;
    else if (st.soon) exp = `<span class="p-flag">${exp} ⚠ J-${st.daysLeft}</span>`;
    const opened = p.state === 'open' && p.opened_on ? `${fmtDate(p.opened_on)}${st.openLong ? ` <span class="p-flag">(${st.openDays} j)</span>` : ''}` : '—';
    const level = p.state === 'open' ? remainingLevel(p) : null;
    rows.push(`<tr>
      <td class="box"><span></span></td>
      <td><span class="p-cat">${categoryOf(p.category).icon}</span> ${esc(p.name)}</td>
      <td class="qty">${esc(qtyLabel(p))}${level ? `<br><small>reste ${esc(level.short)}</small>` : ''}</td>
      <td>${p.state === 'open' ? '<b>Ouvert</b>' : 'Fermé'}</td>
      <td>${esc(spaceName(p.space_id))}</td>
      <td>${exp}</td>
      <td>${opened}</td>
    </tr>`);
  }
  $('#print').innerHTML = `
    <div class="print-head"><h1>${esc(TITLES[UI.view])}</h1>
      <span>Imprimé le ${now.toLocaleDateString('fr-FR')} à ${now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span></div>
    <p class="print-sub">${products.length} ${plural(products.length, 'entrée', 'entrées')}${filterParts.length ? ` · Filtres : ${esc(filterParts.join(' · '))}` : ''}</p>
    <table>
      <thead><tr><th></th><th>Produit</th><th>Quantité</th><th>État</th><th>Espace</th><th>Péremption</th><th>Ouvert le</th></tr></thead>
      <tbody>${rows.join('') || '<tr><td colspan="7">Aucun produit.</td></tr>'}</tbody>
    </table>
    <p class="print-legend">⚠ J-n : périme dans n jours (seuil ${S.settings.expiry_days} j) · (n j) : ouvert depuis n jours (seuil ${S.settings.open_days} j) · Cochez la case quand le produit est terminé.</p>`;
}

/* ================= Menus déroulants ================= */

/**
 * Petit menu contextuel accessible (rôle menu, flèches, Échap) ancré sous un bouton.
 * items : [{ value, label, html?, checked }]
 */
let openMenu = null;
function closeMenu(focusButton = false) {
  if (!openMenu) return;
  const { el, button } = openMenu;
  el.remove();
  button.setAttribute('aria-expanded', 'false');
  openMenu = null;
  if (focusButton) button.focus();
}

function showMenu(button, items, onPick, { label = '' } = {}) {
  const already = openMenu?.button === button;
  closeMenu();
  if (already) return;
  const el = document.createElement('div');
  el.className = 'menu';
  el.setAttribute('role', 'menu');
  if (label) el.setAttribute('aria-label', label);
  el.innerHTML = items
    .map((it, i) => `<button type="button" role="menuitemradio" aria-checked="${Boolean(it.checked)}" data-i="${i}" tabindex="-1">
        <span class="menu-check">${it.checked ? icon('check') : ''}</span>${it.html ?? esc(it.label)}</button>`)
    .join('');
  document.body.append(el);
  const r = button.getBoundingClientRect();
  const w = el.offsetWidth;
  const left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
  const below = r.bottom + 6 + el.offsetHeight < window.innerHeight;
  el.style.left = `${left + window.scrollX}px`;
  el.style.top = `${(below ? r.bottom + 6 : r.top - 6 - el.offsetHeight) + window.scrollY}px`;
  button.setAttribute('aria-expanded', 'true');
  openMenu = { el, button };
  const buttons = $$('button', el);
  (buttons.find((b) => b.getAttribute('aria-checked') === 'true') || buttons[0]).focus();

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    closeMenu(true);
    onPick(items[Number(b.dataset.i)].value);
  });
  el.addEventListener('keydown', (e) => {
    const i = buttons.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); buttons[(i + 1) % buttons.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); buttons[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); buttons.at(-1).focus(); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); closeMenu(true); }
  });
}

document.addEventListener('pointerdown', (e) => {
  if (openMenu && !openMenu.el.contains(e.target) && !openMenu.button.contains(e.target)) closeMenu();
});
window.addEventListener('resize', () => closeMenu());

/* ================= Actions sur les produits ================= */

const findProduct = (id) => S.products.find((p) => p.id === id);
const productPayload = (p) => ({
  name: p.name, space_id: p.space_id, quantity: p.quantity, unit: p.unit,
  state: p.state, expires_on: p.expires_on, opened_on: p.opened_on,
});

async function changeQuantity(p, delta) {
  const next = round(p.quantity + delta);
  try {
    if (next <= 0) {
      await api('DELETE', `/api/products/${p.id}`);
      await refresh();
      toast(`${p.name} : terminé, entrée retirée`, {
        action: 'Annuler',
        onAction: () => api('POST', '/api/products', { ...productPayload(p), merge: false }).then(refresh).catch(fail),
      });
    } else {
      p.quantity = next; // mise à jour optimiste
      renderList();
      await api('PATCH', `/api/products/${p.id}`, { quantity: next });
      await refresh();
    }
  } catch (err) {
    fail(err);
    refresh();
  }
}

function pickLevel(button, p) {
  const items = S.remaining_levels.map((l) => ({
    value: l.value, checked: p.remaining === l.value,
    html: `${gaugeHtml(l.value)}<span>${esc(l.label)}</span>`,
  }));
  items.push({ value: null, checked: p.remaining == null, html: `${gaugeHtml(null)}<span>Non indiqué</span>` });
  showMenu(button, items, async (value) => {
    try {
      await api('PATCH', `/api/products/${p.id}`, { remaining: value });
      await refresh();
      $(`[data-id="${p.id}"] [data-act="level"]`)?.focus();
    } catch (err) {
      fail(err);
    }
  }, { label: `Reste dans ${p.name}` });
}

async function deleteProduct(p) {
  const ok = await confirmDialog({
    title: 'Supprimer ce produit ?',
    html: `<p><strong>${esc(p.name)}</strong> — ${esc(qtyLabel(p))}, ${p.state === 'open' ? 'ouvert' : 'fermé'}, ${esc(spaceName(p.space_id))}.</p>
           <p>Cette entrée sera retirée du stock.</p>`,
  });
  if (!ok) return;
  try {
    await api('DELETE', `/api/products/${p.id}`);
    await refresh();
    toast(`${p.name} supprimé`, {
      action: 'Annuler',
      onAction: () => api('POST', '/api/products', { ...productPayload(p), merge: false }).then(refresh).catch(fail),
    });
  } catch (err) {
    fail(err);
  }
}

$('#list').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const p = findProduct(Number(btn.closest('[data-id]').dataset.id));
  if (!p) return;
  const step = unitOf(p.unit).step;
  switch (btn.dataset.act) {
    case 'dec': return changeQuantity(p, -Math.min(step, p.quantity));
    case 'inc': return changeQuantity(p, step);
    case 'qty': return openProductForm(p, '#pf-qty');
    case 'edit': return openProductForm(p);
    case 'open': return openOpenDialog(p);
    case 'delete': return deleteProduct(p);
    case 'level': return pickLevel(btn, p);
  }
});

/* ================= Filtres ================= */

let searchTimer;
$('#f-q').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { UI.q = e.target.value; renderList(); }, 120);
});

$('#sort-btn').addEventListener('click', (e) => {
  showMenu(e.currentTarget, SORTS.map((s) => ({ value: s.id, label: s.label, checked: s.id === UI.sort })), (value) => {
    UI.sort = value;
    store.set('f-sort', value);
    renderList();
  }, { label: 'Trier par' });
});

$('#sidebar-body').addEventListener('click', (e) => {
  const b = e.target.closest('[data-fgroup]');
  if (!b) return;
  const { fgroup, fvalue } = b.dataset;
  UI[fgroup] = UI[fgroup] === fvalue ? '' : fvalue;
  if (fgroup === 'space') store.set('f-space', UI.space);
  renderList();
  $(`#sidebar-body [data-fgroup="${fgroup}"][data-fvalue="${CSS.escape(UI[fgroup])}"]`)?.focus();
});

$('#summary').addEventListener('click', (e) => {
  const card = e.target.closest('[data-filter]');
  if (!card) return;
  UI.expiry = UI.expiry === card.dataset.filter ? '' : card.dataset.filter;
  renderList();
});

// Sidebar en panneau coulissant sur petit écran
function setFiltersOpen(open) {
  document.body.classList.toggle('filters-open', open);
  $('.sidebar-backdrop').hidden = !open;
  $('.filters-btn').setAttribute('aria-expanded', String(open));
  if (open) $('#sidebar .sidebar-close').focus();
  else $('.filters-btn').focus({ preventScroll: true });
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('filters-open')) setFiltersOpen(false);
});

/* ================= Dialogues ================= */

function setupDialog(dialog) {
  dialog.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]') || e.target === dialog) dialog.close('cancel');
  });
}
$$('dialog').forEach(setupDialog);

function confirmDialog({ title, html, ok = 'Supprimer' }) {
  const d = $('#confirm-dialog');
  $('#cd-title').textContent = title;
  $('#cd-body').innerHTML = html;
  $('#cd-ok').textContent = ok;
  d.returnValue = '';
  d.showModal();
  $('#cd-ok').focus();
  return new Promise((resolve) => {
    d.addEventListener('close', () => resolve(d.returnValue === 'ok' ? d : null), { once: true });
  });
}

function stepperSetup(root) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-step]');
    if (!b) return;
    const input = b.parentElement.querySelector('input');
    const step = Number(b.dataset.step) * (Number(input.dataset.step) || 1);
    const max = Number(input.dataset.max) || Infinity;
    const v = parseQty(input.value);
    const next = round((Number.isFinite(v) ? v : 0) + step);
    if (next > 0 && next <= max) input.value = numFmt.format(next).replace(/\s/g, '');
  });
}

/* ----- Formulaire produit ----- */

const pd = $('#product-dialog');
const pf = $('#product-form');
let editing = null;
let unitTouched = false;
let catTouched = false;
stepperSetup(pf);

function setFormError(form, msg) {
  const el = $('.form-error', form);
  el.textContent = msg || '';
  el.hidden = !msg;
}

function syncOpenedField() {
  const open = pf.elements.state.value === 'open';
  $('#pf-opened-field').hidden = !open;
  $('#pf-remaining-field').hidden = !open;
  if (open && !pf.elements.opened_on.value && !editing) pf.elements.opened_on.value = localToday();
}

/** Catégorie proposée à partir du nom (historique d'abord, puis catalogue), tant qu'elle n'a pas été choisie à la main. */
function syncCategory() {
  if (catTouched) return;
  const name = pf.elements.name.value;
  const known = S.history.find((h) => h.category && norm(h.name) === norm(name));
  pf.elements.category.value = known?.category ?? guessCategory(name);
  $('#pf-cat-hint').textContent = name.trim() ? '(déduite du nom, modifiable)' : '';
}

function syncUnitStep() {
  $('#pf-qty').dataset.step = unitOf(pf.elements.unit.value).step;
}

function openProductForm(product = null, focusSel = '#pf-name') {
  if (!S.spaces.length) {
    toast("Créez d'abord un espace de rangement dans les paramètres", { error: true });
    location.hash = '#/parametres';
    return;
  }
  editing = product;
  unitTouched = Boolean(product);
  catTouched = Boolean(product);
  setFormError(pf, '');
  $('#pd-title').textContent = product ? 'Modifier le produit' : 'Ajouter un produit';
  $('#pf-again').hidden = Boolean(product);

  const lastSpace = store.get('last-space', null);
  const defaultSpace =
    product?.space_id ??
    (UI.space ? Number(UI.space) : S.spaces.some((s) => s.id === lastSpace) ? lastSpace : S.spaces[0].id);
  $('#pf-spaces').innerHTML = S.spaces
    .map((s) => `<label><input type="radio" name="space_id" value="${s.id}" ${s.id === defaultSpace ? 'checked' : ''}><span>${esc(s.name)}</span></label>`)
    .join('');
  $('#pf-unit').innerHTML = S.units.map((u) => `<option value="${esc(u.id)}">${esc(u.id)}</option>`).join('');
  $('#pf-cat').innerHTML = CATEGORIES.map((c) => `<option value="${c.id}">${c.icon}  ${esc(c.label)}</option>`).join('');
  $('#pf-remaining').innerHTML = [...S.remaining_levels, { value: '', label: 'Non indiqué' }]
    .map((l) => `<label><input type="radio" name="remaining" value="${l.value}"><span>${l.value === '' ? '' : gaugeHtml(l.value)}${esc(l.label)}</span></label>`)
    .join('');

  pf.elements.name.value = product?.name ?? '';
  pf.elements.quantity.value = numFmt.format(product?.quantity ?? 1).replace(/\s/g, '');
  pf.elements.unit.value = product?.unit ?? 'unité';
  const state = product?.state ?? (UI.view === 'open' ? 'open' : 'closed');
  pf.querySelector(`input[name="state"][value="${state}"]`).checked = true;
  pf.elements.expires_on.value = product?.expires_on ?? '';
  pf.elements.opened_on.value = product?.opened_on ?? '';
  pf.querySelector(`input[name="remaining"][value="${product?.remaining ?? ''}"]`).checked = true;
  if (product) {
    pf.elements.category.value = product.category;
    $('#pf-cat-hint').textContent = '';
  } else {
    syncCategory();
  }
  syncOpenedField();
  syncUnitStep();
  hideSuggest();
  pd.showModal();
  const f = $(focusSel, pd);
  f.focus();
  if (f.select) f.select();
}

pf.addEventListener('change', (e) => {
  if (e.target.name === 'state') syncOpenedField();
  if (e.target.name === 'unit') { unitTouched = true; syncUnitStep(); }
  if (e.target.name === 'category') { catTouched = true; $('#pf-cat-hint').textContent = ''; }
});

pf.addEventListener('submit', async (e) => {
  e.preventDefault();
  const again = e.submitter?.value === 'again';
  const f = pf.elements;
  const quantity = parseQty(f.quantity.value);
  const body = {
    name: f.name.value.trim(),
    space_id: Number(pf.querySelector('input[name="space_id"]:checked')?.value),
    quantity,
    unit: f.unit.value,
    state: f.state.value,
    expires_on: f.expires_on.value || null,
    opened_on: f.state.value === 'open' ? f.opened_on.value || null : null,
    category: f.category.value,
    remaining: f.state.value === 'open' && f.remaining.value ? Number(f.remaining.value) : null,
  };
  if (!body.name) { setFormError(pf, 'Indiquez le nom du produit.'); f.name.focus(); return; }
  if (!(quantity > 0)) { setFormError(pf, 'La quantité doit être supérieure à 0.'); f.quantity.focus(); return; }
  setFormError(pf, '');
  const buttons = $$('button[type="submit"]', pf);
  buttons.forEach((b) => (b.disabled = true));
  try {
    if (editing) {
      await api('PATCH', `/api/products/${editing.id}`, body);
      pd.close();
      toast(`${body.name} mis à jour`);
    } else {
      const res = await api('POST', '/api/products', body);
      store.set('last-space', body.space_id);
      toast(res.merged ? `${body.name} : quantité ajoutée à l'entrée existante` : `${body.name} ajouté`);
      if (again) {
        f.name.value = '';
        f.quantity.value = '1';
        f.expires_on.value = '';
        unitTouched = false;
        catTouched = false;
        syncCategory();
        f.name.focus();
      } else {
        pd.close();
      }
    }
    await refresh();
  } catch (err) {
    setFormError(pf, err.message);
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
});

/* ----- Autocomplétion ----- */

const suggestEl = $('#pf-suggest');
const nameInput = $('#pf-name');
let suggestions = [];
let activeIndex = -1;

function suggestionSource() {
  const seen = new Map();
  for (const h of S.history) {
    seen.set(norm(h.name), { name: h.name, unit: h.unit, category: h.category || guessCategory(h.name), known: true });
  }
  for (const [name, unit, category] of DICTIONARY) {
    if (!seen.has(norm(name))) seen.set(norm(name), { name, unit, category, known: false });
  }
  return [...seen.values()];
}

function hideSuggest() {
  suggestEl.hidden = true;
  nameInput.setAttribute('aria-expanded', 'false');
  nameInput.removeAttribute('aria-activedescendant');
  activeIndex = -1;
}

function showSuggest() {
  const q = norm(nameInput.value);
  if (!q) return hideSuggest();
  const all = suggestionSource();
  const starts = all.filter((s) => norm(s.name).startsWith(q));
  const contains = all.filter((s) => !norm(s.name).startsWith(q) && norm(s.name).includes(q));
  suggestions = [...starts, ...contains].filter((s) => norm(s.name) !== q).slice(0, 8);
  if (!suggestions.length) return hideSuggest();
  activeIndex = -1;
  suggestEl.innerHTML = suggestions
    .map((s, i) => `<li role="option" id="sg-${i}" data-i="${i}" aria-selected="false"><span><span class="sg-icon" aria-hidden="true">${categoryOf(s.category).icon}</span>${esc(s.name)}</span><small>${s.known ? 'déjà utilisé · ' : ''}${esc(s.unit)}</small></li>`)
    .join('');
  suggestEl.hidden = false;
  nameInput.setAttribute('aria-expanded', 'true');
}

function pickSuggestion(i) {
  const s = suggestions[i];
  if (!s) return;
  nameInput.value = s.name;
  if (!unitTouched && S.units.some((u) => u.id === s.unit)) {
    pf.elements.unit.value = s.unit;
    syncUnitStep();
  }
  if (!catTouched) {
    pf.elements.category.value = s.category;
    $('#pf-cat-hint').textContent = '(déduite du nom, modifiable)';
  }
  hideSuggest();
  $('#pf-qty').focus();
  $('#pf-qty').select();
}

function highlight(i) {
  activeIndex = i;
  $$('li', suggestEl).forEach((li, j) => li.setAttribute('aria-selected', String(j === i)));
  const li = $(`#sg-${i}`);
  if (li) { nameInput.setAttribute('aria-activedescendant', li.id); li.scrollIntoView({ block: 'nearest' }); }
}

nameInput.addEventListener('input', () => { showSuggest(); syncCategory(); });
nameInput.addEventListener('blur', () => setTimeout(hideSuggest, 150));
nameInput.addEventListener('keydown', (e) => {
  if (suggestEl.hidden) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); highlight(Math.min(activeIndex + 1, suggestions.length - 1)); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(Math.max(activeIndex - 1, 0)); }
  else if (e.key === 'Enter' && activeIndex >= 0) { e.preventDefault(); pickSuggestion(activeIndex); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hideSuggest(); }
});
suggestEl.addEventListener('mousedown', (e) => e.preventDefault());
suggestEl.addEventListener('click', (e) => {
  const li = e.target.closest('li[data-i]');
  if (li) pickSuggestion(Number(li.dataset.i));
});

/* ----- Ouvrir une partie du stock ----- */

const od = $('#open-dialog');
const of = $('#open-form');
let opening = null;
stepperSetup(of);

function openOpenDialog(p) {
  opening = p;
  setFormError(of, '');
  const unitWord = unitLabel(p.unit, 1);
  $('#od-title').textContent = `Ouvrir : ${p.name}`;
  $('#od-text').textContent =
    `Stock fermé : ${qtyLabel(p)} (${spaceName(p.space_id)}). La quantité ouverte sera retirée du stock fermé et ajoutée aux produits ouverts.`;
  const qty = Math.min(unitOf(p.unit).step, p.quantity);
  const input = of.elements.quantity;
  input.value = numFmt.format(['kg', 'L', 'g', 'cL'].includes(p.unit) ? p.quantity : qty).replace(/\s/g, '');
  input.dataset.step = unitOf(p.unit).step;
  input.dataset.max = p.quantity;
  of.elements.opened_on.value = localToday();
  $('label[for="of-qty"]').textContent = `Quantité à ouvrir (${unitWord})`;
  od.showModal();
  $('button[type="submit"]', of).focus();
}

of.addEventListener('submit', async (e) => {
  e.preventDefault();
  const quantity = parseQty(of.elements.quantity.value);
  if (!(quantity > 0) || quantity > opening.quantity) {
    setFormError(of, `Indiquez une quantité entre 0 et ${numFmt.format(opening.quantity)}.`);
    return;
  }
  try {
    await api('POST', `/api/products/${opening.id}/open`, { quantity, opened_on: of.elements.opened_on.value || null });
    od.close();
    toast(`${opening.name} : ${numFmt.format(quantity)} ${unitLabel(opening.unit, quantity)} ${plural(quantity, 'ouvert', 'ouverts')}`);
    await refresh();
  } catch (err) {
    setFormError(of, err.message);
  }
});

/* ================= Paramètres ================= */

let tzFilled = false;
let notifFilled = false;

function renderSettings() {
  const list = $('#spaces');
  list.innerHTML = S.spaces.length
    ? S.spaces
        .map(
          (s, i) => `<li data-space="${s.id}">
            <span class="space-name">${esc(s.name)}</span>
            <span class="count">${s.product_count} ${plural(s.product_count, 'produit', 'produits')}</span>
            <button type="button" class="icon-btn" data-sact="up" aria-label="Monter ${esc(s.name)}" ${i === 0 ? 'disabled' : ''}>${icon('up')}</button>
            <button type="button" class="icon-btn" data-sact="down" aria-label="Descendre ${esc(s.name)}" ${i === S.spaces.length - 1 ? 'disabled' : ''}>${icon('down')}</button>
            <button type="button" class="icon-btn" data-sact="rename" aria-label="Renommer ${esc(s.name)}" title="Renommer">${icon('edit')}</button>
            <button type="button" class="icon-btn danger" data-sact="delete" aria-label="Supprimer ${esc(s.name)}" title="Supprimer">${icon('trash')}</button>
          </li>`,
        )
        .join('')
    : '<li class="empty-row">Aucun espace. Ajoutez-en un ci-dessous pour commencer.</li>';

  const st = S.settings;
  const nf = $('#notif-form');
  if (!tzFilled) {
    const zones = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : [];
    if (!zones.includes(st.timezone)) zones.unshift(st.timezone);
    nf.elements.timezone.innerHTML = zones.map((z) => `<option value="${esc(z)}">${esc(z.replace(/_/g, ' '))}</option>`).join('');
    tzFilled = true;
  }
  if (!notifFilled) fillNotifForm();

  const ws = $('#webhook-status');
  ws.innerHTML = st.webhook_configured
    ? `<span class="dot ok"></span> Webhook configuré${st.webhook_from_env ? ' (variable d’environnement)' : ''}`
    : '<span class="dot"></span> Aucun webhook configuré';
  nf.elements.webhook_url.placeholder = st.webhook_configured
    ? 'Webhook enregistré — saisissez une nouvelle URL pour le remplacer'
    : 'https://discord.com/api/webhooks/…';
  nf.elements.webhook_url.disabled = st.webhook_from_env;
  $('#webhook-help').textContent = st.webhook_from_env
    ? 'Défini par la variable DISCORD_WEBHOOK_URL : modifiez-la dans la configuration Docker.'
    : 'L’URL est conservée uniquement sur le serveur et n’est jamais réaffichée.';
  $('[data-action="clear-webhook"]').hidden = !st.webhook_configured || st.webhook_from_env;

  $('#digest-status').textContent = st.last_digest_at
    ? `Dernier traitement : ${new Date(st.last_digest_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })} — ${st.last_digest_status}`
    : 'Aucun récapitulatif envoyé pour le moment.';
  $('#demo-item').hidden = S.products.length > 0;
}

/* ----- Administration : import et purge ----- */

const importDialog = $('#import-dialog');
const importForm = $('#import-form');
let importData = null;

$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    if (file.size > 10_000_000) throw new Error('Fichier trop volumineux (10 Mo maximum)');
    const data = JSON.parse(await file.text());
    if (data?.format !== 'bernard-export' || !Array.isArray(data.products)) throw new Error('Ce fichier n’est pas un export de Bernard');
    importData = data;
    const when = data.exported_at ? ` du ${new Date(data.exported_at).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })}` : '';
    const nSpaces = Array.isArray(data.spaces) ? data.spaces.length : 0;
    $('#import-summary').innerHTML = `Fichier <strong>${esc(file.name)}</strong>${esc(when)} : <strong>${data.products.length}</strong>
      ${plural(data.products.length, 'produit', 'produits')} et ${nSpaces} ${plural(nSpaces, 'espace', 'espaces')}.`;
    setFormError(importForm, '');
    importForm.querySelector('input[value="merge"]').checked = true;
    importDialog.showModal();
  } catch (err) {
    fail(err instanceof SyntaxError ? new Error('Fichier JSON illisible') : err);
  }
});

importForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const mode = importForm.elements.mode.value;
  const btn = $('button[type="submit"]', importForm);
  btn.disabled = true;
  try {
    const res = await api('POST', '/api/import', { mode, data: importData });
    importDialog.close();
    toast(`Import terminé : ${res.products} ${plural(res.products, 'produit', 'produits')}${res.spaces_created ? `, ${res.spaces_created} ${plural(res.spaces_created, 'espace créé', 'espaces créés')}` : ''}`);
    notifFilled = false;
    await refresh();
  } catch (err) {
    setFormError(importForm, err.message);
  } finally {
    btn.disabled = false;
  }
});

const purgeDialog = $('#purge-dialog');
const purgeForm = $('#purge-form');

function openPurge() {
  const n = S.products.length;
  $('#pg-products').textContent = `Supprime les ${n} ${plural(n, 'entrée', 'entrées')} du stock. Les espaces, les réglages et les suggestions de saisie sont conservés.`;
  purgeForm.reset();
  setFormError(purgeForm, '');
  $('button[type="submit"]', purgeForm).disabled = true;
  purgeDialog.showModal();
  purgeForm.elements.confirm.focus();
}

purgeForm.elements.confirm.addEventListener('input', (e) => {
  $('button[type="submit"]', purgeForm).disabled = e.target.value.trim().toUpperCase() !== 'PURGER';
});

purgeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const scope = purgeForm.elements.scope.value;
  try {
    const res = await api('POST', '/api/purge', { scope, confirm: purgeForm.elements.confirm.value.trim().toUpperCase() });
    purgeDialog.close();
    toast(scope === 'all' ? 'Application réinitialisée' : `Stock vidé (${res.deleted} ${plural(res.deleted, 'entrée supprimée', 'entrées supprimées')})`);
    Object.assign(UI, { q: '', space: '', category: '', expiry: '' });
    store.set('f-space', '');
    notifFilled = false;
    await refresh();
  } catch (err) {
    setFormError(purgeForm, err.message);
  }
});

function fillNotifForm() {
  const st = S.settings;
  const f = $('#notif-form').elements;
  for (const k of ['alert_expiring', 'alert_expired', 'alert_open', 'skip_unchanged']) f[k].checked = Boolean(st[k]);
  f.expiry_days.value = st.expiry_days;
  f.open_days.value = st.open_days;
  f.frequency.value = st.frequency;
  f.weekday.value = String(st.weekday);
  f.time.value = st.time;
  f.timezone.value = st.timezone;
  $('#weekday-field').hidden = st.frequency !== 'weekly';
  notifFilled = true;
}

$('#notif-form').addEventListener('change', (e) => {
  if (e.target.name === 'frequency') $('#weekday-field').hidden = e.target.value !== 'weekly';
});

$('#notif-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const body = {
    alert_expiring: f.alert_expiring.checked,
    alert_expired: f.alert_expired.checked,
    alert_open: f.alert_open.checked,
    skip_unchanged: f.skip_unchanged.checked,
    expiry_days: Number(f.expiry_days.value),
    open_days: Number(f.open_days.value),
    frequency: f.frequency.value,
    weekday: Number(f.weekday.value),
    time: f.time.value,
    timezone: f.timezone.value,
  };
  if (f.webhook_url.value.trim()) body.webhook_url = f.webhook_url.value.trim();
  try {
    const res = await api('PUT', '/api/settings', body);
    S.settings = res.settings;
    f.webhook_url.value = '';
    toast('Paramètres enregistrés');
    render();
  } catch (err) {
    fail(err);
  }
});

$('#space-add').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = e.target.elements.name;
  try {
    await api('POST', '/api/spaces', { name: input.value });
    toast(`Espace « ${input.value.trim()} » ajouté`);
    input.value = '';
    await refresh();
  } catch (err) {
    fail(err);
  }
});

$('#spaces').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-sact]');
  if (!btn) return;
  const li = btn.closest('[data-space]');
  const space = S.spaces.find((s) => s.id === Number(li.dataset.space));
  try {
    switch (btn.dataset.sact) {
      case 'up':
      case 'down':
        await api('PATCH', `/api/spaces/${space.id}`, { move: btn.dataset.sact });
        await refresh();
        $(`[data-space="${space.id}"] [data-sact="${btn.dataset.sact}"]`)?.focus();
        break;
      case 'rename':
        startRename(li, space);
        break;
      case 'delete':
        await deleteSpace(space);
        break;
    }
  } catch (err) {
    fail(err);
  }
});

function startRename(li, space) {
  li.innerHTML = `<form class="inline-form grow">
      <label class="grow"><span class="sr-only">Nouveau nom</span><input type="text" maxlength="40" required value="${esc(space.name)}"></label>
      <button type="submit" class="btn btn-primary btn-sm">OK</button>
      <button type="button" class="btn btn-ghost btn-sm" data-cancel>Annuler</button>
    </form>`;
  const form = $('form', li);
  const input = $('input', li);
  input.focus();
  input.select();
  $('[data-cancel]', li).addEventListener('click', () => renderSettings());
  input.addEventListener('keydown', (e) => e.key === 'Escape' && renderSettings());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('PATCH', `/api/spaces/${space.id}`, { name: input.value });
      toast('Espace renommé');
      await refresh();
    } catch (err) {
      fail(err);
    }
  });
}

async function deleteSpace(space) {
  const others = S.spaces.filter((s) => s.id !== space.id);
  const n = space.product_count;
  let html = `<p>Supprimer l’espace <strong>${esc(space.name)}</strong> ?</p>`;
  if (n > 0) {
    html += `<p>Il contient <strong>${n} ${plural(n, 'produit', 'produits')}</strong>. Que voulez-vous en faire ?</p>
      ${others.length ? `<label class="check"><input type="radio" name="sd-action" value="move" checked>
        <span>Les déplacer vers <select id="sd-target" aria-label="Espace de destination">${others.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></span></label>` : ''}
      <label class="check"><input type="radio" name="sd-action" value="delete" ${others.length ? '' : 'checked'}>
        <span>Les supprimer définitivement</span></label>`;
  }
  const d = await confirmDialog({ title: 'Supprimer un espace', html });
  if (!d) return;
  let qs = '';
  if (n > 0) {
    const action = $('input[name="sd-action"]:checked', d).value;
    qs = action === 'move' ? `?products=move&target=${$('#sd-target', d).value}` : '?products=delete';
  }
  await api('DELETE', `/api/spaces/${space.id}${qs}`);
  toast(`Espace « ${space.name} » supprimé`);
  await refresh();
}

/* ================= Actions globales ================= */

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  if (action === 'add') return openProductForm();
  if (action === 'print') return window.print();
  if (action === 'reset-filters') {
    Object.assign(UI, { q: '', space: '', category: '', expiry: '' });
    store.set('f-space', '');
    return renderList();
  }
  if (action === 'open-filters') return setFiltersOpen(true);
  if (action === 'close-filters') return setFiltersOpen(false);
  if (action === 'purge') return openPurge();
  el.disabled = true;
  try {
    if (action === 'demo') {
      const res = await api('POST', '/api/demo', {});
      toast(`${res.inserted} produits d’exemple ajoutés`);
      await refresh();
      if (UI.view === 'settings') location.hash = '#/';
    } else if (action === 'test-webhook') {
      const url = $('#notif-form').elements.webhook_url.value.trim();
      await api('POST', '/api/notifications/test', url ? { webhook_url: url } : {});
      toast('Message de test envoyé : vérifiez votre salon Discord');
    } else if (action === 'send-now') {
      const res = await api('POST', '/api/notifications/send', {});
      toast(res.sent ? `Récapitulatif envoyé (${res.count} ${plural(res.count, 'alerte', 'alertes')})` : res.reason);
      await refresh();
    } else if (action === 'clear-webhook') {
      const ok = await confirmDialog({
        title: 'Retirer le webhook ?',
        html: '<p>Les alertes Discord ne seront plus envoyées tant qu’un nouveau webhook n’aura pas été renseigné.</p>',
        ok: 'Retirer',
      });
      if (ok) {
        const res = await api('PUT', '/api/settings', { clear_webhook: true });
        S.settings = res.settings;
        toast('Webhook retiré');
        render();
      }
    }
  } catch (err) {
    fail(err);
  } finally {
    el.disabled = false;
  }
});

// Raccourci clavier : « n » pour ajouter un produit
document.addEventListener('keydown', (e) => {
  if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey && !document.querySelector('dialog[open]') &&
      !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
    e.preventDefault();
    openProductForm();
  }
});

// Rafraîchit les données quand l'onglet redevient visible (autre membre du foyer, changement de jour…)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !document.querySelector('dialog[open]')) refresh().catch(() => {});
});

window.addEventListener('hashchange', onRoute);
UI.view = VIEWS[location.hash] || 'all';
refresh().catch((err) => {
  $('#loading').textContent = `Impossible de charger les données : ${err.message}`;
});
