// Jetons d'accès au serveur MCP distant.
// Le jeton n'est affiché qu'une fois : la base ne garde que son empreinte SHA-256.
import crypto from "crypto";

export const TOKEN_PREFIX = "cdi_";

export function genererJeton(): string {
  return TOKEN_PREFIX + crypto.randomBytes(32).toString("base64url");
}

export function hashJeton(token: string): string {
  return crypto.createHash("sha256").update(token.trim()).digest("hex");
}
