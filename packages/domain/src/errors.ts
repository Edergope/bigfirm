/** Errores tipados del dominio. El transporte HTTP los mapea a códigos coherentes. */

export type IusiaErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "CONFLICT"
  | "INSUFFICIENT_CREDITS"
  | "PROMPT_INTEGRITY_FAILED"
  | "AGENT_NOT_REGISTERED"
  | "PROVIDER_ERROR"
  /** Falta un secreto/config externa para operar (p. ej. AI Gateway sin credenciales). */
  | "PROVIDER_NOT_CONFIGURED"
  | "PROVIDER_TIMEOUT"
  | "GATE_BLOCKED"
  | "INTERNAL";

const STATUS: Record<IusiaErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  CONFLICT: 409,
  INSUFFICIENT_CREDITS: 402,
  PROMPT_INTEGRITY_FAILED: 500,
  AGENT_NOT_REGISTERED: 500,
  PROVIDER_ERROR: 502,
  // 503: la operación es válida pero el servicio externo no está aprovisionado.
  PROVIDER_NOT_CONFIGURED: 503,
  PROVIDER_TIMEOUT: 504,
  GATE_BLOCKED: 409,
  INTERNAL: 500,
};

export class IusiaError extends Error {
  readonly code: IusiaErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(
    code: IusiaErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "IusiaError";
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }

  toJSON() {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}

export function isIusiaError(e: unknown): e is IusiaError {
  return e instanceof IusiaError;
}
