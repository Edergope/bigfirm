import { describe, expect, it } from "vitest";
import { wrapLabel } from "./orchestration-network.js";

/**
 * Nombres del grafo de agentes.
 *
 * Se truncaban a 22 caracteres con puntos suspensivos, así que
 * "03 · Investigador normativo jurisprudencial" aparecía como
 * "03 · Investigador nor…" y varios especialistas distintos quedaban con el mismo
 * prefijo ilegible. Ahora se envuelven en hasta dos líneas y sólo se recorta lo que ni
 * así cabe.
 */
describe("envoltura de nombres en el grafo", () => {
  it("deja en una línea lo que cabe en una línea", () => {
    expect(wrapLabel("Socio Director", 16)).toEqual(["Socio Director"]);
  });

  it("reparte en dos líneas sin cortar palabras", () => {
    const lines = wrapLabel("Investigador normativo jurisprudencial", 20);
    expect(lines).toHaveLength(2);
    // Ninguna palabra queda partida por la mitad.
    expect(lines.join(" ")).not.toContain("Investigad ");
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(20);
  });

  it("nunca supera el número de líneas permitido", () => {
    const lines = wrapLabel(
      "Especialista en contratación estatal y régimen sancionatorio administrativo",
      16,
    );
    expect(lines.length).toBeLessThanOrEqual(2);
  });

  it("el recorte cae en la última línea, jamás en la primera", () => {
    const lines = wrapLabel(
      "Especialista en contratación estatal y régimen sancionatorio administrativo",
      16,
    );
    expect(lines[0]).not.toContain("…");
    expect(lines[lines.length - 1]).toContain("…");
  });

  it("parte una palabra sola más larga que la línea", () => {
    const lines = wrapLabel("Superintendencia", 10);
    expect(lines[0]!.length).toBeLessThanOrEqual(10);
  });

  it("con más espacio no recorta un nombre que antes se truncaba", () => {
    // El caso real: en posición vertical hay sitio de sobra.
    const lines = wrapLabel("03 · Investigador normativo jurisprudencial", 28);
    expect(lines.join(" ")).toBe("03 · Investigador normativo jurisprudencial");
    expect(lines.join("")).not.toContain("…");
  });

  it("una etiqueta vacía no rompe el layout", () => {
    expect(wrapLabel("   ", 16)).toEqual([""]);
  });
});
