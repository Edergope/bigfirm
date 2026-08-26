import { z } from "zod";

/**
 * Identificadores del dominio. Prefijados para que un id nunca pueda usarse
 * accidentalmente en el lugar de otro (org_ vs mtr_ vs exe_).
 */
export const ID_PREFIXES = {
  organization: "org",
  user: "usr",
  matter: "mtr",
  document: "doc",
  execution: "exe",
  event: "evt",
  workPackage: "wpk",
  fact: "fct",
  authority: "aut",
  task: "tsk",
  audit: "aud",
  creditTx: "ctx",
  driveFolder: "dfd",
  template: "tpl",
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

const ID_BODY = /^[0-9a-hjkmnp-tv-z]{20,26}$/;

export function newId(kind: IdKind): string {
  // Base32 (Crockford) sobre 16 bytes aleatorios: ordenable por prefijo, url-safe,
  // sin dependencias externas y disponible en Workers.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
  let out = "";
  for (const b of bytes) out += alphabet[b % 32];
  return `${ID_PREFIXES[kind]}_${out.slice(0, 24)}`;
}

export function idSchema(kind: IdKind) {
  const prefix = `${ID_PREFIXES[kind]}_`;
  return z
    .string()
    .refine(
      (v) => v.startsWith(prefix) && ID_BODY.test(v.slice(prefix.length)),
      { message: `Se esperaba un id con prefijo "${prefix}"` },
    );
}

export const OrganizationId = idSchema("organization");
export const UserId = idSchema("user");
export const MatterId = idSchema("matter");
export const DocumentId = idSchema("document");
export const ExecutionId = idSchema("execution");
