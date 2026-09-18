// Colonnes de stockage des clés API (chiffrées) et résolution du fournisseur actif.
// Aucune dépendance à Next : utilisable depuis l'app comme depuis le serveur MCP.
import { decrypt } from "./crypto";
import { PROVIDERS, isProvider, type Provider } from "./providers";

export const KEY_COLUMNS: Record<
  Exclude<Provider, "free">,
  { enc: string; last4: string }
> = {
  anthropic: { enc: "anthropic_key_encrypted", last4: "key_last4" },
  openai: { enc: "openai_key_encrypted", last4: "openai_key_last4" },
  gemini: { enc: "gemini_key_encrypted", last4: "gemini_key_last4" },
};

// Colonnes minimales à lire pour pouvoir appeler un modèle.
export const CREDS_SELECT =
  "provider, model, anthropic_key_encrypted, openai_key_encrypted, gemini_key_encrypted";

export interface Creds {
  provider: Provider;
  key: string;
  model: string;
}

// Ligne `user_settings` → identifiants en clair. Usage serveur uniquement, à l'appel.
export function credsFromRow(row: Record<string, string | null> | null): Creds | null {
  if (!row) return null;

  const provider: Provider = isProvider(row.provider) ? row.provider : "free";
  const model = row.model || PROVIDERS[provider].defaultModel;

  // "free" : clé Groq partagée, côté serveur (jamais celle de l'utilisateur).
  if (provider === "free") {
    const key = process.env.GROQ_API_KEY;
    return key ? { provider, key, model } : null;
  }

  const enc = row[KEY_COLUMNS[provider].enc];
  if (!enc) return null;

  return { provider, key: decrypt(enc), model };
}
