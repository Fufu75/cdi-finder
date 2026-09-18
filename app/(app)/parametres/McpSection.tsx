"use client";

import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  KeyRound,
  Loader2,
  Plug,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { genererJetonMcp, revoquerJetonMcp } from "./actions";

export default function McpSection({
  actif,
  last4,
  mcpUrl,
}: {
  actif: boolean;
  last4: string | null;
  mcpUrl: string;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState<"gen" | "rev" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copie, setCopie] = useState<string | null>(null);

  async function generer() {
    setBusy("gen");
    setError(null);
    const res = await genererJetonMcp();
    setBusy(null);
    if (res.error) setError(res.error);
    else setToken(res.token ?? null);
  }

  async function revoquer() {
    if (!confirm("Révoquer le jeton ? Les connexions Claude existantes cesseront de fonctionner.")) return;
    setBusy("rev");
    setError(null);
    const res = await revoquerJetonMcp();
    setBusy(null);
    if (res.error) setError(res.error);
    else setToken(null);
  }

  async function copier(valeur: string, quoi: string) {
    await navigator.clipboard.writeText(valeur);
    setCopie(quoi);
    setTimeout(() => setCopie(null), 1500);
  }

  return (
    <section className="max-w-xl space-y-4 border-t border-stone-200 pt-8">
      <div>
        <p className="section-title">
          <span className="section-icon">
            <Plug size={15} />
          </span>
          Piloter CDI Finder depuis Claude (MCP)
        </p>
        <p className="text-sm text-stone-600">
          Connecte ton compte à Claude pour créer une candidature, consulter tes documents
          et suivre tes statuts en conversation. Dans Claude : <em>Paramètres →
          Connecteurs → Ajouter un connecteur personnalisé</em>.
        </p>
      </div>

      <div>
        <p className="label">URL du serveur</p>
        <div className="flex gap-2">
          <input readOnly value={mcpUrl} className="field font-mono text-xs" />
          <button type="button" onClick={() => copier(mcpUrl, "url")} className="btn-secondary shrink-0">
            {copie === "url" ? <CheckCircle2 size={15} /> : <Copy size={15} />}
          </button>
        </div>
      </div>

      {token ? (
        <div className="space-y-2">
          <div className="alert-success">
            <ShieldCheck size={17} className="mt-0.5 shrink-0" />
            <p>
              Jeton créé. <strong className="font-semibold">Copie-le maintenant</strong> : il
              ne sera plus jamais affiché (seule son empreinte est stockée).
            </p>
          </div>
          <div className="flex gap-2">
            <input readOnly value={token} className="field font-mono text-xs" />
            <button
              type="button"
              onClick={() => copier(token, "token")}
              className="btn-primary shrink-0"
            >
              {copie === "token" ? <CheckCircle2 size={15} /> : <Copy size={15} />}
            </button>
          </div>
          <p className="hint">
            Dans Claude, colle-le comme en-tête <code>Authorization: Bearer {"<jeton>"}</code>.
          </p>
        </div>
      ) : (
        actif && (
          <p className="inline-flex items-center gap-1.5 text-sm text-brand-700">
            <CheckCircle2 size={15} />
            Jeton actif (…{last4}). Régénère-le si tu l&apos;as perdu.
          </p>
        )
      )}

      {error && (
        <div className="alert-error">
          <AlertCircle size={17} className="mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={generer} disabled={busy !== null} className="btn-secondary">
          {busy === "gen" ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />}
          {actif || token ? "Régénérer le jeton" : "Générer un jeton"}
        </button>
        {(actif || token) && (
          <button type="button" onClick={revoquer} disabled={busy !== null} className="btn-danger">
            {busy === "rev" ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
            Révoquer
          </button>
        )}
      </div>

      <p className="hint">
        En local (Claude Code / Claude Desktop), aucun jeton n&apos;est nécessaire :
        <code> npm run mcp</code> — voir le README.
      </p>
    </section>
  );
}
