"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { encrypt } from "@/lib/crypto";
import { PROVIDERS, isProvider, type Provider } from "@/lib/providers";
import { KEY_COLUMNS } from "@/lib/keys";
import { genererJeton, hashJeton } from "@/lib/mcp/token";

export async function saveSettings(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Non authentifié." };

  const providerRaw = String(formData.get("provider") ?? "anthropic");
  const provider: Provider = isProvider(providerRaw) ? providerRaw : "anthropic";
  const apiKey = String(formData.get("apiKey") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim() || PROVIDERS[provider].defaultModel;

  const payload: Record<string, unknown> = {
    user_id: user.id,
    provider,
    model,
    updated_at: new Date().toISOString(),
  };

  // "free" n'utilise pas de clé utilisateur. Sinon, la clé n'est mise à jour que si saisie.
  if (apiKey && provider !== "free") {
    const prefix = PROVIDERS[provider].keyPrefix;
    if (prefix && !apiKey.startsWith(prefix)) {
      return { error: `La clé ${PROVIDERS[provider].label} doit commencer par « ${prefix} ».` };
    }
    payload[KEY_COLUMNS[provider].enc] = encrypt(apiKey);
    payload[KEY_COLUMNS[provider].last4] = apiKey.slice(-4);
  }

  const { error } = await supabase
    .from("user_settings")
    .upsert(payload, { onConflict: "user_id" });

  if (error) return { error: error.message };

  revalidatePath("/parametres");
  return { ok: true };
}

// ─── Jeton MCP (piloter CDI Finder depuis claude.ai) ────────────────────────

function messageMcp(message: string): string {
  return /mcp_token/.test(message)
    ? "Colonnes MCP absentes en base : rejoue supabase/schema.sql dans Supabase."
    : message;
}

export async function genererJetonMcp(): Promise<{ token?: string; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Non authentifié." };

  const token = genererJeton();
  const { error } = await supabase.from("user_settings").upsert(
    {
      user_id: user.id,
      mcp_token_hash: hashJeton(token),
      mcp_token_last4: token.slice(-4),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (error) return { error: messageMcp(error.message) };

  revalidatePath("/parametres");
  return { token }; // affiché une seule fois : seul le hash est stocké
}

export async function revoquerJetonMcp(): Promise<{ ok?: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Non authentifié." };

  const { error } = await supabase
    .from("user_settings")
    .update({
      mcp_token_hash: null,
      mcp_token_last4: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id);
  if (error) return { error: messageMcp(error.message) };

  revalidatePath("/parametres");
  return { ok: true };
}
