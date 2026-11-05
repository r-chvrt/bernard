# Contrat de l’API externe v1 de Bernard autonome

Ce document décrit le comportement existant de Bernard autonome ; il ne définit pas encore un contrat commun avec Bercail. Seule la route `GET /api/v1/stock` est exposée en v1. Les autres routes `/api/*`, notamment celles de gestion de la clé et des produits, appartiennent à l’interface de Bernard et ne font pas partie de ce contrat externe.

## Accès

Générez une clé dans **Paramètres → Administration → Clé d’API**. Elle n’est affichée en clair qu’une fois. La régénération remplace immédiatement la clé précédente ; la révocation désactive l’accès. La clé est unique pour l’installation, pas par application ni par foyer. Activez aussi le mot de passe de Bernard pour protéger son interface et la gestion de la clé : celle-ci ne protège pas le reste de l’application.

Envoyez la clé dans `Authorization` avec le schéma `Bearer`, ou dans `X-API-Key`. Ne la placez pas dans l’URL. Utilisez HTTPS hors d’un environnement local de confiance et évitez de journaliser les en-têtes. Une session navigateur ne remplace pas la clé ; la clé ne donne pas accès aux autres routes. Si les deux en-têtes sont présents et que `Authorization` contient un Bearer syntaxiquement valide, celui-ci est prioritaire.

```sh
curl --header "X-API-Key: $BERNARD_API_KEY" https://bernard.example/api/v1/stock
```

La réponse est du JSON UTF-8 avec `Cache-Control: no-store`. Sans clé configurée, manquante ou incorrecte, la route répond `401` avec un objet `{ "error": "…" }`. Après cinq clés incorrectes depuis une même adresse, les tentatives suivantes sont temporairement limitées par `429` ; le délai augmente avec les échecs. Ne dépendez pas du texte des erreurs. Une méthode ou route inconnue peut répondre `404` ; une requête d’écriture sans `Content-Type: application/json` peut être rejetée avec `415` avant recherche de la route. Aucune écriture de stock n’est disponible dans l’API v1.

## Réponse `200`

L’objet racine contient :

| Champ | Type | Signification |
| --- | --- | --- |
| `version` | nombre | `1` |
| `generated_at` | chaîne | instant de génération ISO 8601 en UTC |
| `today` | chaîne | date locale `AAAA-MM-JJ` dans `timezone` |
| `timezone` | chaîne | fuseau des réglages ; `UTC` si invalide |
| `expiry_days` | entier | seuil des produits bientôt périmés, en jours |
| `foods` | tableau | regroupements d’aliments ; vide si aucun stock |
| `items` | tableau | entrées individuelles ; vide si aucun stock |

Les champs suivants sont présents ; `null` indique une donnée absente. Les clients doivent ignorer les champs supplémentaires qu’une évolution compatible pourrait ajouter.

### Entrées `items`

| Champ | Type | Signification |
| --- | --- | --- |
| `id` | entier | identifiant de l’entrée dans cette installation |
| `name` | chaîne | nom de l’aliment |
| `category`, `category_label` | chaînes | identifiant de catégorie et libellé français |
| `space` | chaîne ou null | nom de l’espace de rangement |
| `quantity` | nombre | quantité enregistrée |
| `unit`, `unit_label` | chaînes | identifiant et libellé français de l’unité |
| `estimated_quantity` | nombre | quantité estimée après application du reste |
| `state` | chaîne | `open` ou `closed` |
| `remaining` | entier ou null | pourcentage restant indiqué pour une entrée ouverte ; sinon null |
| `opened_on`, `expires_on` | chaîne ou null | dates `AAAA-MM-JJ`, si renseignées |
| `days_left` | entier ou null | jours entre `today` et `expires_on`, négatif si périmé |
| `expiry_status` | chaîne | état de péremption ci-dessous |

### Regroupements `foods`

Les entrées de quantité strictement positive sont regroupées par nom converti en minuscules et unité identique : aucune conversion d’unité ni normalisation supplémentaire n’est effectuée. Le nom et la catégorie proviennent de la première entrée du groupe. Les regroupements sont triés par prochaine date de péremption croissante, puis par nom ; ceux sans date viennent après ceux datés. L’ordre des entrées et des identifiants ne doit pas servir d’identifiant stable.

| Champ | Type | Signification |
| --- | --- | --- |
| `name`, `category`, `category_label`, `unit`, `unit_label` | chaînes | nom, catégorie et unité du groupe et leurs libellés |
| `quantity` | nombre | somme des quantités |
| `estimated_quantity` | nombre | somme des quantités estimées |
| `open_quantity`, `closed_quantity` | nombres | sommes des quantités brutes ouvertes et fermées |
| `spaces` | tableau de chaînes | noms distincts des espaces du groupe |
| `next_expiry` | chaîne ou null | première date de péremption du groupe |
| `days_left` | entier ou null | jours restants jusqu’à cette date |
| `expiry_status` | chaîne | état correspondant à cette date |
| `item_ids` | tableau d’entiers | identifiants des entrées composant le groupe |

Pour une entrée ouverte dont `remaining` est renseigné, `estimated_quantity` vaut `quantity × remaining / 100`, arrondi à trois décimales ; sinon elle vaut `quantity`. Les sommes des groupes sont arrondies à trois décimales. `open_quantity` et `closed_quantity` ne tiennent pas compte du reste.

Pour les entrées comme pour les groupes : `expired` signifie `days_left < 0` ; `expiring` signifie `0 ≤ days_left ≤ expiry_days` ; `ok` signifie au-delà du seuil ; `unknown` signifie sans date. Les produits périmés restent inclus : le client décide de les écarter ou non.

## Compatibilité et limites

La version de l’enveloppe vaut `1`. Les consommateurs devraient ignorer les champs inconnus et gérer les valeurs nulles indiquées ci-dessus. Les identifiants sont locaux à l’installation ; ils ne constituent pas une identité portable entre exports ou instances. Les libellés sont destinés à l’affichage, pas à servir de clés de rapprochement. Il n’y a actuellement ni pagination ni filtre serveur documentés. Ce contrat décrit l’API existante : il ne promet pas de nouvelles routes, d’accès multi-foyer ou de correspondance automatique avec les ingrédients d’une autre application.
