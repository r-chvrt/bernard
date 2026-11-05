# Codes d’erreur et traduction de l’interface

L’API utilisée par l’interface renvoie toujours `error`, message français historique. Les erreurs incluent un `code` stable, et éventuellement `params` pour l’interpolation. Exemple :

```json
{"error":"Le nom ne doit pas dépasser 40 caractères","code":"name_too_long","params":{"max":40}}
```

Le client (`public/i18n.js`, fonction `errorMessage`) traduit `code` avec `params` ; si le code est absent ou inconnu, il affiche `error`. Ne pas déduire le code du texte français. La forme et le statut HTTP restent compatibles avec les clients existants : `code` et `params` sont des champs ajoutés.

**API externe v1** : les réponses d’erreur des routes `/api/v1/*` restent `{ "error": "…" }` sans `code` ni `params` (contrat `docs/api-v1.md` inchangé).

## Codes

| Code | Signification | Paramètres |
|---|---|---|
| `name_required` | Nom vide | — |
| `name_too_long` | Nom trop long | `max` (40 pour un espace, 80 pour un produit) |
| `quantity_positive` | Quantité non numérique, non finie ou non positive | — |
| `quantity_too_large` | Quantité supérieure à 100 000 | — |
| `expiry_date_invalid` | Date de péremption invalide | — |
| `opened_date_invalid` | Date d’ouverture invalide | — |
| `remaining_invalid` | Pourcentage restant invalide | — |
| `space_unknown` | Espace inconnu (produit) | — |
| `unit_unknown` | Unité inconnue | — |
| `state_invalid` | État autre que ouvert ou fermé | — |
| `auth_required` | Connexion requise (401, avec `auth_required: true`) | — |
| `too_many_attempts` | Trop d’essais de mot de passe (429) | `seconds` |
| `password_incorrect` | Mot de passe de connexion incorrect (401) | — |
| `current_password_incorrect` | Mot de passe actuel incorrect | — |
| `password_too_short` | Nouveau mot de passe trop court | `min` (6) |
| `password_too_long` | Nouveau mot de passe trop long | `max` (200) |
| `space_exists` | Espace déjà existant | — |
| `space_not_found` | Espace introuvable (404) | — |
| `space_target_invalid` | Espace de destination invalide | — |
| `space_not_empty` | Espace non vide sans consigne (409) | `count` |
| `product_not_found` | Produit introuvable (404) | — |
| `product_already_open` | Produit déjà ouvert | — |
| `open_quantity_exceeds` | Quantité à ouvrir supérieure au stock | `available`, `unit` (identifiant) |
| `demo_stock_not_empty` | Exemples refusés : stock non vide | — |
| `import_mode_invalid` | Mode d’import inconnu | — |
| `import_not_export` | Fichier qui n’est pas un export Bernard | — |
| `import_too_large` | Trop de produits dans l’export | `max` (20 000) |
| `import_product_invalid` | Produit invalide dans l’export | `index`, `name`, `reason` (texte), `reason_code` et `reason_params` (cause) |
| `entry_invalid` | Entrée d’export qui n’est pas un objet (cause d’`import_product_invalid`) | — |
| `purge_confirm_required` | Confirmation « PURGER » absente | — |
| `purge_scope_invalid` | Type de purge inconnu | — |
| `setting_out_of_range` | Réglage numérique hors bornes | `key`, `min`, `max` |
| `frequency_invalid` | Fréquence inconnue | — |
| `time_invalid` | Heure invalide | — |
| `timezone_unknown` | Fuseau horaire inconnu | — |
| `webhook_url_invalid` | URL qui n’est pas un webhook Discord | — |
| `webhook_missing` | Aucun webhook pour le test | — |
| `webhook_timeout` | Discord ne répond pas (502) | — |
| `webhook_unreachable` | Discord injoignable (502) | — |
| `webhook_not_found` | Webhook révoqué ou introuvable (502) | — |
| `webhook_rejected` | Discord refuse le message (502) | `status` |
| `not_found` | Ressource introuvable (404) | — |
| `route_unknown` | Route d’API inconnue (404) | — |
| `request_too_large` | Corps trop volumineux (413) | — |
| `json_invalid` | Corps JSON illisible | — |
| `request_target_invalid` | Adresse de requête invalide | — |
| `method_not_allowed` | Méthode refusée pour un fichier statique (405) | — |
| `json_content_type_required` | Écriture sans `Content-Type: application/json` (415) | — |
| `internal_error` | Erreur interne (500) | — |

## Récapitulatif Discord

`POST /api/notifications/send` renvoie, quand rien n’est envoyé, `reason` (texte français) et `reason_code` : `no_webhook`, `nothing_to_report` ou `unchanged`. Le dernier traitement est mémorisé dans les réglages : `last_digest_status` (texte français, historique) et `last_digest_code` + `last_digest_params` : `nothing_to_report`, `unchanged`, `sent` (`count`) ou `failed` (`reason`, `reason_code`, `reason_params`). L’interface affiche le code traduit, sinon le texte.

## Interface FR/EN

- Dictionnaires : `public/i18n/fr.js` (référence) et `public/i18n/en.js`, mêmes clés, mêmes paramètres `{nom}` ; pluriels `{ one, other }` choisis selon `count` (français : 0 et 1 au singulier). `test/i18n.test.js` vérifie la parité, la présence des clés utilisées par les pages et scripts, la cohérence du texte français écrit dans le HTML et la traduction de chaque code d’erreur du serveur.
- Pages : attributs `data-i18n` (texte), `data-i18n-html` (texte avec balises, messages internes uniquement), `data-i18n-aria`, `data-i18n-title`, `data-i18n-ph`. Le texte français reste écrit dans le HTML.
- Langue : choix de l’appareil (`localStorage` `bernard-lang` : `fr`, `en`, absent = automatique), sinon première langue du navigateur reconnue (`navigator.languages`), sinon français. Sélecteur dans la barre du haut, dans Paramètres → Langue et sur la page de connexion. `theme.js` masque la page tant qu’elle n’est pas traduite (1,5 s au plus) pour éviter un flash de français.
- Restent en français (données ou serveur) : noms de produits, d’espaces et suggestions d’autocomplétion (`catalog.js`, données d’exemple, espaces par défaut Placard/Frigo/Congélateur), messages Discord (`server/alerts.js`), texte `error` des réponses, page d’erreur 404 statique. L’API externe `/api/v1/stock` (libellés de catégories et d’unités en français) ne change pas.
