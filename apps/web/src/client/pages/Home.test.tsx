import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Home } from "./Home.js";
import { api, type MeResponse } from "../api.js";

/**
 * Inicio no es una vista: es dos productos bajo la misma ruta. Estas pruebas fijan
 * qué ve cada alcance, porque enseñar la cartera de la firma a quien sólo lleva
 * casos es tan disfuncional como lo contrario.
 */

const ME: MeResponse = {
  user: { id: "usr_1", name: "Ana" },
  organization_id: "org_1",
  firm_role: "LAWYER",
  credits: 1000,
  system_role: null,
  is_system_superadmin: false,
};

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>
  );
}

function mockApis(firmRole: string) {
  vi.spyOn(api, "me").mockResolvedValue({ ...ME, firm_role: firmRole });
  vi.spyOn(api, "listMatters").mockResolvedValue({ matters: [], scope: "ASSIGNED" });
  vi.spyOn(api, "activeAnalyses").mockResolvedValue({ active: [] });
  vi.spyOn(api.intelligence, "caseHealth").mockResolvedValue({ total: 0, by_status: {}, at_risk: 0 });
  vi.spyOn(api.intelligence, "overdue").mockResolvedValue({ tasks: [] });
  vi.spyOn(api.intelligence, "upcoming").mockResolvedValue({ deadlines: [] });
  vi.spyOn(api.intelligence, "risks").mockResolvedValue({ risks: [] });
  vi.spyOn(api.intelligence, "workload").mockResolvedValue({ workload: [] });
  vi.spyOn(api.intelligence, "inactive").mockResolvedValue({ matters: [] });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DIRECTOR_DASHBOARD_ROLE", () => {
  it("la dirección aterriza en el centro de mando de la firma", async () => {
    mockApis("FIRM_DIRECTOR");
    render(wrap(<Home />));
    expect(await screen.findByText("Operación jurídica")).toBeDefined();
    expect(screen.queryByText("Requiere tu atención")).toBeNull();
  });
});

describe("LAWYER_WORKSPACE_ROLE", () => {
  it("el abogado aterriza en su espacio de trabajo, no en la cartera de la firma", async () => {
    mockApis("LAWYER");
    render(wrap(<Home />));
    expect(await screen.findByText("Requiere tu atención")).toBeDefined();
  });
});
