# CDI Finder — Agent de candidature

https://cdi-finder.vercel.app

Application web qui t'aide à postuler : tu colles une offre d'emploi, l'agent génère un
**CV adapté (compatible ATS)** et une **lettre de motivation** en `.docx`, puis tu suis
tes candidatures. Multi-comptes : chacun choisit son fournisseur d'IA — gratuit, ou sa
propre clé API.

> **Le CV n'invente jamais rien** : il sélectionne, réordonne et reformule uniquement tes
> vraies expériences pour coller aux mots-clés de l'offre.

---

## Fonctionnalités

- **Comptes personnels** — connexion e-mail, données isolées par utilisateur (RLS Postgres).
- **Gratuit par défaut** — modèles open-source (Llama…) via Groq, aucune clé à saisir.
- **Ou ta clé, ton usage** — **Anthropic**, **OpenAI** ou **Gemini** : ta clé est
  **chiffrée** (AES-256-GCM) avant stockage, jamais renvoyée au navigateur.
- **Import de CV** — dépose ton CV (PDF / DOCX) ou colle son texte : le modèle en extrait
  automatiquement ton profil (tu relis avant d'enregistrer).
- **Génération ciblée** — colle une offre (texte ou URL) → CV + lettre adaptés aux
  mots-clés ATS de l'offre.
- **Français ou anglais** — au choix, contenu *et* titres de sections du `.docx`.
- **CV, lettre, ou les deux** — tu choisis ce que tu génères.
- **Pilotable depuis Claude (MCP)** — créer une candidature, relire tes documents
  et changer un statut en conversation, sans ouvrir l'app.
- **Suivi** — statut de chaque candidature (brouillon → envoyée → entretien → offre).
- **Export `.docx`** compatible ATS (une colonne, titres standards, pas de tableau).

## Stack

Next.js 15 (App Router, TypeScript) · Tailwind CSS · Supabase (Postgres + Auth) ·
Anthropic Claude / OpenAI / Gemini / Groq · docx / unpdf / mammoth · serveur MCP
(stdio + HTTP) · déployé sur Vercel.

---

## Installation

### 1. Base de données Supabase

1. [supabase.com](https://supabase.com) → **New project**.
2. **SQL Editor** → **New query** → colle le contenu de [`supabase/schema.sql`](./supabase/schema.sql) → **Run**
   (crée les tables, la sécurité RLS, et la création auto du profil à l'inscription).
3. **Settings → API** (et **Data API** pour l'URL) → note :
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL` (**sans** `/rest/v1/` au bout)
   - clé `anon` / publishable → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - clé `service_role` / secret → `SUPABASE_SERVICE_ROLE_KEY`
4. Pour tester sans boîte mail : **Authentication → Sign In / Providers → Email** →
   désactive **« Confirm email »**.

### 2. Clé de chiffrement

Sert à chiffrer les clés API des utilisateurs :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

→ valeur de `APP_ENCRYPTION_KEY` (64 caractères). **Ne la perds pas** : sans elle, les clés
API déjà enregistrées deviennent illisibles.

### 3. Accès gratuit (optionnel)

Le fournisseur **« Gratuit (open-source) »** fait tourner des modèles Llama via
[Groq](https://console.groq.com/keys) avec **une clé serveur partagée** : les utilisateurs
n'ont alors aucune clé à saisir. Crée une clé gratuite → `GROQ_API_KEY`.

Laisse la variable vide pour désactiver le mode gratuit (chacun devra fournir sa clé).

### 4. Lancer en local

```bash
cp .env.local.example .env.local      # puis remplis les valeurs
npm install
npm run dev                           # http://localhost:3000
```

Crée un compte → **Paramètres** (mode gratuit, ou ta clé) → **Mon profil** (importe ton CV) →
**Nouvelle candidature**.

### 5. Déployer sur Vercel

1. Importe le dépôt GitHub sur [vercel.com](https://vercel.com).
2. **Settings → Environment Variables** : ajoute les variables ci-dessus
   (`GROQ_API_KEY` incluse si tu veux le mode gratuit en ligne), plus
   `NEXT_PUBLIC_APP_URL` = l'URL de ton déploiement — elle sert aux liens de
   téléchargement renvoyés par le connecteur MCP.
3. **Deploy**. Chaque `git push` redéploie automatiquement.

   `CDI_FINDER_EMAIL` / `CDI_FINDER_PASSWORD` ne concernent que le serveur MCP **local** :
   inutile de les mettre sur Vercel.

---

## Piloter CDI Finder depuis Claude (MCP)

Le projet expose ses fonctions comme **outils MCP** : lister et créer des candidatures,
relire le CV et la lettre générés, changer un statut, consulter et corriger ton profil,
voir tes statistiques. Deux transports, un seul jeu d'outils (`lib/mcp/tools.ts`).

### En local — Claude Code / Claude Desktop

Le serveur se connecte à Supabase avec **ton compte** : la RLS s'applique normalement,
aucun jeton à générer.

1. Complète dans `.env.local` :

   ```bash
   CDI_FINDER_EMAIL=ton@email.fr
   CDI_FINDER_PASSWORD=ton-mot-de-passe    # ceux de ton compte CDI Finder
   CDI_FINDER_EXPORT_DIR=                  # optionnel — défaut : ./sorties
   NEXT_PUBLIC_APP_URL=                    # optionnel — liens de téléchargement
   ```

2. Claude Code le détecte via [`.mcp.json`](./.mcp.json) à l'ouverture du projet
   (tape `/mcp` pour vérifier). Pour Claude Desktop :

   ```json
   { "mcpServers": { "cdi-finder": {
       "command": "npx", "args": ["-y", "tsx", "mcp/stdio.ts"],
       "cwd": "/chemin/vers/cdi_finder_promax" } } }
   ```

3. Vérification manuelle : `npm run mcp` doit afficher *Serveur MCP prêt*.

En local uniquement, l'outil **`exporter_documents`** écrit les `.docx` sur ton disque.

### À distance — claude.ai / Claude mobile

1. **Paramètres → Piloter CDI Finder depuis Claude** → *Générer un jeton*.
   Copie-le tout de suite : seule son empreinte SHA-256 est stockée, il n'est jamais
   réaffiché.
2. Branche-le sur `https://ton-app.vercel.app/api/mcp` avec l'en-tête
   `Authorization: Bearer <jeton>`. Depuis Claude Code :

   ```bash
   claude mcp add --transport http cdi-finder https://ton-app.vercel.app/api/mcp \
     --header "Authorization: Bearer cdi_..."
   ```

3. Jeton perdu ou machine compromise → *Régénérer* (invalide l'ancien) ou *Révoquer*.

Le serveur distant ne peut pas écrire sur ta machine : il renvoie des **liens de
téléchargement** (basés sur `NEXT_PUBLIC_APP_URL`), à ouvrir dans le navigateur où tu es
connecté.

> Les colonnes du jeton viennent de [`supabase/schema.sql`](./supabase/schema.sql). Si les
> boutons renvoient une erreur `mcp_token`, rejoue le script dans Supabase.

---

## Structure

```
app/
├── login/                  # connexion / inscription
├── (app)/                  # espace connecté (protégé)
│   ├── dashboard/          # liste des candidatures
│   ├── nouvelle/           # offre + langue + choix docs → génération
│   ├── candidatures/[id]/  # détail, téléchargements, statut
│   ├── profil/             # import CV (Claude) ou édition JSON
│   └── parametres/         # fournisseur + clé API, jeton MCP
└── api/                    # generate, profil/extraire, téléchargements .docx, mcp
lib/                        # llm, providers, keys, crypto, docx, ingestion, cvparse,
                            # candidatures (cœur partagé app + MCP), supabase, data
lib/mcp/                    # outils MCP + jetons — communs aux deux transports
mcp/stdio.ts                # serveur MCP local (Claude Code / Claude Desktop)
supabase/schema.sql         # à exécuter dans Supabase (idempotent)
```

## Sécurité

- Secrets (`.env*`) et données personnelles (`profil/profil.json`) sont **hors git**.
  `profil/profil.example.json` fournit la structure avec des données fictives.
- Les clés API sont chiffrées au repos et déchiffrées uniquement côté serveur, à l'appel.
- Du jeton MCP, la base ne garde que l'empreinte SHA-256 — révocable à tout moment.
- `/api/mcp` s'authentifie par jeton, donc hors middleware de session : chaque requête
  filtre explicitement sur `user_id` (le client `service_role` ignore la RLS).

## Commandes

```bash
npm run dev         # développement
npm run build       # build production   ( pas en même temps que `dev`)
npm run typecheck   # vérification TypeScript
npm run mcp         # serveur MCP local (stdio) — normalement lancé par Claude
```
