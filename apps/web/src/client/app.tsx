import { Navigate, Route, Routes } from "react-router";
import { useSession } from "./auth-client.js";
import { AppShell } from "./layouts/AppShell.js";
import { SignIn } from "./pages/SignIn.js";
import { Home } from "./pages/Home.js";
import { Matters } from "./pages/Matters.js";
import { MatterWorkspace } from "./pages/MatterWorkspace.js";

export function App() {
  const { data: session, isPending } = useSession();

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[15px] text-iusia-mist">
        Cargando…
      </div>
    );
  }

  if (!session) {
    return (
      <Routes>
        <Route path="/entrar" element={<SignIn />} />
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
        <Route path="casos/:matterId" element={<MatterWorkspace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
