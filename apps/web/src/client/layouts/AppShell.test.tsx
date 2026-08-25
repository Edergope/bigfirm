import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AppShell } from "./AppShell.js";
import { api, type MeResponse } from "../api.js";

/**
 * La navegación no autoriza —eso ocurre en el servidor— pero sí decide qué es
 * legible. Mostrar "Control IUSIA" a quien no puede usarlo convierte el producto
 * en un mapa de puertas cerradas, así que la visibilidad es parte del contrato.
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
      <MemoryRouter initialEntries={["/"]}>{node}</MemoryRouter>
    </QueryClientProvider>
  );
}

function mockMe(over: Partial<MeResponse>) {
  vi.spyOn(api, "me").mockResolvedValue({ ...ME, ...over });
  vi.spyOn(api, "activeAnalyses").mockResolvedValue({ active: [] });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => {
  vi.spyOn(api, "activeAnalyses").mockResolvedValue({ active: [] });
});

describe("SYSTEM_SUPERADMIN_CONTROL_VISIBLE", () => {
  it("el superadministrador ve Control IUSIA", async () => {
    mockMe({ is_system_superadmin: true, system_role: "SYSTEM_SUPERADMIN", firm_role: "FIRM_DIRECTOR" });
    render(wrap(<AppShell />));
    expect(await screen.findByText("Control IUSIA")).toBeDefined();
  });
});

describe("NON_SUPERADMIN_CONTROL_HIDDEN", () => {
  it("un director sin capacidad de sistema no ve Control IUSIA", async () => {
    mockMe({ firm_role: "FIRM_DIRECTOR", is_system_superadmin: false });
    render(wrap(<AppShell />));
    // Esperamos a que el rol esté resuelto antes de afirmar la ausencia.
    expect(await screen.findByText("Equipo")).toBeDefined();
    expect(screen.queryByText("Control IUSIA")).toBeNull();
  });

  it("un abogado no ve ni Equipo ni Control IUSIA", async () => {
    mockMe({ firm_role: "LAWYER" });
    render(wrap(<AppShell />));
    expect(await screen.findByText("Casos")).toBeDefined();
    expect(screen.queryByText("Equipo")).toBeNull();
    expect(screen.queryByText("Control IUSIA")).toBeNull();
  });
});
