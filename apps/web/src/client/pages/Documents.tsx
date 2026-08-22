import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, PageHeader, StateBlock, StatusChip } from "@iusia/ui";
import { api } from "../api.js";

/**
 * Documentos — vista lógica del expediente. El archivo vive en Google Drive; IUSIA
 * administra metadata. No finge conexión si el adapter está NOT_CONFIGURED.
 */
export function Documents() {
  const integrations = useQuery({ queryKey: ["integrations"], queryFn: api.integrationsStatus });
  const storageConnected = integrations.data?.storage.status === "CONNECTED";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Documentos"
        description="Google Drive es el repositorio primario; IUSIA administra referencias y estado."
        actions={
          integrations.data ? (
            <StatusChip
              label={storageConnected ? "Drive conectado" : "Drive no conectado"}
              tone={storageConnected ? "success" : "warning"}
              dot
            />
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Almacenamiento" subtitle="Google Drive" />
          <div className="px-6 py-5">
            <StatusChip
              label={integrations.data?.storage.status ?? "…"}
              tone={storageConnected ? "success" : "warning"}
            />
            <p className="mt-3 text-[13.5px] text-iusia-mist">
              {integrations.data?.notes.storage ??
                "Estado de la integración de almacenamiento documental."}
            </p>
          </div>
        </Card>

        <Card>
          <CardHeader title="Búsqueda / indexación" subtitle="Cloudflare AI Search" />
          <div className="px-6 py-5">
            <StatusChip
              label={integrations.data?.retrieval.status ?? "…"}
              tone={integrations.data?.retrieval.status === "CONNECTED" ? "success" : "warning"}
            />
            <p className="mt-3 text-[13.5px] text-iusia-mist">
              {integrations.data?.notes.retrieval ??
                "El aislamiento por firma/matter se calcula en el servidor antes de consultar."}
            </p>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Expediente documental" />
        <StateBlock
          kind="not_configured"
          title="Vinculación de documentos no disponible"
          hint="El Google Drive Picker requiere OAuth de Google, aún no aprovisionado. Los documentos se vinculan y consultan desde cada Matter una vez conectado."
        />
      </Card>
    </div>
  );
}
