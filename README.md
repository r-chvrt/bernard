# Bernard · stock alimentaire du foyer

Bernard est une petite application web auto-hébergée pour savoir **ce que l’on a**, **où c’est rangé**, **ce qui est ouvert** et **ce qui va bientôt périmer**. Elle est conçue pour être alimentée en quelques secondes : seuls le nom, l’espace, la quantité et l’état sont obligatoires.

- Interface en français, adaptée à l’ordinateur, à la tablette et au smartphone (thème clair/sombre automatique).
- Espaces de rangement personnalisables (placard, frigo, congélateur…).
- Ouverture partielle en un geste : « Ouvrir 1 paquet » retire un paquet du stock fermé et l’ajoute aux produits ouverts.
- Niveau restant des produits entamés (plein, ¾, ½, ¼, presque vide) réglable d’un clic.
- Catégories déduites automatiquement du nom et affichées sous forme d’icône.
- Trois vues (Tout, Ouverts, Fermés) avec résumé, recherche, filtres en barre latérale (espace, catégorie, date), tri et version imprimable A4.
- Export, import et purge des données depuis les paramètres.
- Récapitulatif Discord quotidien ou hebdomadaire, envoyé par le serveur, même navigateur fermé.

---

## 1. Architecture

| Élément | Choix | Pourquoi |
|---|---|---|
| Serveur | Node.js 24, module `http` natif | Aucune dépendance npm à installer ni à maintenir |
| Base de données | SQLite via `node:sqlite` (intégré à Node) | Un seul fichier, pas de service supplémentaire |
| Interface | HTML + CSS + JavaScript natifs, sans étape de build | Léger, rapide, facile à modifier |
| Notifications | Planificateur intégré au processus serveur | Pas de cron ni de conteneur en plus |
| Déploiement | Docker Compose, un conteneur, un volume `/data` | Données conservées lors des mises à jour |

En fonctionnement, l’application consomme environ **20 Mo de RAM**.

```
server/
  index.js     démarrage du serveur et du planificateur
  app.js       API REST + fichiers statiques + en-têtes de sécurité
  db.js        schéma SQLite, migrations, paramètres
  alerts.js    calcul des alertes, message Discord, planificateur
  units.js     unités disponibles
  dates.js     outils de dates et de fuseaux horaires
  demo.js      jeu de données d’exemple
  seed.js      charge les exemples en ligne de commande
  backup.js    sauvegarde à chaud de la base
public/
  index.html, app.css, app.js   interface
  catalog.js                    catégories, ~200 produits génériques, déduction de catégorie
                                (module partagé par le navigateur et le serveur)
test/          tests automatisés (node --test)
```

---

## 2. Installation et lancement (Docker Compose)

Prérequis : Docker avec le plugin Compose.

```bash
git clone <url-du-depot> bernard
```

```bash
cd bernard
```

```bash
docker compose up -d --build
```

Ouvrez ensuite **http://localhost:3000** (ou `http://<ip-du-serveur>:3000`).

Au premier lancement, trois espaces sont créés (Placard, Frigo, Congélateur) ; vous pouvez les renommer ou les supprimer dans **Paramètres**.

### Configuration

Copiez `.env.example` en `.env` si vous voulez changer les valeurs par défaut :

| Variable | Défaut | Rôle |
|---|---|---|
| `BERNARD_PORT` | `3000` | Port exposé sur la machine hôte |
| `TZ` | `Europe/Paris` | Fuseau horaire par défaut (modifiable ensuite dans l’interface) |
| `DISCORD_WEBHOOK_URL` | *(vide)* | Facultatif : webhook défini côté serveur, prioritaire sur celui de l’interface |

Variables internes au conteneur (rarement utiles) : `PORT` (3000), `DATA_DIR` (`/data`), `HOST` (`0.0.0.0`).

### Mise à jour

```bash
git pull
```

```bash
docker compose up -d --build
```

Les données sont dans le volume `bernard-data` et ne sont pas touchées. Le schéma de la base est mis à jour automatiquement au démarrage.

### Lancement sans Docker

Node.js 22.13 ou plus récent suffit (aucun `npm install` nécessaire) :

```bash
npm start
```

Les données sont alors stockées dans `./data/stock.db`.

### Sécurité

Bernard n’a **pas de comptes utilisateurs** : il est pensé pour un réseau domestique. Si vous l’exposez sur Internet, placez-le derrière un reverse proxy avec authentification (Caddy, Nginx, Traefik, Authelia…) et HTTPS.

---

## 3. Sauvegarde et restauration

Toutes les données (produits, espaces, paramètres, webhook) sont dans un seul fichier SQLite : `/data/stock.db` dans le volume `bernard-data`.

**Créer une sauvegarde** (cohérente, possible pendant que l’application tourne) :

```bash
docker compose exec bernard node --disable-warning=ExperimentalWarning server/backup.js /data/backup.db
```

**La copier sur la machine hôte :**

```bash
docker compose cp bernard:/data/backup.db ./bernard-$(date +%F).db
```

Sans chemin, `server/backup.js` crée un fichier horodaté dans `/data/backups/`. Pour une sauvegarde quotidienne, ajoutez ces deux commandes à une tâche `cron` de la machine hôte.

**Restaurer une sauvegarde :**

```bash
docker compose stop
```

```bash
docker compose run --rm --no-deps -v "$PWD/bernard-2026-10-31.db:/restore.db:ro" bernard sh -c 'cp /restore.db /data/stock.db && rm -f /data/stock.db-wal /data/stock.db-shm'
```

```bash
docker compose start
```

(La copie passe par un conteneur temporaire pour que le fichier appartienne à l’utilisateur de l’application.)

> La sauvegarde contient l’URL du webhook Discord : conservez-la en lieu sûr.

---

## 4. Utilisation

### Ajouter un produit
Bouton **Ajouter un produit** (ou le bouton **+** sur mobile, ou la touche **N**).
1. Tapez le nom : des suggestions apparaissent (produits génériques et noms déjà utilisés). Choisir une suggestion règle aussi l’unité. La saisie reste libre.
   La **catégorie** est proposée automatiquement d’après le nom (« Penne rigate » → Pâtes, riz & féculents) ; vous pouvez la changer, et votre choix est retenu pour la prochaine saisie du même nom.
2. Choisissez l’espace (le dernier utilisé est présélectionné), la quantité et l’état.
3. Date de péremption et date d’ouverture sont facultatives.

**Enregistrer et ajouter un autre** garde l’espace et l’état : pratique au retour des courses.
Si une entrée identique existe déjà (même nom, espace, unité, état et dates), la quantité est simplement ajoutée.

### Au quotidien
- **− / +** : ajuste la quantité (pas adapté à l’unité : 1 paquet, 0,5 kg, 100 g…). À zéro, l’entrée est retirée et un bouton **Annuler** permet de revenir en arrière.
- Cliquer sur la quantité ouvre la fiche pour saisir une valeur exacte.
- **Ouvrir** (produits fermés) : choisissez combien ouvrir ; la date du jour est proposée (modifiable ou effaçable). Le stock fermé diminue et l’entrée ouverte est créée ou complétée.
- **Reste** (produits ouverts) : cliquez sur la petite jauge pour indiquer ce qu’il reste dans le produit entamé — Plein, ¾, ½, ¼ ou Presque vide (orange à partir de ¼). Le niveau apparaît aussi à l’impression et dans les messages Discord. « Reste ? » signifie qu’il n’a pas été indiqué.
- **Crayon** : modifier la fiche, déplacer vers un autre espace, changer l’état.
- **Corbeille** : suppression après confirmation.

### Vues, filtres et indicateurs
- **Tout / Ouverts / Fermés**, avec un résumé : entrées affichées, ouverts/fermés, bientôt périmés, périmés, ouverts depuis longtemps. Cliquer sur une carte du résumé filtre la liste.
- **Barre latérale de filtres** (à gauche ; bouton **Filtres** sur mobile) : espace, catégorie et date de péremption, avec le nombre de produits pour chaque choix. Exemple : vue **Ouverts** + catégorie **Pâtes, riz & féculents** = tous les paquets de pâtes, riz, couscous… entamés.
- Chaque produit est précédé de l’icône de sa catégorie (🍝 féculents, 🥫 conserves, 🧀 laitiers, 🧊 surgelés…), avec son nom au survol.
- Recherche par nom (insensible aux accents) et menu de tri (péremption, nom, catégorie, espace, ouverture, ajout récent).
- Indicateurs : bordure et badge **orange « Périme dans n j »**, **rouge « Périmé »**, badge **« Ouvert depuis n j »** au-delà du seuil. Les seuils se règlent dans Paramètres.
- Les quantités d’unités différentes ne sont jamais additionnées.

### Impression
**Imprimer** produit une liste A4 en noir et blanc de la vue actuelle avec ses filtres et son tri (avec le tri « espace » ou « catégorie », les produits sont regroupés). Chaque ligne a une case à cocher, les dates proches sont marquées **⚠ J-n** et les produits périmés **PÉRIMÉ**.

### Espaces de rangement
Dans **Paramètres** : ajouter, renommer, réordonner (flèches) ou supprimer. Si l’espace contient des produits, l’application propose de les **déplacer** vers un autre espace ou de **confirmer leur suppression**.

### Administration (Paramètres)
- **Exporter** télécharge un fichier JSON lisible (produits, espaces, historique de saisie, réglages). L’URL du webhook n’y figure jamais.
- **Importer…** lit un export puis propose : **Ajouter au stock actuel** (les espaces manquants sont créés) ou **Remplacer tout** (produits, espaces, historique et réglages ; le webhook en place est conservé). Le fichier est vérifié entièrement avant tout changement : en cas d’erreur, rien n’est modifié et le produit fautif est indiqué.
- **Purger…** propose **Vider le stock** (espaces, réglages et suggestions conservés) ou **Tout réinitialiser** (y compris le webhook). Il faut taper `PURGER` pour confirmer.

L’export JSON complète la sauvegarde du fichier SQLite décrite plus haut : il est pratique pour transférer le stock vers une autre installation.

### Données d’exemple
Sur l’écran d’accueil vide, **Charger des exemples** ajoute 18 produits (dates calculées par rapport à aujourd’hui) pour découvrir l’interface. En ligne de commande :

```bash
docker compose exec bernard node --disable-warning=ExperimentalWarning server/seed.js
```

---

## 5. Notifications Discord

1. Dans Discord : **Paramètres du salon → Intégrations → Webhooks → Nouveau webhook → Copier l’URL du webhook**.
2. Dans Bernard : **Paramètres → Notifications Discord**, collez l’URL, cliquez sur **Tester le webhook** (un message de test arrive dans le salon), puis **Enregistrer**.
3. Réglez :
   - les alertes actives : **bientôt périmés** (à partir de *n* jours avant la date), **périmés**, **ouverts depuis au moins *n* jours** ;
   - la **fréquence** (tous les jours ou un jour de la semaine), l’**heure** et le **fuseau horaire** ;
   - l’option **Ne pas renvoyer un récapitulatif identique au précédent**.

**Fonctionnement**
- Le serveur vérifie chaque minute si l’envoi est dû : aucun navigateur n’a besoin d’être ouvert.
- Un seul message par jour (ou par semaine), regroupant tous les produits concernés par catégorie. Rien n’est envoyé s’il n’y a rien à signaler.
- Si le serveur était éteint à l’heure prévue, le récapitulatif part dès son redémarrage le même jour. En cas d’échec (Discord injoignable), un nouvel essai a lieu 15 minutes plus tard.
- Un produit **sans date de péremption** ne déclenche jamais d’alerte de péremption ; un produit **sans date d’ouverture** ne déclenche jamais d’alerte « ouvert depuis trop longtemps ».
- **Envoyer le récapitulatif maintenant** permet de vérifier le message à tout moment. L’état du dernier envoi est affiché sous le formulaire.

**Confidentialité du webhook** : l’URL est enregistrée uniquement côté serveur (base SQLite ou variable `DISCORD_WEBHOOK_URL`). Elle n’est jamais renvoyée au navigateur (l’interface indique seulement « Webhook configuré »), n’apparaît pas dans le code de la page et n’est jamais écrite dans les journaux, y compris en cas d’erreur. Seules les URL `https://discord.com/api/webhooks/…` sont acceptées.

---

## 6. Vérifications

### Tests automatisés

```bash
npm test
```

20 tests couvrent : champs obligatoires et validation, unité par défaut, fusion des entrées identiques, **ouverture partielle** (diminution du stock fermé, création puis mise à jour de l’entrée ouverte, conservation de la date de péremption, disparition de l’entrée fermée à zéro), déplacement et changement d’état, suppression d’un espace non vide (refus, déplacement, suppression), règles des **alertes** (seuils, produits sans date, alertes désactivées), contenu du message Discord, **un seul envoi par période**, option « message identique », **non-divulgation du webhook** (API et messages d’erreur), protection CSRF et en-têtes de sécurité, **catégories** (déduction depuis un nom libre, modification), **niveau restant**, **export / import** (remplacement, fusion, fichier invalide sans effet), **purge** avec confirmation et migration d’une base existante.

### Vérification manuelle (5 minutes)

1. **Premier lancement** : la page affiche « Votre stock est vide » avec les boutons Ajouter et Charger des exemples.
2. **Ajout** : tapez « pât », choisissez « Pâtes » → l’unité passe à « paquet ». Mettez 3, état Fermé, enregistrez. La ligne apparaît.
3. **Ouverture** : cliquez sur **Ouvrir**, validez → « 2 paquets » fermés et « 1 paquet » ouvert avec la date du jour. La vue **Ouverts** le montre.
4. **Consommation** : cliquez sur **−** du paquet ouvert → l’entrée disparaît, **Annuler** la restaure.
5. **Péremption** : modifiez un produit avec la date de demain → badge orange « Périme demain » et compteur « bientôt périmés » à jour ; date d’hier → badge rouge « Périmé ».
6. **Impression** : filtrez sur un espace, cliquez sur **Imprimer** → aperçu A4 sans boutons ni menus, avec le titre de la vue et le filtre actif.
7. **Espaces** : supprimez un espace qui contient des produits → choix entre déplacer et supprimer.
8. **Discord** : collez l’URL du webhook, **Tester le webhook**, puis **Envoyer le récapitulatif maintenant** → le salon reçoit le récapitulatif. Rechargez la page : l’URL n’est plus affichée, seul « Webhook configuré » apparaît.
9. **Catégories et reste** : vue **Ouverts**, cliquez sur « Pâtes, riz & féculents » dans les filtres → seuls les féculents entamés restent. Cliquez sur la jauge d’un produit et choisissez ½ → « Reste ½ ».
10. **Administration** : **Exporter**, puis **Purger… → Vider le stock** (taper PURGER), puis **Importer…** le fichier → le stock revient à l’identique.
11. **Persistance** : `docker compose restart` → les produits et paramètres sont toujours là.
12. **Mobile** : sur un téléphone, la navigation est en bas de l’écran, le bouton **Filtres** ouvre le panneau latéral et le bouton **+** ouvre le formulaire en panneau.

---

## 7. API (pour information)

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/state` | Espaces, produits, unités, historique des noms, paramètres publics |
| POST / PATCH / DELETE | `/api/products[/:id]` | Ajouter / modifier / supprimer un produit |
| POST | `/api/products/:id/open` | Ouvrir une partie d’un stock fermé `{quantity, opened_on}` |
| POST / PATCH / DELETE | `/api/spaces[/:id]` | Gérer les espaces (`?products=move&target=ID` ou `?products=delete`) |
| PUT | `/api/settings` | Paramètres et webhook |
| GET | `/api/export` | Export JSON (sans le webhook) |
| POST | `/api/import` | Import `{mode: "merge" \| "replace", data}` |
| POST | `/api/purge` | Purge `{scope: "products" \| "all", confirm: "PURGER"}` |
| POST | `/api/notifications/test` · `/send` | Tester le webhook · envoyer le récapitulatif |
| GET | `/api/health` | Contrôle de santé (utilisé par Docker) |

Les requêtes d’écriture doivent être envoyées en `application/json`.
