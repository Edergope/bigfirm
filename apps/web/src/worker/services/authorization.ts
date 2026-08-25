import { and, eq } from "drizzle-orm";
import {
  IusiaError,
  decideMatterAccess,
  type AccessDecision,
  isSystemRole,
  type FirmRole,
  type MatterAction,
  type SystemRole,
} from "@iusia/domain";
import { schema, type IusiaDb, type MatterRepository, type AuditRepository } from "@iusia/db";

/**
 * AuthorizationService — la autorización jurídica de IUSIA.
 *
 * Toda validación ocurre en el servidor (Blueprint §11 regla 6). Ningún endpoint
 * que toque un Matter puede saltarse este servicio, y toda denegación —o todo
 * acceso por supervisión de dirección— queda auditado.
 */
export class AuthorizationService {
  constructor(
    private readonly db: IusiaDb,
    private readonly matters: MatterRepository,
    private readonly audit: AuditRepository,
  ) {}

  /** Rol de firma del usuario en la organización activa. */
  async firmRole(organizationId: string, userId: string): Promise<FirmRole | null> {
    const [row] = await this.db
      .select({ role: schema.member.role })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, organizationId),
          eq(schema.member.userId, userId),
        ),
      )
      .limit(1);
    return (row?.role as FirmRole | undefined) ?? null;
  }

  /**
   * Rol de SISTEMA del usuario. Autoridad global de plataforma, ajena a la firma.
   *
   * La fuente de verdad es la columna `user.system_role`, que sólo se escribe
   * server-side: Better Auth la declara con `input: false`, de modo que ni un
   * cliente ni un perfil de OAuth pueden fijarla.
   */
  async systemRole(userId: string): Promise<SystemRole | null> {
    const [row] = await this.db
      .select({ role: schema.user.systemRole })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1);
    return isSystemRole(row?.role) ? row.role : null;
  }

  async isSystemSuperadmin(userId: string): Promise<boolean> {
    return (await this.systemRole(userId)) === "SYSTEM_SUPERADMIN";
  }

  /**
   * Exige autoridad de sistema para una capacidad global (salud, integraciones,
   * configuración, diagnóstico). Fail-closed y auditado: la denegación deja rastro.
   *
   * NO concede acceso a expedientes de ninguna firma: para eso está `authorizeMatter`.
   */
  async requireSystemSuperadmin(
    userId: string,
    capability: string,
    /** Firma activa del request: sólo para atribuir el registro de auditoría. */
    organizationId: string,
  ): Promise<void> {
    if (await this.isSystemSuperadmin(userId)) return;
    await this.audit.record({
      organizationId,
      matterId: null,
      actorUserId: userId,
      action: "system.capability.denied",
      resourceType: "system",
      resourceId: capability,
      outcome: "DENIED",
      reason: "NOT_SYSTEM_SUPERADMIN",
    });
    throw new IusiaError("FORBIDDEN", "Esta operación requiere autoridad de sistema", {
      capability,
    });
  }

  /**
   * Autoriza una acción sobre un Matter. Lanza si no procede.
   * Devuelve la decisión para que el caller sepa si el acceso fue por supervisión.
   */
  async authorizeMatter(
    organizationId: string,
    userId: string,
    matterId: string,
    action: MatterAction,
  ): Promise<AccessDecision> {
    const matter = await this.matters.findById(organizationId, matterId);
    const firmRole = await this.firmRole(organizationId, userId);

    if (!firmRole) {
      await this.audit.record({
        organizationId,
        matterId,
        actorUserId: userId,
        action,
        resourceType: "matter",
        resourceId: matterId,
        outcome: "DENIED",
        reason: "not_an_organization_member",
      });
      throw new IusiaError("FORBIDDEN", "El usuario no pertenece a esta firma");
    }

    const matterRole = matter ? await this.matters.roleFor(matterId, userId) : null;

    const decision = decideMatterAccess(
      { firmRole, matterRole, sameOrganization: matter !== null },
      action,
    );

    // Se auditan las denegaciones y los accesos por supervisión de dirección.
    // Las lecturas ordinarias de un miembro del matter no generan ruido de auditoría.
    if (!decision.allowed || decision.viaSupervision) {
      await this.audit.record({
        organizationId,
        matterId,
        actorUserId: userId,
        action,
        resourceType: "matter",
        resourceId: matterId,
        outcome: decision.allowed ? "ALLOWED" : "DENIED",
        reason: decision.reason,
        detail: { firm_role: firmRole, matter_role: matterRole ?? "none" },
      });
    }

    if (!decision.allowed) {
      // Un matter inexistente y uno sin acceso devuelven lo mismo: no se filtra
      // la existencia de expedientes de otras firmas ni de otros equipos.
      throw new IusiaError("NOT_FOUND", "Expediente no encontrado o sin acceso", {
        matter_id: matterId,
      });
    }

    return decision;
  }

  /** True si el usuario puede ver la cartera completa de la firma. */
  async canSupervisePortfolio(organizationId: string, userId: string): Promise<boolean> {
    const role = await this.firmRole(organizationId, userId);
    return role === "FIRM_DIRECTOR";
  }
}
