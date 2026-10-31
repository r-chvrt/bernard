import { createHash } from 'node:crypto';
import { getSettings, setSettings, listProducts, listSpaces, webhookUrl } from './db.js';
import { daysBetween, formatDateFr, localParts, isValidTimeZone } from './dates.js';
import { unitLabel } from './units.js';

const DISCORD_WEBHOOK_RE =
  /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/\d+\/[\w-]+$/;

export function isDiscordWebhook(url) {
  return typeof url === 'string' && DISCORD_WEBHOOK_RE.test(url.trim());
}

/**
 * Produits concernés par chaque type d'alerte activé.
 * Un produit sans date de péremption (ou sans date d'ouverture) n'est jamais concerné
 * par l'alerte correspondante.
 */
export function computeAlerts(products, settings, today) {
  const expired = [];
  const expiring = [];
  const openLong = [];
  for (const p of products) {
    if (!(p.quantity > 0)) continue;
    if (p.expires_on) {
      const d = daysBetween(today, p.expires_on);
      if (d < 0) expired.push({ product: p, days: -d });
      else if (d <= settings.expiry_days) expiring.push({ product: p, days: d });
    }
    if (p.state === 'open' && p.opened_on) {
      const d = daysBetween(p.opened_on, today);
      if (d >= settings.open_days) openLong.push({ product: p, days: d });
    }
  }
  expired.sort((a, b) => b.days - a.days);
  expiring.sort((a, b) => a.days - b.days);
  openLong.sort((a, b) => b.days - a.days);
  return {
    expired: settings.alert_expired ? expired : [],
    expiring: settings.alert_expiring ? expiring : [],
    openLong: settings.alert_open ? openLong : [],
  };
}

export function alertCount(alerts) {
  return alerts.expired.length + alerts.expiring.length + alerts.openLong.length;
}

/** Empreinte stable de l'ensemble des alertes (pour ne pas renvoyer un message identique). */
export function alertSignature(alerts) {
  const keys = [
    ...alerts.expired.map((a) => `x${a.product.id}`),
    ...alerts.expiring.map((a) => `s${a.product.id}`),
    ...alerts.openLong.map((a) => `o${a.product.id}`),
  ].sort();
  return createHash('sha256').update(keys.join(',')).digest('hex').slice(0, 16);
}

const escapeMd = (s) => String(s).replace(/([\\*_~`|[\]])/g, '\\$1');
const fmtQty = (q) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(q);
const plural = (n, one, many) => (n > 1 ? many : one);

function line(product, spaceName, detail) {
  const qty = `${fmtQty(product.quantity)} ${unitLabel(product.unit, product.quantity)}`;
  const state = product.state === 'open' ? 'ouvert' : 'fermé';
  return `• **${escapeMd(product.name)}** — ${qty}, ${state} · ${escapeMd(spaceName)} · ${detail}`;
}

function describe(items, render) {
  const lines = [];
  let length = 0;
  for (let i = 0; i < items.length; i++) {
    const l = render(items[i]);
    if (length + l.length > 3800) {
      lines.push(`… et ${items.length - i} ${plural(items.length - i, 'autre', 'autres')}`);
      break;
    }
    lines.push(l);
    length += l.length + 1;
  }
  return lines.join('\n');
}

/** Message Discord regroupant tous les produits concernés, ou null s'il n'y a rien à signaler. */
export function buildDigest(alerts, spaces, today) {
  if (alertCount(alerts) === 0) return null;
  const spaceName = (id) => spaces.find((s) => s.id === id)?.name ?? '?';
  const embeds = [];
  if (alerts.expired.length) {
    embeds.push({
      title: `⛔ Périmés (${alerts.expired.length})`,
      color: 0xc5221f,
      description: describe(alerts.expired, ({ product: p, days }) =>
        line(p, spaceName(p.space_id), `périmé depuis ${days} ${plural(days, 'jour', 'jours')} (${formatDateFr(p.expires_on)})`),
      ),
    });
  }
  if (alerts.expiring.length) {
    embeds.push({
      title: `⏳ Bientôt périmés (${alerts.expiring.length})`,
      color: 0xe37400,
      description: describe(alerts.expiring, ({ product: p, days }) => {
        const when = days === 0 ? "périme aujourd'hui" : days === 1 ? 'périme demain' : `périme dans ${days} jours`;
        return line(p, spaceName(p.space_id), `${when} (${formatDateFr(p.expires_on)})`);
      }),
    });
  }
  if (alerts.openLong.length) {
    embeds.push({
      title: `📂 Ouverts depuis longtemps (${alerts.openLong.length})`,
      color: 0x1a73e8,
      description: describe(alerts.openLong, ({ product: p, days }) =>
        line(p, spaceName(p.space_id), `ouvert depuis ${days} ${plural(days, 'jour', 'jours')} (${formatDateFr(p.opened_on)})`),
      ),
    });
  }
  return {
    username: 'Bernard',
    content: `**Point sur le stock du ${formatDateFr(today)}**`,
    embeds,
    allowed_mentions: { parse: [] },
  };
}

export class WebhookError extends Error {}

/** Envoie un message au webhook. Les erreurs ne contiennent jamais l'URL. */
export async function sendWebhook(url, payload, { fetchImpl = fetch, retry = true } = {}) {
  let res;
  try {
    res = await fetchImpl(`${url.trim()}?wait=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    throw new WebhookError(err?.name === 'TimeoutError' ? 'Discord ne répond pas (délai dépassé)' : 'Impossible de joindre Discord');
  }
  if (res.status === 429 && retry) {
    const body = await res.json().catch(() => ({}));
    const wait = Math.min(Number(body.retry_after) || 2, 30);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return sendWebhook(url, payload, { fetchImpl, retry: false });
  }
  if (res.status === 401 || res.status === 404) throw new WebhookError('Webhook introuvable ou révoqué (vérifiez l’URL)');
  if (!res.ok) throw new WebhookError(`Discord a refusé le message (HTTP ${res.status})`);
}

/** Calcule les alertes du jour à partir de la base. */
export function currentAlerts(db, at = new Date()) {
  const settings = getSettings(db);
  const tz = isValidTimeZone(settings.timezone) ? settings.timezone : 'UTC';
  const today = localParts(tz, at).date;
  const alerts = computeAlerts(listProducts(db), settings, today);
  return { settings, today, alerts, spaces: listSpaces(db) };
}

/**
 * Envoi du récapitulatif. `force` ignore la règle « ne pas renvoyer un message identique ».
 * Renvoie { sent, count, reason }.
 */
export async function runDigest(db, { at = new Date(), force = false, fetchImpl } = {}) {
  const { settings, today, alerts, spaces } = currentAlerts(db, at);
  const url = webhookUrl(settings);
  if (!url) return { sent: false, count: 0, reason: 'Aucun webhook configuré' };
  const count = alertCount(alerts);
  const signature = alertSignature(alerts);
  const status = (message) =>
    setSettings(db, { last_digest_at: at.toISOString(), last_digest_status: message });

  if (count === 0) {
    status('Rien à signaler');
    return { sent: false, count, reason: 'Aucun produit à signaler' };
  }
  if (!force && settings.skip_unchanged && settings.last_digest_signature === signature) {
    status('Message identique au précédent : non renvoyé');
    return { sent: false, count, reason: 'Message identique au précédent' };
  }
  await sendWebhook(url, buildDigest(alerts, spaces, today), { fetchImpl });
  setSettings(db, { last_digest_signature: signature });
  status(`${count} ${plural(count, 'alerte envoyée', 'alertes envoyées')}`);
  return { sent: true, count };
}

/**
 * Planificateur : vérifie chaque minute si un récapitulatif est dû
 * (au plus un par jour, ou par semaine en mode hebdomadaire).
 */
export function createScheduler(db, { log = console, intervalMs = 60000, fetchImpl } = {}) {
  let timer = null;
  let running = false;
  let retryAfter = 0;

  async function tick(at = new Date()) {
    if (running || Date.now() < retryAfter) return;
    const settings = getSettings(db);
    if (!webhookUrl(settings)) return;
    if (!settings.alert_expired && !settings.alert_expiring && !settings.alert_open) return;
    const tz = isValidTimeZone(settings.timezone) ? settings.timezone : 'UTC';
    const local = localParts(tz, at);
    if (settings.frequency === 'weekly' && local.weekday !== Number(settings.weekday)) return;
    if (local.time < settings.time) return;
    if (settings.last_digest_period === local.date) return;

    running = true;
    try {
      const result = await runDigest(db, { at, fetchImpl });
      setSettings(db, { last_digest_period: local.date });
      log.info?.(`[alertes] ${result.sent ? `récapitulatif envoyé (${result.count})` : result.reason}`);
    } catch (err) {
      // Nouvel essai dans 15 minutes (le message d'erreur ne contient pas l'URL).
      retryAfter = Date.now() + 15 * 60000;
      setSettings(db, { last_digest_at: at.toISOString(), last_digest_status: `Échec : ${err.message}` });
      log.warn?.(`[alertes] échec de l'envoi : ${err.message}`);
    } finally {
      running = false;
    }
  }

  return {
    tick,
    start() {
      timer = setInterval(() => tick().catch(() => {}), intervalMs);
      timer.unref?.();
      setTimeout(() => tick().catch(() => {}), 5000).unref?.();
    },
    stop() {
      clearInterval(timer);
    },
  };
}
