import { headers } from "next/headers";
import { getMcpToken, getSettings } from "@/lib/data";
import ParametresForm from "./ParametresForm";
import McpSection from "./McpSection";
import PageHeader from "@/components/PageHeader";

export const dynamic = "force-dynamic";

// URL publique de l'endpoint MCP : variable d'env si définie, sinon l'hôte courant.
async function mcpUrl(): Promise<string> {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  if (base) return `${base.replace(/\/$/, "")}/api/mcp`;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}/api/mcp`;
}

export default async function ParametresPage() {
  const [settings, mcp, url] = await Promise.all([getSettings(), getMcpToken(), mcpUrl()]);
  return (
    <div className="animate-fade-up space-y-8">
      <div>
        <PageHeader
          titre="Paramètres"
          sous_titre="Choisis ton fournisseur d'IA et le modèle qui génère tes documents."
        />
        <ParametresForm
          initialProvider={settings.provider}
          initialModel={settings.model}
          keys={settings.keys}
        />
      </div>
      <McpSection actif={mcp.actif} last4={mcp.last4} mcpUrl={url} />
    </div>
  );
}
