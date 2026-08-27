import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Check, Download, FilePlus2, FileSignature, History, PanelLeftClose, PanelLeftOpen, Power, Search, Upload, X } from "lucide-react";
import clsx from "clsx";
import { Button, ScreenTitle, Skeleton, StatusChip } from "@iusia/ui";
import { api } from "../api.js";
import { FileViewer } from "./Documents.js";

type TemplateRow = Awaited<ReturnType<typeof api.adminTemplates>>["templates"][number];

const TYPE_LABEL: Record<string, string> = {
  OPINION: "Concepto jurídico", CONTRACT: "Contrato", CONTRATO: "Contrato",
  DEMANDA: "Demanda", MEMORANDO: "Memorando", ESCRITO: "Actuación judicial",
  POWER: "Poder", REPORT: "Informe", CORPORATE: "Societario", COMMUNICATION: "Comunicación",
};

export function Templates() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const superadmin = me.data?.is_system_superadmin === true;
  const publicTemplates = useQuery({ queryKey: ["templates"], queryFn: api.listTemplates, enabled: !superadmin });
  const adminTemplates = useQuery({ queryKey: ["admin-templates"], queryFn: api.adminTemplates, enabled: superadmin });
  const queryClient = useQueryClient();
  const importOfficial = useMutation({
    mutationFn: api.importOfficialTemplates,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-templates"] }),
        queryClient.invalidateQueries({ queryKey: ["templates"] }),
      ]);
    },
  });
  const rows = useMemo<TemplateRow[]>(() => {
    // Las retiradas siguen en auditoría/backend, pero nunca contaminan la biblioteca
    // operativa ni permiten descarga/activación accidental desde este workspace.
    if (superadmin) return (adminTemplates.data?.templates ?? []).filter((row) => row.status !== "RETIRED");
    return (publicTemplates.data?.templates ?? []).map((row) => ({
      ...row, checksum: null, created_by: null, created_at: "", updated_at: "",
    }));
  }, [adminTemplates.data, publicTemplates.data, superadmin]);
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<{ mode: "new" | "version"; base?: TemplateRow } | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(true);
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("es");
    return needle ? rows.filter((row) => `${row.name} ${row.category} ${row.document_type}`.toLocaleLowerCase("es").includes(needle)) : rows;
  }, [rows, search]);
  useEffect(() => { if (!filtered.some((row) => row.id === selectedId)) setSelectedId(filtered[0]?.id ?? ""); }, [filtered, selectedId]);
  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const loading = superadmin ? adminTemplates.isLoading : publicTemplates.isLoading;

  return <div className="pb-2">
    <ScreenTitle eyebrow="Producción documental" title="Template Bank" description="Plantillas oficiales de Pisoso Legal, preservadas con su diagramación y trazabilidad de versión." actions={superadmin ? <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => importOfficial.mutate()} disabled={importOfficial.isPending}><Upload size={14} /> {importOfficial.isPending ? "Importando…" : "Importar oficiales"}</Button><Button onClick={() => setEditor({ mode: "new" })}><FilePlus2 size={14} /> Nueva plantilla</Button></div> : undefined} />
    {importOfficial.isSuccess ? <p className="mb-3 rounded-[8px] bg-iusia-success/8 px-3 py-2 text-[12px] text-iusia-navy">{importOfficial.data.imported.length} plantillas oficiales importadas · {importOfficial.data.skipped.length} ya estaban registradas</p> : null}
    {importOfficial.isError ? <p className="mb-3 rounded-[8px] bg-iusia-critical/8 px-3 py-2 text-[12px] text-iusia-critical">{importOfficial.error.message}</p> : null}
    <div className={clsx("grid min-h-[calc(100vh-185px)] overflow-hidden rounded-[var(--radius-lg)] bg-iusia-paper shadow-[var(--shadow-surface)]", catalogOpen ? "lg:grid-cols-[minmax(250px,29%)_minmax(0,1fr)]" : "lg:grid-cols-[44px_minmax(0,1fr)]")}>
      <section className="flex min-h-[300px] min-w-0 flex-col border-b border-iusia-mist/25 lg:border-b-0 lg:border-r" aria-label="Catálogo de plantillas">
        {!catalogOpen ? <button type="button" onClick={() => setCatalogOpen(true)} aria-label="Mostrar catálogo" className="hidden h-full min-h-[650px] w-full items-start justify-center bg-iusia-paper px-2 py-4 text-iusia-mist-text transition-colors hover:bg-iusia-ice/70 hover:text-iusia-navy lg:flex"><PanelLeftOpen size={16} /></button> : null}
        {catalogOpen ? <>
        <div className="border-b border-iusia-mist/20 p-3">
          <div className="flex items-center justify-between gap-2"><h2 className="text-[13px] font-semibold text-iusia-navy">Biblioteca oficial</h2><div className="flex items-center gap-2"><span className="text-[11px] tabular-nums text-iusia-mist-text">{rows.length} versiones</span><button type="button" onClick={() => setCatalogOpen(false)} aria-label="Ocultar catálogo" className="hidden rounded-[7px] p-1.5 text-iusia-mist-text transition-colors hover:bg-iusia-ice hover:text-iusia-navy lg:inline-flex"><PanelLeftClose size={14} /></button></div></div>
          <label className="mt-3 flex h-9 items-center gap-2 rounded-[9px] bg-iusia-ice/70 px-3 text-iusia-mist-text focus-within:ring-2 focus-within:ring-iusia-action/30"><Search size={14} /><span className="sr-only">Buscar plantillas</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre, tipo o categoría" className="min-w-0 flex-1 bg-transparent text-[13px] text-iusia-carbon outline-none placeholder:text-iusia-mist-text" />{search ? <button type="button" onClick={() => setSearch("")} aria-label="Limpiar búsqueda"><X size={13} /></button> : null}</label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {loading ? <Skeleton className="m-2 h-40" /> : filtered.length === 0 ? <div className="flex h-44 flex-col items-center justify-center text-center"><FileSignature size={25} className="text-iusia-mist" /><p className="mt-2 text-[13px] font-medium text-iusia-navy">No hay plantillas disponibles</p></div> : filtered.map((template) => <button key={template.id} type="button" onClick={() => { setSelectedId(template.id); setEditor(null); }} className={clsx("mb-1 flex w-full items-start gap-3 rounded-[10px] px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-iusia-action/35", selectedId === template.id ? "bg-iusia-navy text-white" : "hover:bg-iusia-ice/70")}><FileSignature size={17} className={selectedId === template.id ? "mt-0.5 text-iusia-intel" : "mt-0.5 text-iusia-action"} /><span className="min-w-0 flex-1"><span className={clsx("block truncate text-[12.75px] font-medium", selectedId === template.id ? "text-white" : "text-iusia-carbon")}>{template.name}</span><span className={clsx("mt-0.5 flex flex-wrap gap-x-2 text-[10.75px]", selectedId === template.id ? "text-white/65" : "text-iusia-mist-text")}><span>{TYPE_LABEL[template.document_type] ?? template.document_type}</span><span>v{template.version}</span><span>{template.status}</span></span></span></button>)}
        </div>
        </> : null}
      </section>
      <section className="min-w-0 bg-iusia-surface/45">
        {editor ? <TemplateEditor base={editor.base} onClose={() => setEditor(null)} /> : selected ? <TemplateInspector template={selected} superadmin={superadmin} onNewVersion={() => setEditor({ mode: "version", base: selected })} /> : <div className="flex min-h-[600px] flex-col items-center justify-center text-center"><FileSignature size={28} className="text-iusia-mist" /><p className="mt-3 text-[14px] font-medium text-iusia-navy">Selecciona una plantilla</p></div>}
      </section>
    </div>
  </div>;
}

function TemplateInspector({ template, superadmin, onNewVersion }: { template: TemplateRow; superadmin: boolean; onNewVersion: () => void }) {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const status = useMutation({ mutationFn: (value: "ACTIVE" | "INACTIVE" | "RETIRED") => api.setTemplateStatus(template.id, value), onSuccess: async (result) => { await Promise.all([queryClient.refetchQueries({ queryKey: ["admin-templates"] }), queryClient.refetchQueries({ queryKey: ["templates"] })]); setNotice(result.status === "ACTIVE" ? "Plantilla activada." : "Estado de plantilla actualizado."); }, onError: (error: Error) => setNotice(`No fue posible activar la plantilla. ${error.message}`) });
  return <div className="flex min-h-[calc(100vh-185px)] flex-col">
    <header className="border-b border-iusia-mist/20 bg-iusia-paper px-4 py-3">
      <div className="flex items-start gap-3"><div className="min-w-0 flex-1"><h2 className="text-[15px] font-semibold text-iusia-navy">{template.name}</h2><p className="mt-1 text-[12px] text-iusia-mist-text">{template.category} · {TYPE_LABEL[template.document_type] ?? template.document_type}</p><div className="mt-2 flex flex-wrap items-center gap-2"><StatusChip label={`v${template.version}`} tone="info" /><StatusChip label={template.status === "ACTIVE" ? "Activa" : template.status === "INACTIVE" ? "Inactiva" : "Retirada"} tone={template.status === "ACTIVE" ? "success" : template.status === "RETIRED" ? "warning" : "neutral"} /><StatusChip label="Institucional" tone="neutral" /></div></div><a href={api.templateContentUrl(template.id, true)} className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-iusia-mist/35 bg-iusia-paper px-2.5 text-[12px] font-medium text-iusia-navy hover:text-iusia-action"><Download size={13} /> Descargar</a></div>
      {template.description ? <p className="mt-3 max-w-[72ch] text-[12.5px] leading-relaxed text-iusia-carbon/75">{template.description}</p> : null}
      {superadmin ? <><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={onNewVersion}><History size={13} /> Nueva versión</Button>{template.status !== "ACTIVE" ? <Button size="sm" variant="secondary" onClick={() => { setNotice(null); status.mutate("ACTIVE"); }} disabled={status.isPending}><Power size={13} /> {status.isPending ? "Activando…" : "Activar"}</Button> : <Button size="sm" variant="secondary" onClick={() => status.mutate("INACTIVE")} disabled={status.isPending}><Power size={13} /> Desactivar</Button>}<Button size="sm" variant="secondary" onClick={() => status.mutate("RETIRED")} disabled={status.isPending || template.status === "RETIRED"}><Archive size={13} /> Retirar</Button></div>{notice ? <p role="status" className={clsx("mt-2 text-[12px]", status.isError ? "text-iusia-critical" : "text-iusia-success")}>{notice}</p> : null}</> : null}
    </header>
    <div className="min-h-0 flex-1 overflow-auto p-3"><FileViewer mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document" url={api.templateContentUrl(template.id)} name={template.original_filename ?? template.name} /></div>
  </div>;
}

function TemplateEditor({ base, onClose }: { base?: TemplateRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState(base?.name ?? "");
  const [documentType, setDocumentType] = useState(base?.document_type ?? "");
  const [category, setCategory] = useState(base?.category ?? "");
  const [description, setDescription] = useState(base?.description ?? "");
  const [activate, setActivate] = useState(true);
  const mutation = useMutation({
    mutationFn: () => api.createTemplate({ file: file!, name, documentType, category, description, familyId: base?.family_id, activate, variables: base?.variables ?? [] }),
    onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["admin-templates"] }), queryClient.invalidateQueries({ queryKey: ["templates"] })]); onClose(); },
  });
  const valid = Boolean(file && name.trim() && documentType.trim() && category.trim());
  return <div className="mx-auto max-w-3xl p-5">
    <div className="flex items-start justify-between"><div><h2 className="text-[17px] font-semibold text-iusia-navy">{base ? `Nueva versión de ${base.name}` : "Nueva plantilla oficial"}</h2><p className="mt-1 text-[12.5px] text-iusia-mist-text">El DOCX original se preserva; IUSIA crea una fuente operativa sin rediseñarlo.</p></div><button type="button" onClick={onClose} aria-label="Cerrar formulario" className="rounded-[7px] p-1.5 text-iusia-mist-text hover:bg-iusia-ice hover:text-iusia-navy"><X size={16} /></button></div>
    <form onSubmit={(event) => { event.preventDefault(); if (valid) mutation.mutate(); }} className="mt-5 space-y-4">
      <button type="button" onClick={() => input.current?.click()} className={clsx("flex w-full items-center gap-3 rounded-[12px] border border-dashed p-4 text-left transition-colors", file ? "border-iusia-success/45 bg-iusia-success/5" : "border-iusia-mist/45 bg-iusia-paper hover:border-iusia-action/45")}><span className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-iusia-navy text-iusia-intel">{file ? <Check size={16} /> : <Upload size={16} />}</span><span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium text-iusia-navy">{file?.name ?? "Seleccionar plantilla DOCX"}</span><span className="mt-0.5 block text-[11.5px] text-iusia-mist-text">Se conservarán membrete, estilos, tablas, márgenes y saltos compatibles.</span></span></button>
      <input ref={input} type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="hidden" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Nombre *"><input required value={name} onChange={(event) => setName(event.target.value)} className={inputClass} /></Field><Field label="Tipo documental *"><input required value={documentType} onChange={(event) => setDocumentType(event.target.value.toUpperCase())} placeholder="CONCEPTO_JURIDICO" className={inputClass} /></Field><Field label="Categoría *"><input required value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Conceptos" className={inputClass} /></Field><label className="flex items-center gap-2 self-end rounded-[9px] bg-iusia-paper px-3 py-2.5 text-[12px] text-iusia-carbon"><input type="checkbox" checked={activate} onChange={(event) => setActivate(event.target.checked)} className="accent-iusia-action" /> Activar al registrar</label></div>
      <Field label="Descripción y uso"><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className={inputClass + " resize-none py-2"} placeholder="Cuándo debe elegir IUSIA esta plantilla." /></Field>
      {mutation.isError ? <p className="text-[12px] text-iusia-critical">{mutation.error.message}</p> : null}
      <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={!valid || mutation.isPending}>{mutation.isPending ? "Registrando…" : base ? "Crear nueva versión" : "Registrar plantilla"}</Button></div>
    </form>
  </div>;
}

const inputClass = "mt-1 block h-9 w-full rounded-[8px] border border-iusia-mist/35 bg-iusia-paper px-3 text-[12.5px] text-iusia-carbon outline-none focus:ring-2 focus:ring-iusia-action/30";
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-[11.5px] font-medium text-iusia-carbon">{label}{children}</label>; }
