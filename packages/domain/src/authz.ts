import { z } from "zod";

/**
 * Autorización jurídica de IUSIA.
 *
 * Better Auth resuelve identidad, organización, equipos y miembros.
 * IUSIA resuelve qué puede hacer una persona DENTRO de un Matter concreto.
 * Blueprint §04: el rol de firma no concede acceso automático a todos los casos.
 */

export const FIRM_ROLES = [
  "FIRM_DIRECTOR",
  "PARTNER",
  "LAWYER",
  "EXTERNAL_LAWYER",
  "ASSISTANT",
  "PARALEGAL",
  "READ_ONLY",
] as const;
export const FirmRole = z.enum(FIRM_ROLES);
export type FirmRole = z.infer<typeof FirmRole>;

export const MATTER_ROLES = [
  "OWNER",
  "COLLABORATOR",
  "REVIEWER",
  "ASSISTANT",
  "EXTERNAL",
  "READ_ONLY",
] as const;
export const MatterRole = z.enum(MATTER_ROLES);
export type MatterRole = z.infer<typeof MatterRole>;

export const MATTER_ACTIONS = [
  "matter:read",
  "matter:update",
  "matter:archive",
  "matter:manage_members",
  "document:read",
  "document:link",
  "document:unlink",
  "task:read",
  "task:write",
  "fact:read",
  "fact:write",
  "execution:read",
  "execution:start",
  "execution:cancel",
  "gate:approve",
  "deliverable:read",
  "deliverable:publish",
] as const;
export const MatterAction = z.enum(MATTER_ACTIONS);
export type MatterAction = z.infer<typeof MatterAction>;

const READ_ONLY_ACTIONS: MatterAction[] = [
  "matter:read",
  "document:read",
  "task:read",
  "fact:read",
  "execution:read",
  "deliverable:read",
];

/**
 * Matriz explícita rol-de-matter -> acciones. Determinista y del lado del servidor:
 * ningún LLM participa en el cálculo de permisos (Blueprint §01, regla no negociable).
 */
const MATTER_ROLE_ACTIONS: Record<MatterRole, readonly MatterAction[]> = {
  OWNER: MATTER_ACTIONS,
  COLLABORATOR: [
    ...READ_ONLY_ACTIONS,
    "matter:update",
    "document:link",
    "task:write",
    "fact:write",
    "execution:start",
    "execution:cancel",
  ],
  REVIEWER: [...READ_ONLY_ACTIONS, "gate:approve", "deliverable:publish"],
  ASSISTANT: [
    ...READ_ONLY_ACTIONS,
    "document:link",
    "task:write",
    "fact:write",
  ],
  // El externo NO ve tareas internas ni ejecuciones de IA de la firma.
  EXTERNAL: ["matter:read", "document:read", "deliverable:read"],
  READ_ONLY: READ_ONLY_ACTIONS,
};

/** Rol de firma que puede supervisar toda la cartera. La supervisión se audita. */
export const PORTFOLIO_SUPERVISOR_ROLES: readonly FirmRole[] = ["FIRM_DIRECTOR"];

export interface MatterAccessContext {
  /** Rol del usuario en la organización (Better Auth). */
  firmRole: FirmRole;
  /** Rol del usuario en ESTE matter, o null si no es miembro. */
  matterRole: MatterRole | null;
  /** El matter y el usuario pertenecen a la misma organización. */
  sameOrganization: boolean;
}

export interface AccessDecision {
  allowed: boolean;
  /** Motivo legible; se persiste en audit_events cuando la acción es sensible. */
  reason: string;
  /** True cuando el acceso proviene de supervisión de dirección, no de membresía. */
  viaSupervision: boolean;
}

/**
 * Única función autoritativa de autorización por Matter.
 * Todo endpoint que toque un matter debe pasar por aquí.
 */
export function decideMatterAccess(
  ctx: MatterAccessContext,
  action: MatterAction,
): AccessDecision {
  if (!ctx.sameOrganization) {
    return {
      allowed: false,
      reason: "cross_tenant_denied",
      viaSupervision: false,
    };
  }

  if (ctx.matterRole) {
    const allowed = MATTER_ROLE_ACTIONS[ctx.matterRole].includes(action);
    return {
      allowed,
      reason: allowed
        ? `matter_role:${ctx.matterRole}`
        : `matter_role_insufficient:${ctx.matterRole}`,
      viaSupervision: false,
    };
  }

  // Sin membresía en el matter: sólo la dirección puede supervisar, y sólo en lectura.
  if (
    PORTFOLIO_SUPERVISOR_ROLES.includes(ctx.firmRole) &&
    READ_ONLY_ACTIONS.includes(action)
  ) {
    return {
      allowed: true,
      reason: `portfolio_supervision:${ctx.firmRole}`,
      viaSupervision: true,
    };
  }

  return { allowed: false, reason: "not_a_matter_member", viaSupervision: false };
}

export function matterActionsFor(role: MatterRole): readonly MatterAction[] {
  return MATTER_ROLE_ACTIONS[role];
}
