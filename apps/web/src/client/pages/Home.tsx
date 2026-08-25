import { useQuery } from "@tanstack/react-query";
import { Card, Skeleton, StateBlock } from "@iusia/ui";
import { api, ApiError } from "../api.js";
import { CommandCenter } from "./CommandCenter.js";
import { MyWork } from "./MyWork.js";

/**
 * Inicio: la misma ruta, dos productos distintos según el alcance real del usuario.
 *
 * Quien dirige la firma necesita decidir sobre la cartera; quien lleva los casos
 * necesita saber qué hacer hoy. Mostrar el mismo tablero a ambos obligaría a uno de
 * los dos a traducir información que no puede accionar. El rol lo resuelve el
 * servidor en `/api/me`: aquí sólo se elige la presentación.
 */
export function Home() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });

  if (me.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-[92px]" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (me.error || !me.data) {
    return (
      <Card>
        <StateBlock
          kind="error"
          title="No fue posible cargar tu espacio"
          hint={me.error instanceof ApiError ? me.error.message : "Vuelve a intentarlo."}
        />
      </Card>
    );
  }

  const directs = me.data.firm_role === "FIRM_DIRECTOR" || me.data.firm_role === "PARTNER";
  return directs ? <CommandCenter me={me.data} /> : <MyWork me={me.data} />;
}
