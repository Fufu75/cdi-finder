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
- **Suivi** — statut de chaque candidature (brouillon → envoyée → entretien → offre).
- **Export `.docx`** compatible ATS (une colonne, titres standards, pas de tableau).

## Stack

Next.js 15 (App Router, TypeScript) · Tailwind CSS · Supabase (Postgres + Auth) ·
Anthropic Claude / OpenAI / Gemini / Groq · docx / unpdf / mammoth · déployé sur Vercel.

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
   (`GROQ_API_KEY` incluse si tu veux le mode gratuit en ligne).
3. **Deploy**. Chaque `git push` redéploie automatiquement.

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
│   └── parametres/         # clé API + modèle
└── api/                    # generate, profil/extraire, téléchargements .docx
lib/                        # anthropic, crypto, docx, ingestion, cvparse, supabase, data
supabase/schema.sql         # à exécuter dans Supabase (idempotent)
```

## Sécurité

- Secrets (`.env*`) et données personnelles (`profil/profil.json`) sont **hors git**.
  `profil/profil.example.json` fournit la structure avec des données fictives.
- Les clés API sont chiffrées au repos et déchiffrées uniquement côté serveur, à l'appel.

## Commandes

```bash
npm run dev         # développement
npm run build       # build production   ( pas en même temps que `dev`)
npm run typecheck   # vérification TypeScript
```
