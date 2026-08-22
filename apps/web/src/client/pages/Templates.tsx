import { Card, CardHeader, PageHeader, StateBlock, StatusChip } from "@iusia/ui";

/**
 * Plantillas — biblioteca aprobada. La generación real usa adapters de Google Docs /
 * Docxtemplater (aún NOT_CONFIGURED). No se construye un procesador de texto.
 */
export function Templates() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Plantillas"
        description="Biblioteca por tipo, área, jurisdicción y versión. Generación vía Google Docs / Docxtemplater."
      />
      <Card>
        <CardHeader
          title="Biblioteca de plantillas"
          action={<StatusChip label="Motores no configurados" tone="warning" dot />}
        />
        <StateBlock
          kind="not_configured"
          title="Aún sin plantillas activas"
          hint="Los motores de generación (Google Docs API y Docxtemplater) requieren configuración externa. El dominio de plantillas y la validación de variables ya están implementados."
        />
      </Card>
    </div>
  );
}
