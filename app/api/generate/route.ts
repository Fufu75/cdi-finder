import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { genererCandidature, type CodeErreur } from "@/lib/candidatures";

export const maxDuration = 120; // secondes (Vercel)

// Code d'erreur métier → statut HTTP + drapeau attendu par le formulaire.
const HTTP: Record<CodeErreur, { status: number; flag?: string }> = {
  badInput: { status: 400 },
  needsText: { status: 422, flag: "needsText" },
  needsKey: { status: 400, flag: "needsKey" },
  needsProfil: { status: 400, flag: "needsProfil" },
  llm: { status: 502 },
  db: { status: 500 },
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const mode: string = body?.mode ?? "texte";

  if (mode === "url" && !String(body?.url ?? "").trim()) {
    return NextResponse.json({ error: "URL manquante." }, { status: 400 });
  }

  const res = await genererCandidature(supabase, user.id, {
    url: mode === "url" ? String(body?.url ?? "") : null,
    texte: mode === "url" ? null : String(body?.texte ?? ""),
    notes: body?.notes || null,
    langue: body?.langue === "en" ? "en" : "fr",
    produireCv: body?.produireCv !== false,
    produireLettre: body?.produireLettre !== false,
  });

  if (!res.ok) {
    const { status, flag } = HTTP[res.code];
    return NextResponse.json(
      { error: res.error, ...(flag ? { [flag]: true } : {}) },
      { status }
    );
  }
  return NextResponse.json({ id: res.id });
}
