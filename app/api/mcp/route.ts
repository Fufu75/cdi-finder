// Endpoint MCP distant (transport « Streamable HTTP », sans état).
// Permet de piloter CDI Finder depuis claude.ai / Claude mobile.
// Authentification : en-tête `Authorization: Bearer <jeton>` généré dans Paramètres.
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashJeton } from "@/lib/mcp/token";
import { callTool, toolDefinitions, type McpContext } from "@/lib/mcp/tools";

export const maxDuration = 120; // secondes (Vercel) — la génération est longue
export const dynamic = "force-dynamic";

const SERVER_INFO = { name: "cdi-finder", title: "CDI Finder", version: "1.0.0" };
const PROTOCOLES = ["2024-11-05", "2025-03-26", "2025-06-18"];
const PROTOCOLE_DEFAUT = "2025-06-18";

const INSTRUCTIONS =
  "CDI Finder aide à postuler : il analyse une offre d'emploi, génère un CV adapté ATS " +
  "et une lettre de motivation à partir du profil réel de l'utilisateur, et suit les " +
  "candidatures. Ne jamais inventer d'expérience professionnelle. L'outil produit les " +
  "documents ; c'est l'utilisateur qui envoie ses candidatures.";

type JsonRpcId = string | number | null;

function resultat(id: JsonRpcId, result: unknown) {
  return NextResponse.json({ jsonrpc: "2.0", id, result });
}

function erreur(id: JsonRpcId, code: number, message: string, status = 200) {
  return NextResponse.json({ jsonrpc: "2.0", id, error: { code, message } }, { status });
}

function nonAutorise(message: string) {
  return NextResponse.json(
    { error: message },
    {
      status: 401,
      headers: { "WWW-Authenticate": 'Bearer realm="cdi-finder"' },
    }
  );
}

// Jeton → utilisateur. Le client service_role ignore la RLS : les outils
// filtrent eux-mêmes chaque requête sur ce user_id.
async function authentifier(request: Request): Promise<McpContext | null> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("user_settings")
    .select("user_id")
    .eq("mcp_token_hash", hashJeton(match[1]))
    .maybeSingle();
  if (!data?.user_id) return null;

  const origine = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  return { supabase, userId: data.user_id as string, baseUrl: origine };
}

export async function POST(request: Request) {
  const ctx = await authentifier(request);
  if (!ctx) {
    return nonAutorise(
      "Jeton MCP absent ou invalide. Génère-le dans CDI Finder → Paramètres."
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return erreur(null, -32600, "Requête JSON-RPC invalide.", 400);
  }

  const { method, params, id } = body as {
    method?: string;
    params?: Record<string, any>;
    id?: JsonRpcId;
  };
  const rpcId: JsonRpcId = id ?? null;

  // Notification (pas d'id) : rien à renvoyer.
  if (id === undefined || id === null) {
    return new Response(null, { status: 202 });
  }

  switch (method) {
    case "initialize": {
      const demande = params?.protocolVersion;
      return resultat(rpcId, {
        protocolVersion: PROTOCOLES.includes(demande) ? demande : PROTOCOLE_DEFAUT,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }

    case "ping":
      return resultat(rpcId, {});

    case "tools/list":
      return resultat(rpcId, { tools: toolDefinitions(ctx) });

    case "tools/call": {
      const nom = params?.name;
      if (typeof nom !== "string") {
        return erreur(rpcId, -32602, "Paramètre `name` manquant.");
      }
      return resultat(rpcId, await callTool(ctx, nom, params?.arguments));
    }

    // Déclarés vides : certains clients les interrogent malgré nos capacités.
    case "resources/list":
      return resultat(rpcId, { resources: [] });
    case "prompts/list":
      return resultat(rpcId, { prompts: [] });

    default:
      return erreur(rpcId, -32601, `Méthode inconnue : ${method}`);
  }
}

// Pas de canal SSE serveur→client : ce serveur est sans état.
export async function GET() {
  return new NextResponse("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
}
