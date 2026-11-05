// Traduction de l'interface (français / anglais), partagée par le navigateur et les tests Node.
// Langue : choix enregistré sur l'appareil, sinon langue du navigateur, sinon français.
// Les messages sont des chaînes avec des paramètres `{nom}`, ou { one, other } selon le paramètre `count`.
import { fr } from './i18n/fr.js';
import { en } from './i18n/en.js';

export const MESSAGES = { fr, en };
export const LANGS = ['fr', 'en'];
export const DEFAULT_LANG = 'fr';
export const LANG_NAMES = { fr: 'Français', en: 'English' };
export const STORAGE_KEY = 'bernard-lang';

/** Langue à utiliser : choix enregistré valide, sinon première langue du navigateur reconnue, sinon français. */
export function detectLang(stored, languages = []) {
  if (LANGS.includes(stored)) return stored;
  for (const tag of languages || []) {
    const base = String(tag).toLowerCase().split(/[-_]/)[0];
    if (LANGS.includes(base)) return base;
  }
  return DEFAULT_LANG;
}

let lang = DEFAULT_LANG;
const listeners = new Set();

export const getLang = () => lang;
/** Locale Intl : français de France, anglais britannique (jour avant mois, comme en français). */
export const locale = (l = lang) => (l === 'en' ? 'en-GB' : 'fr-FR');

/** Catégorie de pluriel. Français : 0 et 1 au singulier. Anglais : seul 1 est au singulier. */
export function pluralCategory(n, l = lang) {
  if (l === 'fr') return Math.abs(n) > 1 ? 'other' : 'one';
  return n === 1 ? 'one' : 'other';
}

function lookup(key, l) {
  const v = MESSAGES[l]?.[key];
  return v === undefined ? MESSAGES[DEFAULT_LANG][key] : v;
}

export function hasKey(key, l = lang) {
  return MESSAGES[l]?.[key] !== undefined;
}

/** Traduit `key` dans la langue courante (ou `l`). Clé inconnue : la clé elle-même (repérable à l'écran). */
export function t(key, params = {}, l = lang) {
  let msg = lookup(key, l);
  if (msg === undefined) return key;
  if (typeof msg === 'object') msg = msg[pluralCategory(Number(params.count ?? 0), l)] ?? msg.other;
  return msg.replace(/\{(\w+)\}/g, (m, name) => (params[name] === undefined ? m : String(params[name])));
}

/** Nombre formaté selon la langue (2 décimales au plus). */
export function formatNumber(n, l = lang) {
  return new Intl.NumberFormat(locale(l), { maximumFractionDigits: 2 }).format(n);
}

/** Libellé d'une unité (« 2 boîtes » / « 2 cans ») ; unité inconnue : son identifiant. */
export function unitName(id, quantity = 1, l = lang) {
  return hasKey(`unit.${id}`, l) ? t(`unit.${id}`, { count: quantity }, l) : id;
}

/**
 * Message d'erreur affichable à partir d'une réponse de l'API { error, code, params }.
 * Code connu : message traduit avec ses paramètres ; sinon le texte `error` du serveur (français) ;
 * à défaut le message générique. Les causes imbriquées (reason_code) sont traduites de la même façon.
 */
export function errorMessage(data = {}, l = lang) {
  const { error, code, params = {} } = data || {};
  if (!code || !hasKey(`error.${code}`, l)) return error || t('error.generic', {}, l);
  const p = { ...params };
  if (p.reason_code !== undefined || p.reason !== undefined) {
    p.reason = errorMessage({ error: p.reason, code: p.reason_code, params: p.reason_params }, l);
  }
  if (typeof p.available === 'number') {
    p.unit = unitName(p.unit, p.available, l);
    p.available = formatNumber(p.available, l);
  }
  if (p.key !== undefined && hasKey(`setting.${p.key}`, l)) p.key = t(`setting.${p.key}`, {}, l);
  return t(`error.${code}`, p, l);
}

/**
 * Applique les traductions aux éléments marqués :
 * data-i18n (texte), data-i18n-html (texte avec balises, messages internes uniquement),
 * data-i18n-aria, data-i18n-title, data-i18n-ph (aria-label, title, placeholder).
 */
export function applyTranslations(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  for (const [attr, data] of [['aria-label', 'i18nAria'], ['title', 'i18nTitle'], ['placeholder', 'i18nPh']]) {
    const sel = `[data-${data.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}]`;
    for (const el of root.querySelectorAll(sel)) el.setAttribute(attr, t(el.dataset[data]));
  }
}

/** Choix enregistré sur l'appareil ('fr', 'en' ou null = automatique). */
export function storedLang() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return LANGS.includes(v) ? v : null;
  } catch {
    return null;
  }
}

function browserLanguages() {
  if (typeof navigator === 'undefined') return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language].filter(Boolean);
}

/** Définit la langue (null = celle du navigateur), l'enregistre, traduit la page et prévient les abonnés. */
export function setLang(choice) {
  try {
    if (LANGS.includes(choice)) localStorage.setItem(STORAGE_KEY, choice);
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* stockage indisponible : choix limité à cette page */ }
  useLang(detectLang(LANGS.includes(choice) ? choice : null, browserLanguages()));
}

function useLang(next) {
  lang = next;
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang;
  applyTranslations(document);
  document.documentElement.classList.remove('i18n-pending');
  for (const fn of listeners) fn(lang);
}

export const onLangChange = (fn) => listeners.add(fn);

/** Initialisation dans le navigateur : à appeler une fois, avant le premier rendu. */
export function initI18n() {
  useLang(detectLang(storedLang(), browserLanguages()));
  return lang;
}
