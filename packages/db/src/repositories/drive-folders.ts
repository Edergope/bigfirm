import { and, eq } from "drizzle-orm";
import { newId } from "@iusia/domain";
import type { IusiaDb } from "../client.js";
import { driveFolders } from "../schema/iusia.js";

/**
 * Registro de carpetas de Drive gestionadas por IUSIA.
 *
 * Guarda el id de Drive de cada carpeta para no buscarla por nombre en cada
 * operación y para que los reintentos no creen duplicados. La clave lógica es
 * (organizationId, kind, scopeId).
 */
export class DriveFolderRepository {
  constructor(private readonly db: IusiaDb) {}

  async find(organizationId: string, kind: string, scopeId = ""): Promise<string | null> {
    const rows = await this.db
      .select({ driveFolderId: driveFolders.driveFolderId })
      .from(driveFolders)
      .where(
        and(
          eq(driveFolders.organizationId, organizationId),
          eq(driveFolders.kind, kind),
          eq(driveFolders.scopeId, scopeId),
        ),
      )
      .limit(1);
    return rows[0]?.driveFolderId ?? null;
  }

  /**
   * Persiste el id de Drive de una carpeta. Idempotente: si ya hay una fila para
   * (org, kind, scopeId), devuelve el id existente y NO sobrescribe —así un
   * reintento que ya creó la carpeta en Drive no la reemplaza por otra distinta—.
   */
  async remember(input: {
    organizationId: string;
    kind: string;
    scopeId?: string;
    driveFolderId: string;
  }): Promise<string> {
    const scopeId = input.scopeId ?? "";
    const existing = await this.find(input.organizationId, input.kind, scopeId);
    if (existing) return existing;
    await this.db
      .insert(driveFolders)
      .values({
        id: newId("driveFolder"),
        organizationId: input.organizationId,
        kind: input.kind,
        scopeId,
        driveFolderId: input.driveFolderId,
        createdAt: new Date().toISOString(),
      })
      .onConflictDoNothing();
    // Relee: si dos peticiones concurrentes insertaron, gana la primera fila.
    return (await this.find(input.organizationId, input.kind, scopeId)) ?? input.driveFolderId;
  }
}
