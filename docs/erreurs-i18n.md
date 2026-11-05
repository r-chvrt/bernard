# Codes d’erreur pour la traduction

L’API utilisée par l’interface renvoie toujours `error`, message français historique. Certaines erreurs de validation incluent désormais un `code` stable, et éventuellement `params` pour l’interpolation. Exemple :

```json
{"error":"Le nom ne doit pas dépasser 40 caractères","code":"name_too_long","params":{"max":40}}
```

Un futur client traduit `code` avec `params` ; si le code est absent ou inconnu, il affiche `error`. Ne pas déduire le code du texte français. La forme et le statut HTTP restent compatibles avec les clients existants.

| Code | Signification | Paramètres |
|---|---|---|
| `name_required` | Nom vide | — |
| `name_too_long` | Nom trop long | `max` (40 pour un espace, 80 pour un produit) |
| `quantity_positive` | Quantité non numérique, non finie ou non positive | — |
| `quantity_too_large` | Quantité supérieure à 100 000 | — |
| `expiry_date_invalid` | Date de péremption invalide | — |
| `opened_date_invalid` | Date d’ouverture invalide | — |
| `remaining_invalid` | Pourcentage restant invalide | — |
| `space_unknown` | Espace inconnu | — |
| `unit_unknown` | Unité inconnue | — |
| `state_invalid` | État autre que ouvert ou fermé | — |

Périmètre actuel : validations partagées des noms et quantités et champs du formulaire produit. Les autres erreurs, notamment connexion, réglages, import et webhook, ne possèdent pas encore toutes un code. L’interface et les notifications restent en français : ceci prépare l’internationalisation, sans constituer une traduction FR/EN. L’API externe `/api/v1/stock` et ses unités ne changent pas.
