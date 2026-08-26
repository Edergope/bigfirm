/**
 * Extrae campos editables de la representación Markdown producida por Workers AI.
 * La clave lógica permanece snake_case; `placeholder` conserva exactamente el token
 * del DOCX para reemplazarlo sin alterar estilos ni diagramación.
 */
export function discoverTemplateVariables(markdown: string): Array<{
  key: string;
  label: string;
  required: boolean;
  placeholder: string;
}> {
  const tokens = markdown.match(/\{\{[a-z][a-z0-9_]*\}\}|\\?\[[A-ZÁÉÍÓÚÜÑ0-9][A-ZÁÉÍÓÚÜÑ0-9 _/-]{1,80}\\?\]/g) ?? [];
  const seenTokens = new Set<string>();
  const usedKeys = new Set<string>();
  return tokens.flatMap((token) => {
    const placeholder = token.replace(/\\(\[|\])/g, "$1");
    if (seenTokens.has(placeholder)) return [];
    seenTokens.add(placeholder);
    const label = placeholder.startsWith("{{") ? placeholder.slice(2, -2) : placeholder.slice(1, -1);
    const normalized = label
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "campo";
    const base = /^[a-z]/.test(normalized) ? normalized : `campo_${normalized}`;
    let key = base;
    let suffix = 2;
    while (usedKeys.has(key)) key = `${base}_${suffix++}`;
    usedKeys.add(key);
    return [{ key, label, required: true, placeholder }];
  });
}
