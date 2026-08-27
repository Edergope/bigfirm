import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check, ChevronDown, ChevronRight, Download, File, FileArchive, FileAudio,
  FileImage, FileSpreadsheet, FileText, FileVideo, FolderClosed, FolderOpen,
  History, LoaderCircle, Maximize2, Minus, Plus, RefreshCw, Search, Upload, X,
} from "lucide-react";
import clsx from "clsx";
import { Button, ScreenTitle, Skeleton, StatusChip } from "@iusia/ui";
import { api, type DocumentEntry } from "../api.js";

type FolderFilter = "uploaded" | "generated";
type UploadState = { id: string; name: string; size: number; status: "uploading" | "success" | "error"; message?: string };

const CHANGE_TYPES = ["Corrección", "Revisión jurídica", "Comentarios del cliente", "Versión para firma", "Documento firmado", "Otro"] as const;

export function Documents() {
  const queryClient = useQueryClient();
  const matters = useQuery({ queryKey: ["matters"], queryFn: api.listMatters });
  const [matterId, setMatterId] = useState("");
  const [folder, setFolder] = useState<FolderFilter>("uploaded");
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!matterId && matters.data?.matters[0]) setMatterId(matters.data.matters[0].id);
  }, [matterId, matters.data]);

  const workspace = useQuery({
    queryKey: ["matter-workspace", matterId],
    queryFn: () => api.matterWorkspace(matterId),
    enabled: Boolean(matterId),
  });
  const documents = workspace.data?.[folder] ?? [];
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("es");
    return needle ? documents.filter((doc) => doc.name.toLocaleLowerCase("es").includes(needle)) : documents;
  }, [documents, query]);

  useEffect(() => {
    if (!filtered.some((doc) => doc.id === selectedId)) setSelectedId(filtered[0]?.id ?? "");
  }, [filtered, selectedId]);
  const selected = documents.find((doc) => doc.id === selectedId) ?? null;

  async function uploadFiles(fileList: FileList | File[]) {
    if (!matterId) return;
    const files = Array.from(fileList);
    const queued = files.map((file) => ({ id: crypto.randomUUID(), name: file.name, size: file.size, status: "uploading" as const }));
    setUploads((current) => [...queued, ...current].slice(0, 12));
    await Promise.all(files.map(async (file, index) => {
      const id = queued[index]!.id;
      try {
        const result = await api.uploadDocuments(matterId, [file]);
        const item = result.uploaded[0];
        if (!item || item.status === "UPLOAD_FAILED" || item.status === "UNSUPPORTED") {
          throw new Error(item?.status === "UNSUPPORTED" ? "Formato no admitido" : "No fue posible subirlo");
        }
        setUploads((current) => current.map((row) => row.id === id ? { ...row, status: "success", message: "Guardado" } : row));
      } catch (error) {
        setUploads((current) => current.map((row) => row.id === id ? { ...row, status: "error", message: error instanceof Error ? error.message : "Error de subida" } : row));
      }
    }));
    await queryClient.invalidateQueries({ queryKey: ["matter-workspace", matterId] });
  }

  const selectedMatter = matters.data?.matters.find((matter) => matter.id === matterId);
  return (
    <div className="flex min-h-0 flex-col pb-2">
      <ScreenTitle eyebrow="Expediente digital" title="Documentos" description="Consulta, previsualiza y versiona los archivos de los expedientes a los que tienes acceso." />
      <div className="grid min-h-[calc(100vh-185px)] overflow-hidden rounded-[var(--radius-lg)] bg-iusia-paper shadow-[var(--shadow-surface)] lg:grid-cols-[190px_minmax(250px,0.48fr)_minmax(0,1.35fr)]">
        <aside className="border-b border-iusia-mist/25 bg-iusia-ice/45 p-3 lg:border-b-0 lg:border-r" aria-label="Expedientes autorizados">
          <div className="flex items-center justify-between px-2 pb-3 pt-1">
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-iusia-mist-text">Expedientes</h2>
            <span className="text-[11px] tabular-nums text-iusia-mist-text">{matters.data?.matters.length ?? 0}</span>
          </div>
          {matters.isLoading ? <Skeleton className="h-28" /> : (
            <div className="flex gap-1 overflow-x-auto pb-1 lg:block lg:overflow-visible">
              {(matters.data?.matters ?? []).map((matter) => {
                const active = matter.id === matterId;
                return <div key={matter.id} className="min-w-[210px] lg:min-w-0">
                  <button type="button" onClick={() => { setMatterId(matter.id); setSelectedId(""); }} className={clsx("flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-left text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-iusia-action/40", active ? "bg-iusia-navy text-white" : "text-iusia-carbon hover:bg-iusia-paper")}>
                    {active ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<span className="min-w-0 flex-1 truncate">{matter.title}</span>
                  </button>
                  {active ? <div className="ml-4 mt-1 space-y-0.5 border-l border-iusia-mist/30 pl-2">
                    <FolderButton active={folder === "uploaded"} onClick={() => setFolder("uploaded")} label="Aportados" />
                    <FolderButton active={folder === "generated"} onClick={() => setFolder("generated")} label="Generados por IUSIA" />
                  </div> : null}
                </div>;
              })}
            </div>
          )}
        </aside>

        <section className="flex min-h-[420px] min-w-0 flex-col border-b border-iusia-mist/25 lg:border-b-0 lg:border-r" aria-label="Documentos del expediente">
          <div className="border-b border-iusia-mist/20 p-3">
            <p className="truncate text-[14px] font-semibold text-iusia-navy">{selectedMatter?.title ?? "Selecciona un expediente"}</p>
            <p className="mt-0.5 text-[11.5px] text-iusia-mist-text">{folder === "uploaded" ? "01 Documentos aportados" : "02 Documentos generados por IUSIA"}</p>
            <label className="mt-3 flex h-9 items-center gap-2 rounded-[9px] bg-iusia-ice/70 px-3 text-iusia-mist-text focus-within:ring-2 focus-within:ring-iusia-action/30">
              <Search size={14} aria-hidden /><span className="sr-only">Buscar archivos</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar en este expediente" className="min-w-0 flex-1 bg-transparent text-[13px] text-iusia-carbon outline-none placeholder:text-iusia-mist-text" />
              {query ? <button type="button" onClick={() => setQuery("")} aria-label="Limpiar búsqueda"><X size={13} /></button> : null}
            </label>
          </div>
          {folder === "uploaded" ? <div onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); void uploadFiles(event.dataTransfer.files); }} className={clsx("m-3 rounded-[12px] border border-dashed px-3 py-3 transition-colors", dragging ? "border-iusia-action bg-iusia-action/5" : "border-iusia-mist/45 bg-iusia-ice/25")}>
            <div className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-iusia-navy text-iusia-intel"><Upload size={15} /></span><div className="min-w-0 flex-1"><p className="text-[12.5px] font-medium text-iusia-navy">Nuevo documento</p><p className="text-[11px] text-iusia-mist-text">Crea un documento v1 · hasta 50 MB</p></div><Button size="sm" onClick={() => fileInput.current?.click()}><Upload size={13} /> Subir documento</Button><input ref={fileInput} type="file" multiple className="hidden" onChange={(event) => { if (event.target.files) void uploadFiles(event.target.files); event.target.value = ""; }} /></div>
            {uploads.length > 0 ? <div className="mt-3 space-y-1.5 border-t border-iusia-mist/20 pt-2.5">{uploads.slice(0, 4).map((item) => <UploadRow key={item.id} item={item} />)}</div> : null}
          </div> : null}
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {workspace.isLoading ? <Skeleton className="m-2 h-36" /> : filtered.length === 0 ? <div className="flex h-40 flex-col items-center justify-center px-6 text-center"><FolderClosed size={25} className="text-iusia-mist" /><p className="mt-2 text-[13px] font-medium text-iusia-navy">{query ? "No hay coincidencias" : "Esta carpeta está vacía"}</p><p className="mt-1 text-[12px] text-iusia-mist-text">{query ? "Prueba otro nombre de archivo." : folder === "uploaded" ? "Sube los primeros documentos del expediente." : "Los entregables de IUSIA aparecerán aquí."}</p></div> : filtered.map((doc) => <DocumentRow key={doc.id} document={doc} active={doc.id === selectedId} onClick={() => setSelectedId(doc.id)} />)}
          </div>
        </section>

        <section className="min-h-[calc(100vh-185px)] min-w-0 bg-iusia-surface/45" aria-label="Vista previa">
          {selected && matterId ? <DocumentInspector matterId={matterId} document={selected} /> : <div className="flex h-full min-h-[520px] flex-col items-center justify-center px-8 text-center"><FileArchive size={28} className="text-iusia-mist" /><p className="mt-3 text-[14px] font-medium text-iusia-navy">Selecciona un documento</p><p className="mt-1 max-w-sm text-[12.5px] leading-relaxed text-iusia-mist-text">La vista previa, las versiones y las acciones aparecerán aquí.</p></div>}
        </section>
      </div>
    </div>
  );
}

function FolderButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return <button type="button" onClick={onClick} className={clsx("flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[12px] transition-colors", active ? "bg-iusia-paper font-medium text-iusia-navy" : "text-iusia-mist-text hover:text-iusia-navy")}>{active ? <FolderOpen size={13} /> : <FolderClosed size={13} />}<span>{label}</span></button>;
}

function UploadRow({ item }: { item: UploadState }) {
  return <div className="flex items-center gap-2 text-[11.5px]">{item.status === "uploading" ? <LoaderCircle size={13} className="animate-spin text-iusia-action motion-reduce:animate-none" /> : item.status === "success" ? <Check size={13} className="text-iusia-success" /> : <X size={13} className="text-iusia-critical" />}<span className="min-w-0 flex-1 truncate text-iusia-carbon">{item.name}</span><span className={item.status === "error" ? "text-iusia-critical" : "text-iusia-mist-text"}>{item.status === "uploading" ? "Subiendo…" : item.message}</span></div>;
}

function DocumentRow({ document, active, onClick }: { document: DocumentEntry; active: boolean; onClick: () => void }) {
  const Icon = fileIcon(document.mime_type);
  const intelligence = humanIngestion(document.ingestion_status);
  return <button type="button" onClick={onClick} className={clsx("mb-1 flex w-full items-center gap-3 rounded-[10px] px-2.5 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-iusia-action/35", active ? "bg-iusia-navy text-white" : "hover:bg-iusia-ice/70")}><Icon size={18} className={active ? "text-iusia-intel" : "text-iusia-action"} /><span className="min-w-0 flex-1"><span className={clsx("block truncate text-[12.75px] font-medium", active ? "text-white" : "text-iusia-carbon")}>{document.name}</span><span className={clsx("mt-0.5 flex items-center gap-2 text-[10.75px]", active ? "text-white/65" : "text-iusia-mist-text")}><span>v{document.current_version}</span><span aria-hidden>·</span><span>{intelligence.label}</span></span></span></button>;
}

function DocumentInspector({ matterId, document }: { matterId: string; document: DocumentEntry }) {
  const queryClient = useQueryClient();
  const [version, setVersion] = useState(document.current_version);
  const [showVersionForm, setShowVersionForm] = useState(false);
  useEffect(() => { setVersion(document.current_version); setShowVersionForm(false); }, [document.id, document.current_version]);
  const versions = useQuery({ queryKey: ["document-versions", matterId, document.id], queryFn: () => api.documentVersions(matterId, document.id) });
  const selectedVersion = versions.data?.versions.find((item) => item.version_number === version);
  const currentStatus = humanIngestion(selectedVersion?.ingestion_status ?? document.ingestion_status);
  const contentUrl = api.documentContentUrl(matterId, document.id, version);
  const downloadUrl = api.documentContentUrl(matterId, document.id, version, true);
  return <div className="flex h-full min-h-[calc(100vh-185px)] flex-col">
    <header className="border-b border-iusia-mist/20 bg-iusia-paper px-4 py-3">
      <div className="flex items-start gap-3"><div className="min-w-0 flex-1"><h2 className="truncate text-[14px] font-semibold text-iusia-navy">{selectedVersion?.filename ?? document.name}</h2><div className="mt-1.5 flex flex-wrap items-center gap-2"><StatusChip label={`v${version}${version === document.current_version ? " · vigente" : ""}`} tone={version === document.current_version ? "info" : "neutral"} /><StatusChip label={currentStatus.label} tone={currentStatus.tone} /><span className="text-[11.5px] text-iusia-mist-text">{formatBytes(selectedVersion?.size_bytes ?? document.size_bytes)}</span></div></div><a href={downloadUrl} className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-iusia-mist/35 bg-iusia-paper px-2.5 text-[12px] font-medium text-iusia-navy transition-colors hover:border-iusia-action/40 hover:text-iusia-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iusia-action/35"><Download size={13} /> Descargar</a></div>
      <div className="mt-3 flex items-center gap-2"><label className="flex items-center gap-1.5 text-[11.5px] text-iusia-mist-text"><History size={13} /> Versión<select value={version} onChange={(event) => setVersion(Number(event.target.value))} className="rounded-[7px] border border-iusia-mist/35 bg-iusia-paper px-2 py-1 text-[12px] font-medium text-iusia-navy outline-none focus:ring-2 focus:ring-iusia-action/30">{(versions.data?.versions ?? [{ version_number: document.current_version }]).map((item) => <option key={item.version_number} value={item.version_number}>v{item.version_number}{item.version_number === document.current_version ? " — vigente" : ""}</option>)}</select></label><Button size="sm" variant="secondary" onClick={() => setShowVersionForm((value) => !value)}><RefreshCw size={13} /> Subir nueva versión</Button></div>
      {selectedVersion && version !== document.current_version ? <p className="mt-2 text-[11.5px] text-iusia-mist-text">{selectedVersion.change_type} · {selectedVersion.change_summary}</p> : null}
    </header>
    {showVersionForm ? <VersionForm matterId={matterId} documentId={document.id} onDone={async () => { setShowVersionForm(false); await Promise.all([queryClient.invalidateQueries({ queryKey: ["document-versions", matterId, document.id] }), queryClient.invalidateQueries({ queryKey: ["matter-workspace", matterId] })]); }} /> : null}
    <div className="min-h-0 flex-1 overflow-auto p-3"><FileViewer mime={selectedVersion?.mime_type ?? document.mime_type} url={contentUrl} name={selectedVersion?.filename ?? document.name} /></div>
  </div>;
}

function VersionForm({ matterId, documentId, onDone }: { matterId: string; documentId: string; onDone: () => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [changeType, setChangeType] = useState("");
  const [summary, setSummary] = useState("");
  const mutation = useMutation({ mutationFn: () => api.uploadDocumentVersion(matterId, documentId, { file: file!, changeType, changeSummary: summary }), onSuccess: onDone });
  const valid = Boolean(file && changeType && summary.trim());
  return <form onSubmit={(event) => { event.preventDefault(); if (valid) mutation.mutate(); }} className="border-b border-iusia-mist/20 bg-iusia-ice/55 px-4 py-3"><div className="grid gap-2 sm:grid-cols-2"><label className="text-[11.5px] font-medium text-iusia-carbon">Archivo *<input type="file" required onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="mt-1 block w-full text-[11.5px] text-iusia-mist-text file:mr-2 file:rounded-[7px] file:border-0 file:bg-iusia-paper file:px-2 file:py-1.5 file:text-[11.5px] file:font-medium file:text-iusia-navy" /></label><label className="text-[11.5px] font-medium text-iusia-carbon">Tipo de modificación *<select required value={changeType} onChange={(event) => setChangeType(event.target.value)} className="mt-1 block h-8 w-full rounded-[8px] border border-iusia-mist/35 bg-iusia-paper px-2 text-[12px] outline-none focus:ring-2 focus:ring-iusia-action/30"><option value="">Seleccionar…</option>{CHANGE_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label></div><label className="mt-2 block text-[11.5px] font-medium text-iusia-carbon">Descripción de cambios *<textarea required value={summary} onChange={(event) => setSummary(event.target.value)} rows={2} className="mt-1 block w-full resize-none rounded-[8px] border border-iusia-mist/35 bg-iusia-paper px-2.5 py-2 text-[12px] outline-none focus:ring-2 focus:ring-iusia-action/30" placeholder="Resume qué cambió y por qué." /></label>{mutation.isError ? <p className="mt-2 text-[11.5px] text-iusia-critical">{mutation.error.message}</p> : null}<div className="mt-2 flex justify-end"><Button size="sm" disabled={!valid || mutation.isPending} type="submit">{mutation.isPending ? "Guardando…" : "Crear nueva versión"}</Button></div></form>;
}

export function FileViewer({ mime, url, name }: { mime: string; url: string; name: string }) {
  const [fit, setFit] = useState(true);
  const [zoom, setZoom] = useState(100);
  const decrease = () => { setFit(false); setZoom((value) => Math.max(50, value - 10)); };
  const increase = () => { setFit(false); setZoom((value) => Math.min(180, value + 10)); };
  const useFit = () => setFit(true);
  if (mime === "application/pdf") {
    const base = url.split("#")[0]!;
    const src = `${base}#zoom=${fit ? "page-width" : zoom}`;
    return <ViewerFrame fit={fit} zoom={zoom} onDecrease={decrease} onIncrease={increase} onFit={useFit}><iframe src={src} title={`Vista previa de ${name}`} className="h-[calc(100vh-285px)] min-h-[620px] w-full rounded-b-[10px] bg-iusia-paper" /></ViewerFrame>;
  }
  if (mime.startsWith("image/")) return <div className="flex min-h-[420px] items-center justify-center rounded-[10px] bg-iusia-paper p-4 shadow-[var(--shadow-surface)]"><img src={url} alt={`Vista previa de ${name}`} className="max-h-[620px] max-w-full object-contain" /></div>;
  if (mime.startsWith("video/")) return <div className="flex min-h-[420px] items-center rounded-[10px] bg-iusia-navy p-3"><video src={url} controls className="max-h-[620px] w-full" aria-label={`Vista previa de ${name}`} /></div>;
  if (mime.startsWith("audio/")) return <div className="flex min-h-[220px] items-center justify-center rounded-[10px] bg-iusia-paper p-8 shadow-[var(--shadow-surface)]"><audio src={url} controls className="w-full" aria-label={`Vista previa de ${name}`} /></div>;
  if (mime.includes("wordprocessingml") || mime === "application/msword") return <ViewerFrame fit={fit} zoom={zoom} onDecrease={decrease} onIncrease={increase} onFit={useFit}><DocxViewer url={url} fit={fit} zoom={zoom} /></ViewerFrame>;
  if (mime.includes("spreadsheet") || mime === "application/vnd.ms-excel" || mime === "text/csv") return <SpreadsheetViewer url={url} />;
  if (mime.startsWith("text/") || ["application/json", "application/xml"].includes(mime)) return <TextViewer url={url} />;
  return <div className="flex min-h-[360px] flex-col items-center justify-center rounded-[10px] bg-iusia-paper px-8 text-center shadow-[var(--shadow-surface)]"><FileArchive size={28} className="text-iusia-mist" /><p className="mt-3 text-[14px] font-medium text-iusia-navy">Vista previa no disponible para este formato.</p><p className="mt-1 text-[12.5px] text-iusia-mist-text">Puedes descargar el archivo y abrirlo con su aplicación habitual.</p></div>;
}

function ViewerFrame({ children, fit, zoom, onDecrease, onIncrease, onFit }: { children: React.ReactNode; fit: boolean; zoom: number; onDecrease: () => void; onIncrease: () => void; onFit: () => void }) {
  return <div className="overflow-hidden rounded-[10px] bg-iusia-paper shadow-[var(--shadow-surface)]">
    <div className="flex h-10 items-center justify-between border-b border-iusia-mist/20 bg-iusia-paper px-2.5">
      <div className="flex items-center gap-1">
        <button type="button" onClick={onDecrease} aria-label="Reducir zoom" className="inline-flex h-7 w-7 items-center justify-center rounded-[7px] text-iusia-mist-text transition-colors hover:bg-iusia-ice hover:text-iusia-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iusia-action/35"><Minus size={14} /></button>
        <button type="button" onClick={onFit} className={clsx("inline-flex h-7 items-center gap-1.5 rounded-[7px] px-2 text-[11.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iusia-action/35", fit ? "bg-iusia-navy text-white" : "text-iusia-navy hover:bg-iusia-ice")}><Maximize2 size={13} /> {fit ? "Fit" : `${zoom}%`}</button>
        <button type="button" onClick={onIncrease} aria-label="Aumentar zoom" className="inline-flex h-7 w-7 items-center justify-center rounded-[7px] text-iusia-mist-text transition-colors hover:bg-iusia-ice hover:text-iusia-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iusia-action/35"><Plus size={14} /></button>
      </div>
      <span className="text-[11px] text-iusia-mist-text">Vista previa</span>
    </div>
    {children}
  </div>;
}

function DocxViewer({ url, fit, zoom }: { url: string; fit: boolean; zoom: number }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [fitScale, setFitScale] = useState(1);
  const [scaledHeight, setScaledHeight] = useState<number | null>(null);
  const [scaledWidth, setScaledWidth] = useState<number | null>(null);
  const [renderTick, setRenderTick] = useState(0);
  useEffect(() => { let active = true; setError(""); setRenderTick(0); void (async () => { try { const [blob, viewer] = await Promise.all([fetch(url, { credentials: "include" }).then((res) => { if (!res.ok) throw new Error("No fue posible abrir el DOCX"); return res.blob(); }), import("docx-preview")]); if (active && ref.current) { ref.current.innerHTML = ""; await viewer.renderAsync(blob, ref.current, undefined, { className: "iusia-docx", inWrapper: true, ignoreWidth: false, ignoreHeight: false }); setRenderTick((value) => value + 1); } } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "No fue posible abrir el DOCX"); } })(); return () => { active = false; }; }, [url]);
  useEffect(() => {
    const update = () => {
      const outer = outerRef.current;
      const content = ref.current;
      const page = content?.querySelector("section") as HTMLElement | null;
      if (!outer || !content || !page) return;
      const available = Math.max(320, outer.clientWidth - 32);
      const pageWidth = page.offsetWidth || page.getBoundingClientRect().width || available;
      const nextScale = fit ? Math.min(1, available / pageWidth) : zoom / 100;
      setFitScale(nextScale);
      setScaledHeight(Math.ceil(content.scrollHeight * nextScale));
      setScaledWidth(Math.ceil(content.scrollWidth * nextScale));
    };
    update();
    const observer = new ResizeObserver(update);
    if (outerRef.current) observer.observe(outerRef.current);
    if (ref.current) observer.observe(ref.current);
    const timers = [150, 500, 1200].map((delay) => window.setTimeout(update, delay));
    return () => { observer.disconnect(); timers.forEach((timer) => window.clearTimeout(timer)); };
  }, [fit, zoom, url, error, renderTick]);
  if (error) return <ViewerError message={error} />;
  return <div ref={outerRef} className="h-[calc(100vh-285px)] min-h-[620px] overflow-auto bg-[#e7e8eb] p-4">
    <div className="mx-auto" style={{ height: scaledHeight ?? undefined, width: scaledWidth ?? undefined }}>
      <div ref={ref} className="w-fit origin-top-left [&_.iusia-docx-wrapper]:bg-transparent [&_.iusia-docx-wrapper]:p-0 [&_section]:mx-auto [&_section]:shadow-[0_8px_28px_-12px_rgba(11,29,58,0.28)]" style={{ transform: `scale(${fitScale})` }} />
    </div>
  </div>;
}

function SpreadsheetViewer({ url }: { url: string }) {
  const [rows, setRows] = useState<unknown[][] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { let active = true; void (async () => { try { const [buffer, XLSX] = await Promise.all([fetch(url, { credentials: "include" }).then((res) => { if (!res.ok) throw new Error("No fue posible abrir la hoja"); return res.arrayBuffer(); }), import("xlsx")]); const workbook = XLSX.read(buffer, { type: "array" }); const sheet = workbook.Sheets[workbook.SheetNames[0]!]; const data = sheet ? XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false }) : []; if (active) setRows(data.slice(0, 500)); } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "No fue posible abrir la hoja"); } })(); return () => { active = false; }; }, [url]);
  if (error) return <ViewerError message={error} />;
  if (!rows) return <Skeleton className="h-64" />;
  return <div className="max-h-[650px] overflow-auto rounded-[10px] bg-iusia-paper shadow-[var(--shadow-surface)]"><table className="min-w-full border-collapse text-[12px]"><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex} className={rowIndex === 0 ? "sticky top-0 bg-iusia-navy font-medium text-white" : "even:bg-iusia-ice/50"}>{row.map((cell, cellIndex) => <td key={cellIndex} className="whitespace-nowrap border-b border-r border-iusia-mist/20 px-2.5 py-2">{String(cell ?? "")}</td>)}</tr>)}</tbody></table></div>;
}

function TextViewer({ url }: { url: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { let active = true; void fetch(url, { credentials: "include" }).then((res) => { if (!res.ok) throw new Error("No fue posible abrir el archivo"); return res.text(); }).then((value) => { if (active) setText(value); }).catch((cause: Error) => { if (active) setError(cause.message); }); return () => { active = false; }; }, [url]);
  if (error) return <ViewerError message={error} />;
  if (text === null) return <Skeleton className="h-64" />;
  return <pre className="min-h-[420px] whitespace-pre-wrap break-words rounded-[10px] bg-iusia-paper p-5 font-sans text-[13px] leading-relaxed text-iusia-carbon shadow-[var(--shadow-surface)]">{text}</pre>;
}

function ViewerError({ message }: { message: string }) { return <div className="flex min-h-[320px] flex-col items-center justify-center rounded-[10px] bg-iusia-paper px-8 text-center shadow-[var(--shadow-surface)]"><X size={25} className="text-iusia-critical" /><p className="mt-2 text-[13px] font-medium text-iusia-navy">No se pudo cargar la vista previa</p><p className="mt-1 text-[12px] text-iusia-mist-text">{message}. Descarga el archivo para abrirlo.</p></div>; }

function fileIcon(mime: string) { if (mime.startsWith("image/")) return FileImage; if (mime.startsWith("video/")) return FileVideo; if (mime.startsWith("audio/")) return FileAudio; if (mime.includes("spreadsheet") || mime === "text/csv" || mime === "application/vnd.ms-excel") return FileSpreadsheet; if (mime === "application/pdf" || mime.includes("word") || mime.startsWith("text/")) return FileText; return File; }
function humanIngestion(status: string): { label: string; tone: "success" | "warning" | "neutral" | "critical" | "info" } { if (status === "AI_INDEXED") return { label: "Indexado por IUSIA", tone: "success" }; if (status === "PROCESSING") return { label: "Procesando", tone: "info" }; if (status === "NOT_INDEXABLE") return { label: "No indexable", tone: "neutral" }; if (status === "ERROR") return { label: "Error de procesamiento", tone: "critical" }; return { label: "Disponible", tone: "neutral" }; }
function formatBytes(value: number | null | undefined) { if (value == null) return "Tamaño no disponible"; if (value < 1024) return `${value} B`; if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`; return `${(value / 1024 / 1024).toFixed(1)} MB`; }
