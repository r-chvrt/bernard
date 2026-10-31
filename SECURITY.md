# Sécurité

## Signaler une vulnérabilité

Merci de **ne pas ouvrir d’issue publique**. Utilisez l’onglet **Security → Report a vulnerability** du dépôt GitHub
(signalement privé), ou contactez le mainteneur directement. Une réponse est donnée sous 7 jours.

## Versions prises en charge

Seule la dernière version de la branche principale reçoit des correctifs.

## Modèle de sécurité (résumé)

- Application prévue pour un **réseau domestique**. La protection par **mot de passe unique** est facultative ;
  pour un accès depuis Internet, activez-la **et** placez Bernard derrière un reverse proxy **HTTPS**.
- Mot de passe haché avec **scrypt** ; sessions par cookie `HttpOnly`, `SameSite=Lax` (`Secure` en HTTPS), 30 jours.
- Limitation des tentatives de connexion par adresse IP.
- L’URL du webhook Discord et le hash du mot de passe ne sont **jamais** renvoyés au navigateur, exportés ni journalisés.
- Écritures de l’API uniquement en `application/json` (protection CSRF), politique CSP stricte (`default-src 'self'`),
  conteneur exécuté en utilisateur non privilégié.
- Aucune dépendance npm ; l’image de base Docker est épinglée et suivie par Dependabot.
