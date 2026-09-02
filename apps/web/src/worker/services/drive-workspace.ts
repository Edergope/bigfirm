import { eq } from "drizzle-orm";
import {
  DRIVE_FOLDER_NAMES,
  matterFolderName,
  type DriveFolderKind,
} from "@iusia/domain";
import { DriveFolderRepository, createDb, schema } from "@iusia/db";
import type { Env } from "../env.js";
import { OrganizationStorageResolver } from "./drive-credentials.js";
import type { GoogleDriveAdapter } from "../integrations/google-drive.js";

/**
 * Estructura documental de la firma en Drive, garantizada de forma idempotente.
 *
 *   IUSIA / [Firma] / Expedientes / [Ref] - [Asunto] / 01 Documentos aportados
 *                                                     / 02 Documentos generados por IUSIA
 *   IUSIA / [Firma] / Plantillas
 *
 * Cada carpeta se crea una sola vez: su id de Drive se persiste en `drive_folders` y
 * se reutiliza. Los reintentos no duplican porque `ensureFolder` busca antes de
 * crear y el repositorio recuerda el primer id.
 */
/** Las cuatro carpetas que IUSIA mantiene por expediente. */
export interface MatterFolders {
  matter: string;
  uploaded: string;
  generated: string;
  retired: string;
}

export class DriveWorkspaceService {
  constructor(
    private readonly env: Env,
    private readonly folders: DriveFolderRepository,
    private readonly storage: OrganizationStorageResolver,
  ) {}

  static forEnv(env: Env): DriveWorkspaceService {
    return new DriveWorkspaceService(
      env,
      new DriveFolderRepository(createDb(env.DB)),
      OrganizationStorageResolver.forEnv(env),
    );
  }

  /** El actor autoriza la acción; la firma aporta la credencial física. */
  private adapterFor(organizationId: string): Promise<GoogleDriveAdapter> {
    return this.storage.resolveAdapter(organizationId, { requireWrite: true });
  }

  private async firmName(organizationId: string): Promise<string> {
    const db = createDb(this.env.DB);
    const rows = await db
      .select({ name: schema.organization.name })
      .from(schema.organization)
      .where(eq(schema.organization.id, organizationId))
      .limit(1);
    return rows[0]?.name ?? "Firma";
  }

  /** Carpeta persistida o recién creada bajo un padre, recordando su id. */
  private async ensure(
    drive: GoogleDriveAdapter,
    organizationId: string,
    kind: DriveFolderKind,
    name: string,
    parentId: string | undefined,
    scopeId = "",
  ): Promise<string> {
    const known = await this.folders.find(organizationId, kind, scopeId);
    if (known) return known;
    const driveId = await drive.ensureFolder(name, parentId);
    return this.folders.remember({ organizationId, kind, scopeId, driveFolderId: driveId });
  }

  /** IUSIA / [Firma] / Expedientes — creada una vez por organización. */
  async ensureFirmStructure(
    userId: string,
    organizationId: string,
  ): Promise<{ root: string; firm: string; matters: string; templates: string }> {
    const drive = await this.adapterFor(organizationId);
    const firm = await this.firmName(organizationId);
    const root = await this.ensure(drive, organizationId, "ROOT", DRIVE_FOLDER_NAMES.root, undefined);
    const firmFolder = await this.ensure(drive, organizationId, "FIRM", firm, root);
    const matters = await this.ensure(
      drive,
      organizationId,
      "MATTERS",
      DRIVE_FOLDER_NAMES.matters,
      firmFolder,
    );
    const templates = await this.ensure(
      drive,
      organizationId,
      "TEMPLATES",
      DRIVE_FOLDER_NAMES.templates,
      firmFolder,
    );
    return { root, firm: firmFolder, matters, templates };
  }

  /**
   * Carpeta del expediente y sus dos subcarpetas. Devuelve los ids de "aportados" y
   * "generados", donde viven los documentos del abogado y los de IUSIA.
   */
  /**
   * Estructura de carpetas en curso, por expediente.
   *
   * Cinco documentos del mismo lote se procesan a la vez, y los cinco necesitan las
   * mismas cuatro carpetas. Sin esto, los cinco comprobaban D1 a la vez, los cinco
   * fallaban la comprobación y los cinco llamaban a Drive: cuatro carpetas duplicadas
   * por nivel, y cuatro trabajadores perdiendo la escritura en D1 con carpetas
   * huérfanas detrás.
   *
   * `remember` ya resuelve la carrera en D1 —índice único y relectura—, pero eso ocurre
   * DESPUÉS de haber creado la carpeta en el proveedor. Compartir la promesa evita la
   * llamada de más, que es donde estaba el daño real.
   */
  private static readonly inFlight = new Map<string, Promise<MatterFolders>>();

  async ensureMatterFolders(
    userId: string,
    organizationId: string,
    matter: { id: string; reference: string; title: string },
  ): Promise<MatterFolders> {
    const key = `${organizationId}:${matter.id}`;
    const running = DriveWorkspaceService.inFlight.get(key);
    if (running) return running;
    const started = this.createMatterFolders(userId, organizationId, matter).finally(() => {
      DriveWorkspaceService.inFlight.delete(key);
    });
    DriveWorkspaceService.inFlight.set(key, started);
    return started;
  }

  private async createMatterFolders(
    userId: string,
    organizationId: string,
    matter: { id: string; reference: string; title: string },
  ): Promise<MatterFolders> {
    const drive = await this.adapterFor(organizationId);
    const { matters } = await this.ensureFirmStructure(userId, organizationId);
    const folderName = matterFolderName(matter.reference, matter.title);
    const matterFolder = await this.ensure(
      drive,
      organizationId,
      "MATTER",
      folderName,
      matters,
      matter.id,
    );
    const uploaded = await this.ensure(
      drive,
      organizationId,
      "UPLOADED",
      DRIVE_FOLDER_NAMES.uploaded,
      matterFolder,
      matter.id,
    );
    const generated = await this.ensure(
      drive,
      organizationId,
      "GENERATED",
      DRIVE_FOLDER_NAMES.generated,
      matterFolder,
      matter.id,
    );
    const retired = await this.ensure(
      drive, organizationId, "RETIRED", DRIVE_FOLDER_NAMES.retired, matterFolder, matter.id,
    );
    return { matter: matterFolder, uploaded, generated, retired };
  }
}
