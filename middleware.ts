import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Toutes les routes sauf fichiers statiques, images — et l'endpoint MCP,
    // qui s'authentifie par jeton Bearer et n'a donc pas de session cookie :
    // sans cette exclusion, chaque appel MCP serait redirigé vers /login.
    "/((?!_next/static|_next/image|favicon.ico|api/mcp|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
