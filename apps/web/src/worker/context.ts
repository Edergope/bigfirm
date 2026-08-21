import { createMiddleware } from "hono/factory";
import { eq } from "drizzle-orm";
import { IusiaError } from "@iusia/domain";
import {
  AuditRepository,
  AuthorityRepository,
  CreditRepository,
  DocumentRepository,
  ExecutionEventRepository,
  ExecutionRepository,
  FactRepository,
  MatterRepository,
  createDb,
  schema,
  type IusiaDb,
} from "@iusia/db";
import type { Env } from "./env.js";
import { createAuth } from "./auth/config.js";
import { AuthorizationService } from "./services/authorization.js";

export interface RequestContext {
  db: IusiaDb;
  matters: MatterRepository;
  documents: DocumentRepository;
  executions: ExecutionRepository;
  events: ExecutionEventRepository;
  facts: FactRepository;
  authorities: AuthorityRepository;
  credits: CreditRepository;
  audit: AuditRepository;
  authz: AuthorizationService;
}

export interface SessionContext {
  userId: string;
  userName: string;
  organizationId: string;
}

export type AppBindings = {
  Bindings: Env;
  Variables: { ctx: RequestContext; session: SessionContext };
};

function buildContext(env: Env): RequestContext {
  const db = createDb(env.DB);
  const matters = new MatterRepository(db);
  const audit = new AuditRepository(db);
  return {
    db,
    matters,
    audit,
    documents: new DocumentRepository(db),
    executions: new ExecutionRepository(db),
    events: new ExecutionEventRepository(db),
    facts: new FactRepository(db),
    authorities: new AuthorityRepository(db),
    credits: new CreditRepository(db),
    authz: new AuthorizationService(db, matters, audit),
  };
}

/** Construye repositorios y servicios una vez por request. */
export const withContext = createMiddleware<AppBindings>(async (c, next) => {
  c.set("ctx", buildContext(c.env));
  await next();
});

/**
 * Exige sesión válida y organización activa.
 * Sin organización activa no hay tenant: ninguna consulta de dominio puede correr.
 */
export const requireSession = createMiddleware<AppBindings>(async (c, next) => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });

  if (!session?.user) {
    throw new IusiaError("UNAUTHENTICATED", "Sesión no válida");
  }

  let organizationId = session.session.activeOrganizationId;

  if (!organizationId) {
    // Tras un login normal la sesión no trae firma activa. Si el usuario pertenece
    // a exactamente una firma, se resuelve sin ambigüedad. Con varias, elegir por
    // él podría abrir el expediente equivocado: se exige selección explícita.
    const db = createDb(c.env.DB);
    const memberships = await db
      .select({ organizationId: schema.member.organizationId })
      .from(schema.member)
      .where(eq(schema.member.userId, session.user.id))
      .limit(2);

    if (memberships.length === 1) {
      organizationId = memberships[0]!.organizationId;
    } else {
      throw new IusiaError(
        "FORBIDDEN",
        memberships.length === 0
          ? "El usuario no pertenece a ninguna firma."
          : "Selecciona la firma con la que quieres trabajar.",
        { organizations: memberships.length },
      );
    }
  }

  c.set("session", {
    userId: session.user.id,
    userName: session.user.name,
    organizationId,
  });
  await next();
});
