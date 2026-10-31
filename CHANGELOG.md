# Journal des modifications

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) ; versions selon [SemVer](https://semver.org/lang/fr/).
Les migrations de base de données sont automatiques au démarrage.

## [0.4.0] — 2026-10-31

### Modifié
- Cartes produits : maillage (lignes et points) et dégradés plus marqués, bordures et ombres affinées.
- Thème clair par défaut, quel que soit le réglage du système (le thème sombre reste disponible via le bouton).
- Image Docker épinglée (`node:24.22.2-alpine3.24` + empreinte) ; plus besoin de `--disable-warning` dans les commandes.
- Le fichier Docker Compose n’est plus versionné : modèle fourni dans `compose.example.yml`.

### Ajouté
- Commandes `docker exec` / `docker compose run` / `docker run` de réinitialisation du mot de passe (README).
- Maintenance : Dependabot, intégration continue (tests Node 22 et 24, build et démarrage de l’image), modèles d’issue et de PR,
  `SECURITY.md`, ce journal et `ROADMAP.md`.

## [0.3.0] — 2026-10-31

### Ajouté
- Protection facultative par mot de passe unique (page de connexion, sessions de 30 jours, limitation des essais).
- Bouton thème clair/sombre et couleur d’accentuation (ordinateur).

### Modifié
- Nouvelles cartes produits (dégradé teinté selon l’état, sans liseré).
- Suppression du niveau « Plein » pour un produit entamé (migration : devient « non indiqué »).

## [0.2.0] — 2026-10-31

### Ajouté
- Catégories déduites du nom, avec icône ; barre latérale de filtres (espace, catégorie, péremption).
- Niveau restant des produits entamés.
- Administration : export JSON, import (fusion ou remplacement), purge confirmée.

## [0.1.0] — 2026-10-31

### Ajouté
- Première version : espaces, produits, ouverture partielle, vues Tout/Ouverts/Fermés, impression A4,
  récapitulatif Discord planifié, Docker Compose, sauvegarde.
