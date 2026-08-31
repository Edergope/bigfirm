/**
 * Stub de `cloudflare:workers` para poder ejercitar el Workflow REAL fuera del
 * runtime de Cloudflare.
 *
 * No simula el motor durable —eso es propiedad de Cloudflare y no se prueba aquí—:
 * sólo aporta la clase base para que `MatterOrchestrationWorkflow` sea instanciable
 * en Node. El `step` lo inyecta cada test, de modo que lo que se prueba es la
 * SECUENCIA DE DECISIONES del workflow, que es exactamente donde vivió el fallo.
 */
export class WorkflowEntrypoint<Env = unknown, _Params = unknown> {
  constructor(
    protected readonly ctx: unknown,
    protected readonly env: Env,
  ) {}
}

export type WorkflowEvent<T> = { payload: T; instanceId: string; timestamp: Date };

export interface WorkflowStep {
  do<T>(name: string, callback: () => Promise<T>): Promise<T>;
  do<T>(name: string, options: unknown, callback: () => Promise<T>): Promise<T>;
  sleep(name: string, duration: string | number): Promise<void>;
  waitForEvent<T>(name: string, options: unknown): Promise<{ payload: T }>;
}
