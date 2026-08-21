import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/organization/access";

/**
 * Roles de FIRMA sobre la organización (Better Auth).
 *
 * Alcance deliberadamente estrecho: estos roles gobiernan la administración de la
 * firma —invitar miembros, crear equipos, editar la organización—. NO conceden
 * acceso a expedientes. El acceso a cada Matter lo decide `AuthorizationService`
 * con `matter_members` (Blueprint §04: el rol de firma no concede automáticamente
 * acceso a todos los casos).
 */
export const firmAccessControl = createAccessControl(defaultStatements);

const FULL_ADMIN = {
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  team: ["create", "update", "delete"],
  ac: ["create", "read", "update", "delete"],
} as const;

const NO_ADMIN = {
  organization: [],
  member: [],
  invitation: [],
  team: [],
  ac: [],
} as const;

export const firmRoles = {
  FIRM_DIRECTOR: firmAccessControl.newRole(FULL_ADMIN),

  PARTNER: firmAccessControl.newRole({
    organization: [],
    member: ["create", "update"],
    invitation: ["create", "cancel"],
    team: ["create", "update"],
    ac: ["read"],
  }),

  LAWYER: firmAccessControl.newRole(NO_ADMIN),
  ASSISTANT: firmAccessControl.newRole(NO_ADMIN),
  PARALEGAL: firmAccessControl.newRole(NO_ADMIN),
  /** El abogado externo nunca administra nada de la firma. */
  EXTERNAL_LAWYER: firmAccessControl.newRole(NO_ADMIN),
  READ_ONLY: firmAccessControl.newRole(NO_ADMIN),
};
