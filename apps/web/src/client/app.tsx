import { Navigate, Route, Routes } from "react-router";
import { useSession } from "./auth-client.js";
import { AppShell } from "./layouts/AppShell.js";
import { SignIn } from "./pages/SignIn.js";
import { AcceptInvitation } from "./pages/AcceptInvitation.js";
import { Team } from "./pages/Team.js";
import { Home } from "./pages/Home.js";
import { Matters } from "./pages/Matters.js";
import { MatterWorkspace } from "./pages/MatterWorkspace.js";
import { Deadlines } from "./pages/Deadlines.js";
import { Documents } from "./pages/Documents.js";
import { Iusia } from "./pages/Iusia.js";
import { SystemControl } from "./pages/SystemControl.js";
import { Templates } from "./pages/Templates.js";

export function App() {
  const { data: session, isPending } = useSession();

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[15px] text-iusia-mist-text">
        Cargando…
      </div>
    );
  }

  if (!session) {
    return (
      <Routes>
        <Route path="/entrar" element={<SignIn />} />
        <Route path="/invitacion" element={<AcceptInvitation />} />
        <Route path="*" element={<Navigate to="/entrar" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/entrar" element={<Navigate to="/" replace />} />
      <Route element={<AppShell />}>
        <Route index element={<Home />} />
        <Route path="casos" element={<Matters />} />
        <Route path="equipo" element={<Team />} />
        <Route path="casos/:matterId" element={<MatterWorkspace />} />
        <Route path="tareas" element={<Deadlines />} />
        <Route path="documentos" element={<Documents />} />
        <Route path="plantillas" element={<Templates />} />
        <Route path="iusia" element={<Iusia />} />
        {/* Control del sistema: la vista revalida la capacidad contra el servidor. */}
        <Route path="control" element={<SystemControl />} />
        {/* La antigua "Inteligencia" duplicaba el Centro de Mando: sus capacidades
            únicas (riesgos y expedientes inactivos) viven ahora en Inicio. */}
        <Route path="inteligencia" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
