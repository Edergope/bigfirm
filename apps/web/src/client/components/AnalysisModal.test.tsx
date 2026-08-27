import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AnalysisModal } from "./AnalysisModal.js";
import { api } from "../api.js";

/**
 * La regla que estas pruebas protegen es de negocio, no de estilo: un análisis
 * jurídico ya pagado no puede morir porque el abogado cerró una ventana. Cerrar
 * oculta; sólo "Detener análisis" cancela.
 */

function wrap(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

const RUNNING_EVENTS = {
  events: [],
  graph: { nodes: [], edges: [] },
  executions: [
    {
      id: "exe_root",
      agentId: "pisoso-orquestador-juridico",
      rootExecutionId: "exe_root",
      parentExecutionId: null,
      status: "RUNNING",
      provider: null,
      model: null,
      creditsConsumed: null,
      createdAt: "2026-08-25T10:00:00.000Z",
    },
  ],
  last_sequence: 0,
};

beforeEach(() => {
  vi.spyOn(api, "executionEvents").mockResolvedValue(RUNNING_EVENTS as never);
  vi.spyOn(api, "agents").mockResolvedValue({
    agents: [],
    registered: 0,
    canonical_total: 30,
  } as never);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AI_MODAL_CLOSE_DOES_NOT_CANCEL", () => {
  it("cerrar con la X oculta la experiencia sin cancelar la ejecución", async () => {
    const cancel = vi.spyOn(api, "cancelExecution").mockResolvedValue({ ok: true, status: "CANCELLED" });
    const onClose = vi.fn();
    render(
      wrap(<AnalysisModal rootExecutionId="exe_root" matterId="mtr_1" open onClose={onClose} />),
    );

    await userEvent.click(await screen.findByLabelText(/Cerrar\. El análisis continúa/i));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("Escape y el fondo tampoco cancelan", async () => {
    const cancel = vi.spyOn(api, "cancelExecution").mockResolvedValue({ ok: true, status: "CANCELLED" });
    const onClose = vi.fn();
    render(
      wrap(<AnalysisModal rootExecutionId="exe_root" matterId="mtr_1" open onClose={onClose} />),
    );
    await screen.findByRole("dialog");

    await userEvent.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("el botón principal mientras corre invita a seguir trabajando, no a detener", async () => {
    render(
      wrap(<AnalysisModal rootExecutionId="exe_root" matterId="mtr_1" open onClose={vi.fn()} />),
    );
    expect(await screen.findByRole("button", { name: "Seguir trabajando" })).toBeDefined();
  });

  it("si el ledger indica cero documentos, no anuncia análisis documental", async () => {
    vi.mocked(api.executionEvents).mockResolvedValue({
      ...RUNNING_EVENTS,
      events: [{ type: "agent.milestone", detail: { milestone: "PLAN_START", document_count: 0 } }],
    } as never);
    render(
      wrap(<AnalysisModal rootExecutionId="exe_root" matterId="mtr_1" open onClose={vi.fn()} />),
    );
    expect(await screen.findByText("Analizando los hechos del caso")).toBeDefined();
    expect(screen.queryByText("Analizando documentos y evidencia")).toBeNull();
  });

  it("si el expediente tiene cero documentos, el primer render del modal no espera al ledger para ocultar la fase documental", async () => {
    render(
      wrap(
        <AnalysisModal
          rootExecutionId="exe_root"
          matterId="mtr_1"
          documentCount={0}
          open
          onClose={vi.fn()}
        />,
      ),
    );
    expect(await screen.findByText("Analizando los hechos del caso")).toBeDefined();
    expect(screen.queryByText("Analizando documentos y evidencia")).toBeNull();
  });
});

describe("AI_CANCEL_ACTION_REQUESTS_CANCEL", () => {
  it("sólo 'Detener análisis' pide la cancelación al servidor", async () => {
    const cancel = vi.spyOn(api, "cancelExecution").mockResolvedValue({ ok: true, status: "CANCELLED" });
    const onClose = vi.fn();
    render(
      wrap(<AnalysisModal rootExecutionId="exe_root" matterId="mtr_1" open onClose={onClose} />),
    );

    await userEvent.click(await screen.findByRole("button", { name: "Detener análisis" }));

    await waitFor(() => expect(cancel).toHaveBeenCalledWith("exe_root"));
    // Cancelar no cierra la ventana: el abogado debe ver el desenlace de su decisión.
    expect(onClose).not.toHaveBeenCalled();
  });
});
