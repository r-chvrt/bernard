# Feuille de route

Document de réflexion : rien de ce qui suit n’est encore implémenté. Les priorités sont indicatives et
à revoir selon l’usage réel. Principe directeur inchangé : **rester plus simple à alimenter que Grocy**,
léger à héberger, sans fonctions « gadget ».

## Vue d’ensemble

| Horizon | Thème | Contenu principal |
|---|---|---|
| 0.5 | Maintenance & distribution | Image publiée sur GHCR (amd64 + arm64), tests navigateur en CI, découpage du code client |
| 0.6 | Internationalisation (i18n) | Socle de traduction, unités neutres, anglais comme 2ᵉ langue |
| 0.7 | Quotidien | Durée de conservation après ouverture par catégorie, liste de courses, historique |
| 0.8 | Notifications & intégrations | ntfy / Gotify / e-mail, jeton d’API pour Home Assistant |
| 1.0 | Stabilisation | Format d’export versionné et documenté, garanties de migration, accessibilité vérifiée |

---

## 0.5 — Maintenance et distribution

- **Image publiée** sur GitHub Container Registry à chaque tag (`v0.5.0`, `latest`), multi-architecture
  (amd64 + **arm64** pour Raspberry Pi / NAS). Permet `image: ghcr.io/…/bernard:0.5` au lieu de construire localement,
  et des mises à jour par Dependabot/Renovate côté installation.
- **Versions et releases** : tags SemVer, notes de version générées depuis `CHANGELOG.md`.
- **Tests de bout en bout** (Playwright) en CI : ajout, ouverture, filtres, impression (PDF), connexion.
  Les scénarios existent déjà sous forme de scripts manuels ; il s’agit de les intégrer au dépôt.
- **Qualité** : ESLint + Prettier (en dépendances de développement uniquement), vérification de types par JSDoc
  (`// @ts-check`) sans passer à TypeScript ni ajouter d’étape de build.
- **Découpage de `public/app.js`** (~1 400 lignes) en modules ES natifs : `api`, `state`, `list`, `sidebar`, `form`,
  `settings`, `menus`. Aucun bundler nécessaire.
- **Sauvegardes automatiques** facultatives : copie quotidienne de la base dans `/data/backups` avec rotation
  (ex. 7 jours + 4 semaines), réutilisant `server/backup.js`.
- **Analyse de sécurité** : CodeQL (gratuit sur dépôt public) ou `npm audit` si des dépendances apparaissent.
- **Surveillance de `node:sqlite`** : encore marqué expérimental dans Node 24 ; prévoir le passage à la prochaine LTS
  (Node 26) quand il sera stable, avec mise à jour de la CI et de l’image (exclue des mises à jour majeures automatiques).

## 0.6 — Internationalisation (i18n)

### État des lieux
Tout le texte est aujourd’hui écrit en dur en français : environ 140 lignes dans `public/app.js`, 75 dans
`index.html`, 60 messages d’erreur dans `server/app.js`, le message Discord (`server/alerts.js`), les catégories,
le dictionnaire de ~200 produits et les mots-clés de déduction de catégorie (`public/catalog.js`).
Quelques points sont **structurels** et doivent être traités avant toute traduction :

1. **Unités stockées sous forme de mots français** (`unité`, `boîte`, `bouteille`…) : à remplacer par des
   identifiants neutres (`unit`, `box`, `bottle`…) via une migration, les libellés venant des traductions.
   Même principe déjà en place pour les catégories (`feculents`, `laitier`…) qu’il faudra éventuellement renommer en anglais neutre.
2. **Pluriels** : le code utilise une règle française (`n > 1`). Passer par `Intl.PluralRules`
   (en anglais, 0 est pluriel ; d’autres langues ont plus de deux formes).
3. **Dates et nombres** : remplacer le formatage manuel `JJ/MM/AAAA` par `Intl.DateTimeFormat` / `Intl.NumberFormat`
   avec la langue active (déjà en partie fait pour les nombres).
4. **Messages d’erreur du serveur** : renvoyer un **code** stable (`name_required`, `password_too_short`…) avec
   des paramètres, et laisser le client traduire. Le texte français resterait en secours.
5. **Données saisies** : les noms de produits restent tels que saisis (pas de traduction), ce qui est voulu.

### Architecture proposée
- Fichiers de messages **JSON par langue** (`public/locales/fr.json`, `en.json`), clés hiérarchiques
  (`list.empty.title`, `form.quantity`…), interpolation simple `{count}` et pluriels via `Intl.PluralRules`.
  Un petit helper `t(clé, paramètres)` (~40 lignes) suffit : pas de bibliothèque nécessaire.
- **HTML statique** : attributs `data-i18n="clé"` (et `data-i18n-attr="placeholder:clé"`) appliqués au chargement.
- **Choix de la langue** : par appareil (comme le thème), par défaut la langue du navigateur (`navigator.languages`),
  repli sur le français. Attribut `lang` du document mis à jour.
- **Côté serveur** : seul le **message Discord** a besoin d’une langue → réglage « Langue des notifications »
  dans les paramètres, mêmes fichiers de messages.
- **Catalogue par langue** : dictionnaire d’autocomplétion et mots-clés de déduction de catégorie propres à chaque
  langue (`catalog.fr.js`, `catalog.en.js`), même liste de catégories. La déduction essaierait d’abord la langue
  active, puis les autres (un foyer bilingue saisit dans les deux langues).
- **Contrôle en CI** : test vérifiant que toutes les langues ont les mêmes clés que `fr.json` (langue de référence)
  et qu’aucune chaîne française ne reste en dur dans le code (liste blanche pour les exceptions).
- **Contributions** : ajouter une langue = un JSON + un catalogue ; documenté dans le README. Possibilité de brancher
  plus tard une plateforme de traduction collaborative (Weblate, auto-hébergeable) sur ces fichiers JSON.

### Découpage suggéré
1. Unités neutres + migration ; codes d’erreur serveur (aucun changement visible).
2. Helper `t()`, extraction des chaînes en `fr.json` (l’interface ne change pas : vérifiable par les tests existants).
3. Dates/pluriels via `Intl`.
4. `en.json` + catalogue anglais + sélecteur de langue ; langue des notifications Discord.
5. Test de complétude des traductions en CI.

Les langues s’écrivant de droite à gauche (arabe, hébreu) ne sont pas visées dans un premier temps ; la mise en page
utilise déjà majoritairement flexbox/grid, ce qui faciliterait un passage aux propriétés logiques CSS plus tard.

## 0.7 — Usage quotidien

- **Durée de conservation après ouverture par catégorie** (ex. lait 3 jours, sauce 5 jours) : l’alerte « ouvert depuis
  trop longtemps » deviendrait pertinente produit par produit au lieu d’un seuil global. Valeur proposée, modifiable.
- **Liste de courses** simple : un produit terminé (quantité à zéro) peut être ajouté à la liste en un geste ;
  liste imprimable et partageable ; cocher un article le remet en stock.
- **Stock minimum** facultatif par produit (« toujours au moins 2 paquets de pâtes ») → suggestion dans la liste de courses.
- **Historique léger** des mouvements (ajouté, ouvert, terminé) pour annuler au-delà du toast actuel et voir
  ce qui est consommé ou jeté.
- **Catégories personnalisables** (ajout, renommage, icône) si la liste fixe s’avère insuffisante.
- **PWA hors ligne en lecture** : consulter le stock au supermarché sans réseau (service worker, cache de l’état).

## 0.8 — Notifications et intégrations

- Autres canaux que Discord : **ntfy**, **Gotify**, **e-mail (SMTP)**, Telegram — même récapitulatif, même logique d’envoi.
- **Jeton d’API** (en plus du mot de passe) pour automatisations : Home Assistant, raccourcis iOS/Android.
- Export **CSV** pour tableur, en complément du JSON.

## 1.0 — Stabilisation

- Format d’export JSON **versionné et documenté**, compatibilité ascendante garantie.
- Politique de migration : toute version peut être mise à jour depuis n’importe quelle version 0.x antérieure (testé en CI).
- Audit d’**accessibilité** (axe-core en CI, navigation clavier, lecteurs d’écran).
- Documentation séparée du README (installation, utilisation, administration, contribution).

## Hors périmètre (volontairement)

Codes-barres, marques, recettes, calories, gestion multi-foyers ou comptes avec droits : contraires à l’objectif
de simplicité. À reconsidérer uniquement sur demande forte et sans alourdir la saisie.
