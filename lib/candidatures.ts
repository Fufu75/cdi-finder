// Création d'une candidature : offre → analyse → CV + lettre → ligne en base.
// Partagé entre la route HTTP de l'app (/api/generate) et le serveur MCP.
// Aucune dépendance à Next : le client Supabase et l'utilisateur sont passés en paramètres.
import type { SupabaseClient } from "@supabase/supabase-js";
import { CREDS_SELECT, credsFromRow, type Creds } from "./keys";
import { extraireTexteDepuisUrl } from "./ingestion";
import { analyserOffre, genererCv, genererLettre } from "./llm";
import type { Profil } from "./types";

// Toutes les requêtes filtrent explicitement sur user_id : le code reste correct
// même avec un client service_role (serveur MCP distant), qui ignore la RLS.

export async function getProfilFor(
  supabase: SupabaseClient,
  userId: string
): Promise<Profil> {
  const { data } = await supabase
    .from("profiles")
    .select("data")
    .eq("user_id", userId)
    .maybeSingle();
  return ((data?.data as Profil) ?? {}) as Profil;
}

export async function getCredsFor(
  supabase: SupabaseClient,
  userId: string
): Promise<Creds | null> {
  const { data } = await supabase
    .from("user_settings")
    .select(CREDS_SELECT)
    .eq("user_id", userId)
    .maybeSingle();
  return credsFromRow((data ?? null) as Record<string, string | null> | null);
}

export type CodeErreur =
  | "badInput"
  | "needsText"
  | "needsKey"
  | "needsProfil"
  | "llm"
  | "db";

export interface GenerationInput {
  url?: string | null;
  texte?: string | null;
  notes?: string | null;
  langue?: "fr" | "en";
  produireCv?: boolean;
  produireLettre?: boolean;
}

export type GenerationResultat =
  | {
      ok: true;
      id: string;
      poste: string | null;
      entreprise: string | null;
      cv: boolean;
      lettre: boolean;
    }
  | { ok: false; code: CodeErreur; error: string };

export async function genererCandidature(
  supabase: SupabaseClient,
  userId: string,
  input: GenerationInput
): Promise<GenerationResultat> {
  const langue: "fr" | "en" = input.langue === "en" ? "en" : "fr";
  const produireCv = input.produireCv !== false;
  const produireLettre = input.produireLettre !== false;
  if (!produireCv && !produireLettre) {
    return {
      ok: false,
      code: "badInput",
      error: "Choisis au moins un document à générer.",
    };
  }

  // 1. Texte de l'offre : URL à lire, ou texte fourni.
  let texteOffre: string;
  let lienOffre: string | null = null;
  const url = (input.url ?? "").trim();
  const texte = (input.texte ?? "").trim();

  if (url && !texte) {
    lienOffre = url;
    const extrait = await extraireTexteDepuisUrl(url);
    if (!extrait) {
      return {
        ok: false,
        code: "needsText",
        error:
          "Impossible de lire cette URL (LinkedIn/Indeed bloquent souvent). Colle le texte de l'offre à la main.",
      };
    }
    texteOffre = extrait;
  } else {
    if (texte.length < 50) {
      return {
        ok: false,
        code: "badInput",
        error: "Le texte de l'offre est trop court.",
      };
    }
    texteOffre = texte;
    lienOffre = url || null;
  }

  // 2. Clé API + profil.
  const creds = await getCredsFor(supabase, userId);
  if (!creds) {
    return {
      ok: false,
      code: "needsKey",
      error: "Aucune clé API. Ajoute-la dans Paramètres.",
    };
  }
  const profil = await getProfilFor(supabase, userId);
  if (!profil || Object.keys(profil).length === 0) {
    return {
      ok: false,
      code: "needsProfil",
      error: "Ton profil est vide. Remplis-le dans Mon profil.",
    };
  }

  // 3. Analyse + génération.
  let offreAnalysee;
  let cvData = null;
  let lettre = null;
  try {
    offreAnalysee = await analyserOffre(creds.provider, creds.key, creds.model, texteOffre);
    [cvData, lettre] = await Promise.all([
      produireCv
        ? genererCv(creds.provider, creds.key, creds.model, profil, offreAnalysee, langue)
        : Promise.resolve(null),
      produireLettre
        ? genererLettre(creds.provider, creds.key, creds.model, profil, offreAnalysee, langue)
        : Promise.resolve(null),
    ]);
  } catch (e: unknown) {
    // Erreurs typiques : clé invalide (401), quota épuisé, modèle inconnu, etc.
    const msg = e instanceof Error ? e.message : "Erreur lors de la génération.";
    return { ok: false, code: "llm", error: `Erreur du modèle : ${msg}` };
  }

  const { data, error } = await supabase
    .from("candidatures")
    .insert({
      user_id: userId,
      poste: offreAnalysee.poste ?? null,
      entreprise: offreAnalysee.entreprise ?? null,
      lieu: offreAnalysee.lieu ?? null,
      type_contrat: offreAnalysee.type_contrat ?? null,
      lien_offre: lienOffre,
      notes: input.notes || null,
      langue,
      offre_texte: texteOffre,
      offre_analysee: offreAnalysee,
      cv_data: cvData,
      lettre,
    })
    .select("id, poste, entreprise")
    .single();

  if (error || !data) {
    return { ok: false, code: "db", error: error?.message ?? "Enregistrement impossible." };
  }

  return {
    ok: true,
    id: data.id as string,
    poste: (data.poste as string) ?? null,
    entreprise: (data.entreprise as string) ?? null,
    cv: !!cvData,
    lettre: !!lettre,
  };
}
