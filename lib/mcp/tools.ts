// Outils MCP de CDI Finder — cœur partagé par les deux transports :
//   • mcp/stdio.ts        → serveur local (Claude Code / Claude Desktop)
//   • app/api/mcp/route.ts → endpoint HTTP distant (claude.ai)
// Aucune dépendance à Next. Toutes les requêtes filtrent sur user_id : le code
// reste correct avec un client service_role (qui, lui, ignore la RLS).
import type { SupabaseClient } from "@supabase/supabase-js";
import { genererCandidature, getProfilFor } from "../candidatures";
import { buildCvDocx, buildLettreDocx } from "../docx";
import { slug } from "../slug";
import type { Candidature, Profil, Statut } from "../types";

export interface McpContext {
  supabase: SupabaseClient;
  userId: string;
  /** URL publique de l'app, pour proposer des liens (transport HTTP). */
  baseUrl?: string | null;
  /** Dossier d'export des .docx — actif uniquement en local (stdio). */
  exportDir?: string | null;
}

export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (ctx: McpContext, args: Record<string, any>) => Promise<string>;
}

const STATUTS: Statut[] = ["brouillon", "envoyee", "entretien", "refus", "offre"];

const LIBELLE_STATUT: Record<Statut, string> = {
  brouillon: "Brouillon",
  envoyee: "Envoyée",
  entretien: "Entretien",
  refus: "Refus",
  offre: "Offre",
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function obj(properties: Record<string, unknown>, required: string[] = []) {
  return { type: "object", properties, required, additionalProperties: false };
}

const S = (description: string) => ({ type: "string", description });
const B = (description: string) => ({ type: "boolean", description });

function date(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function ligneCandidature(c: Candidature): string {
  const bits = [c.poste || "Poste inconnu", c.entreprise || "Entreprise inconnue"];
  if (c.lieu) bits.push(c.lieu);
  return `• ${bits.join(" — ")} · ${LIBELLE_STATUT[c.statut] ?? c.statut} · ${date(
    c.created_at
  )}\n  id: ${c.id}`;
}

async function chargerCandidature(
  ctx: McpContext,
  id: string
): Promise<Candidature> {
  const { data, error } = await ctx.supabase
    .from("candidatures")
    .select("*")
    .eq("user_id", ctx.userId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Aucune candidature avec l'id ${id}.`);
  return data as Candidature;
}

function liens(ctx: McpContext, id: string, cand: Candidature): string {
  if (!ctx.baseUrl) return "";
  const base = ctx.baseUrl.replace(/\/$/, "");
  const l = [`Fiche : ${base}/candidatures/${id}`];
  if (cand.cv_data) l.push(`CV .docx : ${base}/api/candidatures/${id}/cv`);
  if (cand.lettre) l.push(`Lettre .docx : ${base}/api/candidatures/${id}/lettre`);
  return `\n\n${l.join("\n")}\n(liens à ouvrir dans le navigateur où tu es connecté)`;
}

// ─── Outils ─────────────────────────────────────────────────────────────────

const listerCandidatures: McpTool = {
  name: "lister_candidatures",
  title: "Lister les candidatures",
  description:
    "Liste les candidatures enregistrées, de la plus récente à la plus ancienne. " +
    "Renvoie l'id de chaque candidature, à réutiliser avec les autres outils.",
  inputSchema: obj({
    statut: {
      type: "string",
      enum: STATUTS,
      description: "Ne garder qu'un statut.",
    },
    recherche: S("Filtre sur le poste ou l'entreprise."),
    limite: {
      type: "integer",
      minimum: 1,
      maximum: 100,
      description: "Nombre maximum de résultats (défaut 20).",
    },
  }),
  async run(ctx, args) {
    let q = ctx.supabase
      .from("candidatures")
      .select("*")
      .eq("user_id", ctx.userId)
      .order("created_at", { ascending: false })
      .limit(Math.min(Number(args.limite) || 20, 100));

    if (args.statut) q = q.eq("statut", args.statut);
    if (args.recherche) {
      const t = String(args.recherche).replace(/[%,]/g, " ");
      q = q.or(`poste.ilike.%${t}%,entreprise.ilike.%${t}%`);
    }

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as Candidature[];
    if (!rows.length) return "Aucune candidature ne correspond.";
    return `${rows.length} candidature(s) :\n\n${rows.map(ligneCandidature).join("\n")}`;
  },
};

const voirCandidature: McpTool = {
  name: "voir_candidature",
  title: "Voir une candidature",
  description:
    "Détail d'une candidature : offre analysée, CV adapté et lettre de motivation générés.",
  inputSchema: obj(
    {
      id: S("Identifiant de la candidature (voir lister_candidatures)."),
      inclure_cv: B("Inclure le CV adapté (défaut : oui)."),
      inclure_lettre: B("Inclure la lettre de motivation (défaut : oui)."),
      inclure_offre: B("Inclure le texte brut de l'offre (défaut : non)."),
    },
    ["id"]
  ),
  async run(ctx, args) {
    const c = await chargerCandidature(ctx, String(args.id));
    const parts = [
      `# ${c.poste ?? "Poste inconnu"} — ${c.entreprise ?? "Entreprise inconnue"}`,
      [
        `Statut : ${LIBELLE_STATUT[c.statut] ?? c.statut}`,
        `Lieu : ${c.lieu ?? "—"}`,
        `Contrat : ${c.type_contrat ?? "—"}`,
        `Langue : ${c.langue ?? "fr"}`,
        `Créée le : ${date(c.created_at)}`,
        c.lien_offre ? `Offre : ${c.lien_offre}` : null,
        c.notes ? `Notes : ${c.notes}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    ];

    if (c.offre_analysee) {
      parts.push(`## Offre analysée\n${JSON.stringify(c.offre_analysee, null, 2)}`);
    }
    if (args.inclure_cv !== false) {
      parts.push(
        c.cv_data
          ? `## CV adapté\n${JSON.stringify(c.cv_data, null, 2)}`
          : "## CV adapté\n(aucun CV généré pour cette candidature)"
      );
    }
    if (args.inclure_lettre !== false) {
      parts.push(
        c.lettre
          ? `## Lettre de motivation\n${c.lettre}`
          : "## Lettre de motivation\n(aucune lettre générée)"
      );
    }
    if (args.inclure_offre === true && c.offre_texte) {
      parts.push(`## Texte de l'offre\n${c.offre_texte}`);
    }

    return parts.join("\n\n") + liens(ctx, c.id, c);
  },
};

const creerCandidature: McpTool = {
  name: "creer_candidature",
  title: "Créer une candidature",
  description:
    "Analyse une offre d'emploi (texte collé ou URL), génère un CV adapté ATS et une " +
    "lettre de motivation à partir du profil de l'utilisateur, puis enregistre le tout. " +
    "Le CV n'invente jamais d'expérience : il sélectionne et reformule le profil réel. " +
    "Utilise le fournisseur d'IA et le modèle configurés dans les paramètres du compte. " +
    "Peut prendre une minute. Ne candidate pas à la place de l'utilisateur.",
  inputSchema: obj({
    texte: S("Texte complet de l'offre d'emploi (à privilégier)."),
    url: S(
      "URL de l'offre. LinkedIn et Indeed bloquent souvent la lecture : dans ce cas, redemander le texte."
    ),
    langue: {
      type: "string",
      enum: ["fr", "en"],
      description: "Langue des documents générés (défaut fr).",
    },
    notes: S("Note personnelle à joindre à la candidature."),
    cv: B("Générer le CV (défaut : oui)."),
    lettre: B("Générer la lettre de motivation (défaut : oui)."),
  }),
  async run(ctx, args) {
    if (!args.texte && !args.url) {
      throw new Error("Fournis le texte de l'offre (`texte`) ou son adresse (`url`).");
    }
    const res = await genererCandidature(ctx.supabase, ctx.userId, {
      texte: args.texte ?? null,
      url: args.url ?? null,
      notes: args.notes ?? null,
      langue: args.langue === "en" ? "en" : "fr",
      produireCv: args.cv !== false,
      produireLettre: args.lettre !== false,
    });

    if (!res.ok) throw new Error(res.error);

    const docs = [res.cv ? "CV" : null, res.lettre ? "lettre" : null]
      .filter(Boolean)
      .join(" + ");
    const cand = await chargerCandidature(ctx, res.id);
    return (
      `Candidature créée : ${res.poste ?? "poste inconnu"} — ${
        res.entreprise ?? "entreprise inconnue"
      }\n${docs} généré(s). Statut : brouillon.\nid: ${res.id}` + liens(ctx, res.id, cand)
    );
  },
};

const changerStatut: McpTool = {
  name: "changer_statut",
  title: "Changer le statut",
  description:
    "Met à jour le suivi d'une candidature : brouillon, envoyee, entretien, refus, offre.",
  inputSchema: obj(
    {
      id: S("Identifiant de la candidature."),
      statut: { type: "string", enum: STATUTS, description: "Nouveau statut." },
    },
    ["id", "statut"]
  ),
  async run(ctx, args) {
    const statut = String(args.statut) as Statut;
    if (!STATUTS.includes(statut)) {
      throw new Error(`Statut invalide. Valeurs possibles : ${STATUTS.join(", ")}.`);
    }
    await chargerCandidature(ctx, String(args.id)); // vérifie l'appartenance
    const { error } = await ctx.supabase
      .from("candidatures")
      .update({ statut, updated_at: new Date().toISOString() })
      .eq("user_id", ctx.userId)
      .eq("id", String(args.id));
    if (error) throw new Error(error.message);
    return `Statut mis à jour : ${LIBELLE_STATUT[statut]}.`;
  },
};

const annoterCandidature: McpTool = {
  name: "annoter_candidature",
  title: "Modifier les notes",
  description: "Remplace la note personnelle attachée à une candidature.",
  inputSchema: obj(
    {
      id: S("Identifiant de la candidature."),
      notes: S("Nouveau contenu de la note (chaîne vide pour l'effacer)."),
    },
    ["id", "notes"]
  ),
  async run(ctx, args) {
    await chargerCandidature(ctx, String(args.id));
    const { error } = await ctx.supabase
      .from("candidatures")
      .update({ notes: String(args.notes) || null, updated_at: new Date().toISOString() })
      .eq("user_id", ctx.userId)
      .eq("id", String(args.id));
    if (error) throw new Error(error.message);
    return "Note enregistrée.";
  },
};

const supprimerCandidature: McpTool = {
  name: "supprimer_candidature",
  title: "Supprimer une candidature",
  description:
    "Supprime définitivement une candidature et ses documents. Demander confirmation " +
    "à l'utilisateur avant d'appeler cet outil.",
  inputSchema: obj(
    {
      id: S("Identifiant de la candidature."),
      confirmer: B("Doit valoir true : confirme la suppression définitive."),
    },
    ["id", "confirmer"]
  ),
  async run(ctx, args) {
    if (args.confirmer !== true) {
      throw new Error(
        "Suppression annulée : demande confirmation à l'utilisateur, puis rappelle l'outil avec confirmer=true."
      );
    }
    const c = await chargerCandidature(ctx, String(args.id));
    const { error } = await ctx.supabase
      .from("candidatures")
      .delete()
      .eq("user_id", ctx.userId)
      .eq("id", c.id);
    if (error) throw new Error(error.message);
    return `Candidature supprimée : ${c.poste ?? "?"} — ${c.entreprise ?? "?"}.`;
  },
};

const voirProfil: McpTool = {
  name: "voir_profil",
  title: "Voir le profil",
  description:
    "Renvoie le profil du candidat (expériences, formations, projets, compétences) " +
    "tel qu'il est utilisé pour générer les CV.",
  inputSchema: obj({}),
  async run(ctx) {
    const profil = await getProfilFor(ctx.supabase, ctx.userId);
    if (!profil || Object.keys(profil).length === 0) {
      return "Le profil est vide. Remplis-le dans « Mon profil » ou via mettre_a_jour_profil.";
    }
    return JSON.stringify(profil, null, 2);
  },
};

const mettreAJourProfil: McpTool = {
  name: "mettre_a_jour_profil",
  title: "Mettre à jour le profil",
  description:
    "Modifie le profil du candidat. Par défaut, fusionne les clés fournies avec " +
    "l'existant (les autres sections sont conservées). N'ajoute jamais d'expérience " +
    "que l'utilisateur n'a pas réellement eue.",
  inputSchema: obj(
    {
      data: {
        type: "object",
        description:
          "Sections à écrire : identite, formations, experiences, projets, competences, langues, interets.",
        additionalProperties: true,
      },
      remplacer: B(
        "true = remplace tout le profil par `data`. Défaut false (fusion des clés fournies)."
      ),
    },
    ["data"]
  ),
  async run(ctx, args) {
    if (!args.data || typeof args.data !== "object" || Array.isArray(args.data)) {
      throw new Error("`data` doit être un objet JSON.");
    }
    const actuel = await getProfilFor(ctx.supabase, ctx.userId);
    const nouveau: Profil =
      args.remplacer === true ? (args.data as Profil) : { ...actuel, ...args.data };

    const { error } = await ctx.supabase
      .from("profiles")
      .upsert(
        { user_id: ctx.userId, data: nouveau, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );
    if (error) throw new Error(error.message);

    const cles = Object.keys(args.data).join(", ");
    return `Profil mis à jour (${args.remplacer === true ? "remplacé" : `sections : ${cles}`}).`;
  },
};

const statistiques: McpTool = {
  name: "statistiques",
  title: "Statistiques de recherche",
  description:
    "Répartition des candidatures par statut, et activité récente — l'équivalent du tableau de bord.",
  inputSchema: obj({}),
  async run(ctx) {
    const { data, error } = await ctx.supabase
      .from("candidatures")
      .select("statut, entreprise, created_at")
      .eq("user_id", ctx.userId);
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as { statut: Statut; created_at: string }[];
    if (!rows.length) return "Aucune candidature enregistrée pour l'instant.";

    const compte = new Map<string, number>();
    for (const r of rows) compte.set(r.statut, (compte.get(r.statut) ?? 0) + 1);

    const depuis = Date.now() - 30 * 24 * 3600 * 1000;
    const recentes = rows.filter((r) => new Date(r.created_at).getTime() >= depuis).length;

    const lignes = STATUTS.filter((s) => compte.get(s)).map(
      (s) => `• ${LIBELLE_STATUT[s]} : ${compte.get(s)}`
    );
    return `${rows.length} candidature(s) au total.\n${lignes.join(
      "\n"
    )}\n\n${recentes} créée(s) ces 30 derniers jours.`;
  },
};

// Export .docx — uniquement en local (stdio) : le serveur distant ne peut pas
// écrire sur la machine de l'utilisateur, il renvoie des liens de téléchargement.
const exporterDocuments: McpTool = {
  name: "exporter_documents",
  title: "Exporter le CV et la lettre en .docx",
  description:
    "Écrit le CV et/ou la lettre d'une candidature en fichiers .docx compatibles ATS " +
    "sur le disque, et renvoie leurs chemins.",
  inputSchema: obj(
    {
      id: S("Identifiant de la candidature."),
      dossier: S("Dossier de destination (défaut : le dossier `sorties/` du projet)."),
      cv: B("Exporter le CV (défaut : oui, s'il existe)."),
      lettre: B("Exporter la lettre (défaut : oui, si elle existe)."),
    },
    ["id"]
  ),
  async run(ctx, args) {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const path = await import("node:path");

    const c = await chargerCandidature(ctx, String(args.id));
    const profil = await getProfilFor(ctx.supabase, ctx.userId);
    const identite = profil.identite ?? {};
    const langue = c.langue === "en" ? "en" : "fr";
    const nom = `${slug(c.poste, "poste")}_${slug(c.entreprise, "entreprise")}`;

    const dossier = String(args.dossier || ctx.exportDir || "sorties");
    await mkdir(dossier, { recursive: true });

    const ecrits: string[] = [];
    if (args.cv !== false && c.cv_data) {
      const buf = await buildCvDocx(c.cv_data, identite, langue);
      const f = path.resolve(dossier, `CV_${nom}.docx`);
      await writeFile(f, buf);
      ecrits.push(f);
    }
    if (args.lettre !== false && c.lettre) {
      const buf = await buildLettreDocx(c.lettre, identite, c.offre_analysee, langue);
      const f = path.resolve(dossier, `Lettre_${nom}.docx`);
      await writeFile(f, buf);
      ecrits.push(f);
    }

    if (!ecrits.length) return "Rien à exporter : cette candidature n'a ni CV ni lettre.";
    return `Fichier(s) écrit(s) :\n${ecrits.map((f) => `• ${f}`).join("\n")}`;
  },
};

const TOUS: McpTool[] = [
  listerCandidatures,
  voirCandidature,
  creerCandidature,
  changerStatut,
  annoterCandidature,
  supprimerCandidature,
  voirProfil,
  mettreAJourProfil,
  statistiques,
  exporterDocuments,
];

/** Outils disponibles pour ce contexte (l'export .docx n'existe qu'en local). */
export function listTools(ctx: McpContext): McpTool[] {
  return TOUS.filter((t) => t !== exporterDocuments || !!ctx.exportDir);
}

/** Description des outils au format MCP (`tools/list`). */
export function toolDefinitions(ctx: McpContext) {
  return listTools(ctx).map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  /** Signature ouverte : le SDK MCP attend un objet de résultat extensible. */
  [k: string]: unknown;
}

/** Exécute un outil et emballe le résultat au format MCP. */
export async function callTool(
  ctx: McpContext,
  name: string,
  args: Record<string, any> | undefined
): Promise<ToolResult> {
  const tool = listTools(ctx).find((t) => t.name === name);
  if (!tool) {
    return { content: [{ type: "text", text: `Outil inconnu : ${name}` }], isError: true };
  }
  try {
    const text = await tool.run(ctx, args ?? {});
    return { content: [{ type: "text", text }] };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { content: [{ type: "text", text: `Erreur : ${msg}` }], isError: true };
  }
}
