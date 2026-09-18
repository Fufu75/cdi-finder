-- ============================================================================
-- CDI Finder — Schéma Supabase
-- À exécuter dans : Supabase → SQL Editor → New query → Run
-- ============================================================================

-- ─── 1. Profil du candidat (données CV réelles) ────────────────────────────
create table if not exists public.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ─── 2. Paramètres utilisateur (clé API Anthropic, chiffrée) ───────────────
create table if not exists public.user_settings (
  user_id                 uuid primary key references auth.users (id) on delete cascade,
  provider                text not null default 'free',        -- free | anthropic | openai | gemini
  anthropic_key_encrypted text,          -- chiffrée côté serveur (AES-256-GCM), jamais en clair
  key_last4               text,          -- 4 derniers caractères (Anthropic) pour affichage
  openai_key_encrypted    text,
  openai_key_last4        text,
  gemini_key_encrypted    text,
  gemini_key_last4        text,
  model                   text not null default '',
  updated_at              timestamptz not null default now()
);

-- Mise à jour d'une base déjà créée (idempotent) : multi-fournisseurs + accès gratuit.
alter table public.user_settings add column if not exists provider text not null default 'free';
alter table public.user_settings add column if not exists openai_key_encrypted text;
alter table public.user_settings add column if not exists openai_key_last4 text;
alter table public.user_settings add column if not exists gemini_key_encrypted text;
alter table public.user_settings add column if not exists gemini_key_last4 text;
alter table public.user_settings alter column provider set default 'free';   -- nouveaux comptes = gratuit
alter table public.user_settings alter column model set default '';          -- modèle par défaut du fournisseur

-- Jeton d'accès MCP distant (claude.ai) : on ne stocke que le SHA-256 du jeton.
alter table public.user_settings add column if not exists mcp_token_hash text;
alter table public.user_settings add column if not exists mcp_token_last4 text;
create unique index if not exists user_settings_mcp_token_hash_idx
  on public.user_settings (mcp_token_hash) where mcp_token_hash is not null;

-- ─── 3. Candidatures (offre + documents générés) ───────────────────────────
create table if not exists public.candidatures (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  poste           text,
  entreprise      text,
  lieu            text,
  type_contrat    text,
  lien_offre      text,
  notes           text,
  langue          text not null default 'fr',           -- fr | en
  statut          text not null default 'brouillon',   -- brouillon | envoyee | entretien | refus | offre
  offre_texte     text,                                  -- texte brut de l'offre
  offre_analysee  jsonb,                                 -- JSON structuré (analyse LLM)
  cv_data         jsonb,                                 -- CV adapté (structuré)
  lettre          text,                                  -- lettre de motivation
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists candidatures_user_id_idx on public.candidatures (user_id, created_at desc);

-- Mise à jour pour une base déjà créée (idempotent) : ajoute la colonne langue si absente.
alter table public.candidatures add column if not exists langue text not null default 'fr';

-- ─── Row Level Security : chacun ne voit QUE ses propres données ────────────
alter table public.profiles      enable row level security;
alter table public.user_settings enable row level security;
alter table public.candidatures  enable row level security;

-- profiles
drop policy if exists "profiles_own" on public.profiles;
create policy "profiles_own" on public.profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- user_settings
drop policy if exists "settings_own" on public.user_settings;
create policy "settings_own" on public.user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- candidatures
drop policy if exists "candidatures_own" on public.candidatures;
create policy "candidatures_own" on public.candidatures
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─── Création automatique d'un profil vide à l'inscription ──────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (user_id, data) values (new.id, '{}'::jsonb)
    on conflict (user_id) do nothing;
  insert into public.user_settings (user_id) values (new.id)
    on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
