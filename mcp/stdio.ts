#!/usr/bin/env node
// Serveur MCP local de CDI Finder (transport stdio).
// Lancé par Claude Code / Claude Desktop ; se connecte à Supabase avec les
// identifiants du compte, donc la RLS s'applique normalement.
//
//   npm run mcp        (variables lues dans .env.local)
//
// Rien ne doit être écrit sur stdout à part le protocole JSON-RPC : les
// messages de diagnostic passent par stderr.
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { callTool, toolDefinitions, type McpContext } from "../lib/mcp/tools";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Variables d'environnement : .env.local du projet, quel que soit le dossier
// courant depuis lequel Claude lance le serveur.
for (const f of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(path.join(RACINE, f));
  } catch {
    // fichier absent ou illisible : on se rabat sur l'environnement du processus
  }
}

const INSTRUCTIONS =
  "CDI Finder aide à postuler : il analyse une offre d'emploi, génère un CV adapté ATS " +
  "et une lettre de motivation à partir du profil réel de l'utilisateur, et suit les " +
  "candidatures. Ne jamais inventer d'expérience professionnelle. L'outil produit les " +
  "documents ; c'est l'utilisateur qui envoie ses candidatures.";

function requis(nom: string): string {
  const v = process.env[nom];
  if (!v) {
    console.error(
      `[cdi-finder] Variable ${nom} manquante. Renseigne-la dans .env.local (voir .env.local.example).`
    );
    process.exit(1);
  }
  return v;
}

// supabase-js instancie toujours un client Realtime, qui réclame un WebSocket —
// absent de Node < 22, où `createClient` lève alors une exception. Le serveur MCP
// ne s'abonne à rien : on fournit un transport factice plutôt que d'ajouter la
// dépendance `ws` pour une fonctionnalité inutilisée.
const SANS_REALTIME = class {
  constructor() {
    throw new Error("Le serveur MCP n'utilise pas Supabase Realtime.");
  }
} as unknown as typeof WebSocket;

async function main() {
  const supabase = createClient(
    requis("NEXT_PUBLIC_SUPABASE_URL"),
    requis("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      auth: { persistSession: false, autoRefreshToken: true },
      realtime: { transport: SANS_REALTIME },
    }
  );

  const { data, error } = await supabase.auth.signInWithPassword({
    email: requis("CDI_FINDER_EMAIL"),
    password: requis("CDI_FINDER_PASSWORD"),
  });
  if (error || !data.user) {
    console.error(
      `[cdi-finder] Connexion à Supabase impossible : ${error?.message ?? "utilisateur introuvable"}`
    );
    process.exit(1);
  }

  const ctx: McpContext = {
    supabase,
    userId: data.user.id,
    baseUrl: process.env.NEXT_PUBLIC_APP_URL || null,
    exportDir: process.env.CDI_FINDER_EXPORT_DIR || path.join(RACINE, "sorties"),
  };

  const server = new Server(
    { name: "cdi-finder", title: "CDI Finder", version: "1.0.0" },
    { capabilities: { tools: { listChanged: false } }, instructions: INSTRUCTIONS }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefinitions(ctx),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) =>
    callTool(ctx, req.params.name, req.params.arguments)
  );

  await server.connect(new StdioServerTransport());
  console.error(`[cdi-finder] Serveur MCP prêt (compte ${data.user.email}).`);
}

main().catch((e) => {
  console.error(`[cdi-finder] ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
