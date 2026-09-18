// Helpers de lecture de données côté serveur.
import "server-only";
import { createClient } from "@/lib/supabase/server";
import { CREDS_SELECT, credsFromRow, type Creds } from "@/lib/keys";
import { PROVIDERS, isProvider, type Provider } from "@/lib/providers";
import type { Candidature, Profil } from "@/lib/types";

export async function getProfil(): Promise<Profil> {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("data").maybeSingle();
  return (data?.data as Profil) ?? {};
}

export interface Settings {
  provider: Provider;
  model: string;
  hasKey: boolean; // le fournisseur actif a-t-il une clé ?
  keys: Record<Provider, { hasKey: boolean; last4: string | null }>;
}

export async function getSettings(): Promise<Settings> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("user_settings")
    .select(
      "provider, model, anthropic_key_encrypted, key_last4, openai_key_encrypted, openai_key_last4, gemini_key_encrypted, gemini_key_last4"
    )
    .maybeSingle();

  const row = (data ?? {}) as Record<string, string | null>;
  const provider: Provider = isProvider(row.provider) ? row.provider : "free";

  // "free" : dispo si le serveur a une clé Groq partagée (pas de clé utilisateur).
  const freeAvailable = !!process.env.GROQ_API_KEY;

  const keys = {
    free: { hasKey: freeAvailable, last4: null },
    anthropic: { hasKey: !!row.anthropic_key_encrypted, last4: row.key_last4 ?? null },
    openai: { hasKey: !!row.openai_key_encrypted, last4: row.openai_key_last4 ?? null },
    gemini: { hasKey: !!row.gemini_key_encrypted, last4: row.gemini_key_last4 ?? null },
  } satisfies Settings["keys"];

  return {
    provider,
    model: row.model || PROVIDERS[provider].defaultModel,
    hasKey: keys[provider].hasKey,
    keys,
  };
}

// Renvoie la clé du fournisseur actif, en clair — usage serveur uniquement, à l'appel.
export async function getDecryptedKey(): Promise<Creds | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("user_settings")
    .select(CREDS_SELECT)
    .maybeSingle();
  return credsFromRow((data ?? null) as Record<string, string | null> | null);
}

// Jeton MCP distant. Requête isolée : si la migration n'a pas encore été jouée
// (colonnes absentes), on renvoie simplement "aucun jeton" sans casser la page.
export async function getMcpToken(): Promise<{ actif: boolean; last4: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_settings")
    .select("mcp_token_hash, mcp_token_last4")
    .maybeSingle();
  if (error || !data) return { actif: false, last4: null };
  const row = data as Record<string, string | null>;
  return { actif: !!row.mcp_token_hash, last4: row.mcp_token_last4 ?? null };
}

export async function getCandidatures(): Promise<Candidature[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("candidatures")
    .select("*")
    .order("created_at", { ascending: false });
  return (data as Candidature[]) ?? [];
}

// Compteur pour la barre latérale : `head` évite de rapatrier les lignes.
export async function getCandidaturesCount(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("candidatures")
    .select("id", { count: "exact", head: true });
  return count ?? 0;
}

export async function getCandidature(id: string): Promise<Candidature | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("candidatures")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as Candidature) ?? null;
}
