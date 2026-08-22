import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@iusia/db/schema";
import type { IusiaDb } from "@iusia/db";
import {
  AuditRepository,
  AuthorityRepository,
  CreditRepository,
  DocumentRepository,
  ExecutionEventRepository,
  ExecutionRepository,
  FactRepository,
  MatterRepository,
  TaskRepository,
} from "@iusia/db";
import { AuthorizationService } from "../services/authorization.js";

/**
 * Harness de integración: SQLite real en memoria con el MISMO schema de producción
 * (se aplica la migración generada). Ejercita repositorios y AuthorizationService
 * con SQL real, no con mocks. Es la base de la certificación de aislamiento.
 */

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(here, "../../../migrations/0000_iusia_initial.sql");

export interface TestDb {
  db: IusiaDb;
  matters: MatterRepository;
  documents: DocumentRepository;
  executions: ExecutionRepository;
  events: ExecutionEventRepository;
  facts: FactRepository;
  authorities: AuthorityRepository;
  credits: CreditRepository;
  audit: AuditRepository;
  tasks: TaskRepository;
  authz: AuthorizationService;
  raw: Database.Database;
}

export function createTestDb(): TestDb {
  const raw = new Database(":memory:");
  raw.pragma("foreign_keys = ON");

  // Drizzle-kit separa sentencias con este marcador.
  const sql = readFileSync(MIGRATION, "utf8");
  for (const stmt of sql.split("--> statement-breakpoint")) {
    const trimmed = stmt.trim();
    if (trimmed) raw.exec(trimmed);
  }

  const db = drizzle(raw, { schema }) as unknown as IusiaDb;

  // D1 expone `.batch()` (atómico); el driver better-sqlite3 no. El harness lo emula
  // ejecutando las sentencias en secuencia. La idempotencia del Credit Ledger no
  // depende de la atomicidad del batch sino del índice único sobre idempotency_key,
  // así que esta emulación es fiel para lo que estos tests certifican.
  (db as unknown as { batch: (s: Promise<unknown>[]) => Promise<unknown[]> }).batch = async (
    statements: Promise<unknown>[],
  ) => {
    const out: unknown[] = [];
    for (const s of statements) out.push(await s);
    return out;
  };
  const matters = new MatterRepository(db);
  const audit = new AuditRepository(db);
  return {
    db,
    raw,
    matters,
    audit,
    documents: new DocumentRepository(db),
    executions: new ExecutionRepository(db),
    events: new ExecutionEventRepository(db),
    facts: new FactRepository(db),
    authorities: new AuthorityRepository(db),
    credits: new CreditRepository(db),
    tasks: new TaskRepository(db),
    authz: new AuthorizationService(db, matters, audit),
  };
}

/** Crea una firma con un director. Devuelve ids para armar escenarios de acceso. */
export async function seedFirm(
  t: TestDb,
  opts: { orgName: string; directorEmail: string },
): Promise<{ organizationId: string; directorUserId: string }> {
  const organizationId = `org_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const directorUserId = `usr_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const now = Date.now();

  t.raw
    .prepare(
      "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?,?,?,?,?,?)",
    )
    .run(directorUserId, opts.orgName + " Director", opts.directorEmail, 0, now, now);
  t.raw
    .prepare("INSERT INTO organization (id, name, slug, created_at) VALUES (?,?,?,?)")
    .run(organizationId, opts.orgName, opts.orgName.toLowerCase().replace(/\s+/g, "-"), now);
  t.raw
    .prepare(
      "INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES (?,?,?,?,?)",
    )
    .run(crypto.randomUUID(), organizationId, directorUserId, "FIRM_DIRECTOR", now);

  return { organizationId, directorUserId };
}

/** Añade un usuario a una firma con un rol de firma dado. */
export function addUser(
  t: TestDb,
  organizationId: string,
  email: string,
  firmRole: string,
): string {
  const userId = `usr_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const now = Date.now();
  t.raw
    .prepare(
      "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?,?,?,?,?,?)",
    )
    .run(userId, email, email, 0, now, now);
  t.raw
    .prepare(
      "INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES (?,?,?,?,?)",
    )
    .run(crypto.randomUUID(), organizationId, userId, firmRole, now);
  return userId;
}
