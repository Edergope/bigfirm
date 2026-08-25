import { Link } from "react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, ScreenTitle, Skeleton, StateBlock, StatusChip } from "@iusia/ui";
import { api, type MeResponse } from "../api.js";
import { IusiaHero } from "../components/IusiaHero.js";
import { ConvocationModal } from "../components/ConvocationModal.js";
import { useActiveAnalyses } from "../hooks/use-active-analyses.js";

/**
 * Espacio de trabajo del abogado.
 *
 * No es un tablero de dirección reducido: responde a otra pregunta. El director
 * pregunta "qué pasa en mi firma"; quien lleva los casos pregunta "qué tengo que
 * hacer y qué vence". Por eso prioriza vencimientos y expedientes propios, y no
 * muestra indicadores de cartera que no puede accionar.
 */
export function MyWork({ me }: { me: MeResponse }) {
  const overdue = useQuery({ queryKey: ["intel", "overdue", false], queryFn: () => api.intelligence.overdue(false) });
  const upcoming = useQuery({ queryKey: ["intel", "upcoming", false], queryFn: () => api.intelligence.upcoming(false, 15) });
  const matters = useQuery({ queryKey: ["matters"], queryFn: api.listMatters });
  const { analyses, count: activeCount } = useActiveAnalyses();

  const overdueTasks = overdue.data?.tasks ?? [];
  const upcomingDeadlines = upcoming.data?.deadlines ?? [];
  const myMatters = matters.data?.matters ?? [];

  const [convoking, setConvoking] = useState(false);

  return (
    <div className="pb-2">
      <ScreenTitle
        eyebrow="Tu espacio"
        title={`Buen día, ${me.user.name.split(" ")[0] ?? me.user.name}`}
        description="Tu trabajo de hoy: vencimientos, expedientes asignados y análisis en curso."
      />

      {/* La misma puerta de entrada que ve la dirección: convocar a IUSIA no es una
          capacidad de dirección, es la capacidad del producto. */}
      <IusiaHero onConvoke={() => setConvoking(true)} />
      <ConvocationModal open={convoking} onClose={() => setConvoking(false)} />

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          {/* Lo que vence primero: es lo único que no admite postergación. */}
          <Card>
            <CardHeader
              title="Requiere tu atención"
              subtitle="Términos vencidos y próximos de tus expedientes"
            />
            {overdue.isLoading || upcoming.isLoading ? (
              <div className="p-5"><Skeleton className="h-24" /></div>
            ) : overdueTasks.length === 0 && upcomingDeadlines.length === 0 ? (
              <StateBlock
                kind="empty"
                title="Nada urgente"
                hint="No tienes términos vencidos ni próximos a vencer."
              />
            ) : (
              <ul className="divide-y divide-iusia-mist/20">
                {overdueTasks.map((t) => (
                  <li key={t.task_id} className="flex items-center justify-between gap-3 px-6 py-3">
                    <span className="min-w-0">
                      <span className="block truncate text-[14.5px] text-iusia-carbon">{t.title}</span>
                      <Link to={`/casos/${t.matter_id}`} className="text-[12.5px] text-iusia-action hover:underline">
                        Abrir expediente
                      </Link>
                    </span>
                    <StatusChip label="Vencido" tone="critical" dot />
                  </li>
                ))}
                {upcomingDeadlines.map((d) => (
                  <li key={d.task_id} className="flex items-center justify-between gap-3 px-6 py-3">
                    <span className="min-w-0">
                      <span className="block truncate text-[14.5px] text-iusia-carbon">{d.title}</span>
                      <Link to={`/casos/${d.matter_id}`} className="text-[12.5px] text-iusia-action hover:underline">
                        Abrir expediente
                      </Link>
                    </span>
                    <span className="shrink-0 text-right">
                      <StatusChip label="Próximo" tone="warning" dot />
                      {d.due_at ? (
                        <span className="mt-1 block text-[12px] tabular-nums text-iusia-mist-text">
                          {new Date(d.due_at).toLocaleDateString("es-CO")}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Mis expedientes"
              subtitle={`${myMatters.length} asignado${myMatters.length === 1 ? "" : "s"}`}
              action={
                <Link to="/casos" className="text-[13.5px] font-medium text-iusia-action hover:underline">
                  Ver todos
                </Link>
              }
            />
            {matters.isLoading ? (
              <div className="p-5"><Skeleton className="h-24" /></div>
            ) : myMatters.length === 0 ? (
              <StateBlock
                kind="empty"
                title="Sin expedientes asignados"
                hint="El acceso a cada caso lo concede la dirección de la firma."
              />
            ) : (
              <ul className="divide-y divide-iusia-mist/20">
                {myMatters.slice(0, 8).map((m) => (
                  <li key={m.id}>
                    <Link
                      to={`/casos/${m.id}`}
                      className="flex items-center justify-between gap-3 px-6 py-3 transition-colors hover:bg-iusia-mist/5"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[14.5px] text-iusia-carbon">{m.title}</span>
                        <span className="block truncate text-[12.5px] text-iusia-mist-text">
                          {m.reference} · {m.clientName}
                        </span>
                      </span>
                      <StatusChip
                        label={m.materiality}
                        tone={m.materiality === "HIGH_STAKES" ? "warning" : "neutral"}
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="IUSIA" subtitle="Análisis sobre tus expedientes" />
            <div className="px-6 py-5">
              {activeCount === 0 ? (
                <p className="text-[13.5px] text-iusia-mist-text">
                  No hay análisis en curso. Puedes iniciar uno desde cualquier expediente.
                </p>
              ) : (
                <ul className="space-y-2">
                  {analyses.map((a) => (
                    <li key={a.root_execution_id}>
                      <Link
                        to={`/casos/${a.matter_id}`}
                        className="flex items-center gap-2 text-[13.5px] text-iusia-action hover:underline"
                      >
                        <span className="relative flex h-2 w-2" aria-hidden>
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-iusia-intel opacity-60 motion-reduce:animate-none" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-iusia-intel" />
                        </span>
                        <span className="truncate">{a.matter_title}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <Link
                to="/iusia"
                className="mt-4 inline-block text-[13px] font-medium text-iusia-action hover:underline"
              >
                Ver actividad de IUSIA
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
