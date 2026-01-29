# BennyStab

BennyStab est un jeu web multijoueur temps réel (4 à 8 joueurs) inspiré de la déduction sociale. Deux équipes secrètes s'affrontent : **Gentils** contre **Saboteurs**. Le serveur est l'autorité unique : il valide les déplacements, les actions, les votes et la distribution des rôles.

## ✅ Fonctionnalités v1

- Lobby avec skins **uniques** verrouillés en temps réel.
- Attribution serveur des équipes et rôles secrets selon le nombre de joueurs.
- Boucle de jeu : `LOBBY → RUNNING → DISCUSSION → VOTING → RESOLVE → RUNNING`.
- Chat de proximité en FREE_ROAM + chat global en DISCUSSION/VOTING.
- Kill/report/sabotage/repair avec cooldowns et validations serveur.
- Rôles Gentils : Chef d’Atelier, Mécano, Comptable, Dépanneur (+ vanilla si nécessaire).

## 📦 Installation

```bash
npm install
npm run dev
```

Ouvrez ensuite : `http://localhost:3000`

### Dépannage registry npm (erreur 403)

Le projet attend **exclusivement** le registry public npm (aucun token requis). Assurez-vous que votre config utilise : `https://registry.npmjs.org/`.

```bash
npm config set registry https://registry.npmjs.org/
npm cache clean --force
```

## 🧭 Structure du repo

```
/server   # Serveur Node.js + Socket.io (autorité jeu)
/client   # UI HTML + canvas (overlay, chat, lobby)
```

## 🕹️ Règles rapides

- 4 à 8 joueurs par room.
- Les Saboteurs doivent se fondre dans la masse (mêmes skins, mêmes déplacements).
- Les Gentils gagnent si tous les Saboteurs sont éliminés.
- Les Saboteurs gagnent si leur nombre est >= aux Gentils.
- Vote double pour le Chef d’Atelier.
- Dépanneur immunisé 60s contre la mort.

## 🧪 Notes techniques

- Tout est validé côté serveur (anti-triche).
- La mémoire est in-memory (v1), structure prête pour Redis.
