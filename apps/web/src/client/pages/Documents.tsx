import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { FolderOpen, Search } from "lucide-react";
import { Button, Module, ScreenTitle, Skeleton, StatusChip, capabilityTerm } from "@iusia/ui";
import { api } from "../api.js";
import { authClient } from "../auth-client.js";

/**
 * Scopes de Drive: lectura ya validada + escritura acotada (drive.file). Separados
 * del login de identidad.
 */
const DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
];

/**
 * Autorización incremental de Google Drive, separada del login. Reutiliza
 * `linkSocial` de Better Auth; el navegador va a Google y vuelve, y el frontend
 * nunca ve tokens.
 */
async function connectDrive() {
  await authClient.linkSocial({
    provider: "google",
    scopes: DRIVE_SCOPES,
    callbackURL: window.location.pathname,
  });
}

/**
 * Documentos — la capacidad documental de la firma contada al abogado.
 *
 * Esta vista mostraba `NOT-CONFIGURED`, `GOOGLE_CLIENT_ID/SECRET`, "Cloudflare AI
 * Search" y "POC". Eso es infraestructura: le dice al abogado por qué falla algo
 * que no puede arreglar, y no le dice lo único que necesita saber —si puede
 * trabajar con documentos y a quién acudir si no—. La causa técnica sigue viva y
 * completa en Control IUSIA, que es donde alguien puede actuar sobre ella.
 *
 * Se nombran dos hechos distintos que antes compartían rótulo:
 *  · el REPOSITORIO de la firma (configuración, igual para todos);
 *  · tu ACCESO personal a Drive (autorización OAuth, propia de cada persona).
 * Llamar "Drive conectado" a ambos era lo que hacía que el expediente dijera una
 * cosa y esta vista la contraria.
 */
export function Documents() {
  const integrations = useQuery({ queryKey: ["integrations"], queryFn: api.integrationsStatus });
  const drive = useQuery({ queryKey: ["drive-status"], queryFn: api.driveStatus });
  const matters = useQuery({ queryKey: ["matters"], queryFn: api.listMatters });

  const repository = capabilityTerm(integrations.data?.storage.status);
  const indexing = capabilityTerm(integrations.data?.retrieval.status);
  const myAccess = drive.data?.connected === true;
  const canWrite = drive.data?.write === true;

  return (
    <div className="pb-2">
      <ScreenTitle
        eyebrow="Repositorio"
        title="Documentos"
        description="Los documentos de cada expediente viven en su propio caso. Aquí ves si la firma tiene el repositorio habilitado y si tú puedes acceder."
      />

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <Module title="Repositorio documental" eyebrow="Capacidad de la firma">
          <Capability
            icon={<FolderOpen size={15} />}
            name="Almacenamiento"
            term={repository}
          />
          <Capability
            icon={<Search size={15} />}
            name="Búsqueda para IUSIA"
            term={indexing}
            className="mt-3"
          />
        </Module>

        <Module title="Tu acceso" eyebrow="Autorización personal">
          {drive.isLoading ? (
            <Skeleton className="h-10" />
          ) : (
            <>
              {/* Tres estados reales: sin autorizar, autorizado sólo lectura (falta
                  reconectar para que IUSIA pueda crear/guardar), y autorizado con
                  escritura. La acción se muestra siempre que falte algo. */}
              <StatusChip
                label={
                  !myAccess ? "Sin autorizar" : canWrite ? "Autorizado" : "Sólo lectura"
                }
                tone={!myAccess ? "neutral" : canWrite ? "success" : "warning"}
                dot
              />
              <p className="mt-2.5 text-[13px] leading-relaxed text-iusia-mist-text">
                {!myAccess
                  ? "Autoriza el acceso para que IUSIA guarde y lea los documentos de tus expedientes en Drive."
                  : canWrite
                    ? "IUSIA puede crear la carpeta del expediente, guardar tus documentos y los que genere."
                    : "IUSIA puede leer, pero aún no crear ni guardar documentos. Reconecta para habilitar la escritura."}
              </p>
              {!myAccess || !canWrite ? (
                <div className="mt-3">
                  <Button size="sm" onClick={() => void connectDrive()}>
                    {!myAccess ? "Autorizar acceso a Drive" : "Reconectar Drive"}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </Module>

        <Module title="Dónde están tus documentos" eyebrow="Expedientes">
          {matters.isLoading ? (
            <Skeleton className="h-16" />
          ) : (matters.data?.matters.length ?? 0) === 0 ? (
            <p className="text-[13px] text-iusia-mist-text">
              Aún no hay expedientes con documentos.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {(matters.data?.matters ?? []).slice(0, 5).map((m) => (
                <li key={m.id}>
                  <Link
                    to={`/casos/${m.id}`}
                    className="block truncate rounded-[8px] px-2 py-1.5 text-[13px] text-iusia-carbon transition-colors hover:bg-iusia-ice hover:text-iusia-action"
                  >
                    {m.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Module>
      </div>
    </div>
  );
}

/**
 * Una capacidad: qué es, si funciona y qué hacer si no. Nunca por qué falla — esa
 * respuesta sólo sirve a quien puede arreglarlo, y esa persona mira Control IUSIA.
 */
function Capability({
  icon,
  name,
  term,
  className,
}: {
  icon: React.ReactNode;
  name: string;
  term: { label: string; hint: string; tone: string };
  className?: string;
}) {
  return (
    <div className={"flex items-start gap-3 " + (className ?? "")}>
      <span
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-iusia-navy/8 text-iusia-navy"
        aria-hidden
      >
        {icon}
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13.5px] font-medium text-iusia-navy">{name}</span>
          <StatusChip label={term.label} tone={term.tone} dot />
        </div>
        <p className="mt-0.5 text-[12.5px] text-iusia-mist-text">{term.hint}</p>
      </div>
    </div>
  );
}
