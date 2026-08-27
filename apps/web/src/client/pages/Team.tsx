import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Card,
  CardHeader,
  Drawer,
  Field,
  Input,
  ScreenTitle,
  Select,
  Skeleton,
  StateBlock,
  StatusChip,
  ConfirmAction,
  FIRM_ROLE_PRESENTATION,
  firmRoleLabel,
  SectionLabel,
  Workspace,
  invitationTerm,
  matterActionLabel,
  matterRoleTerm,
} from "@iusia/ui";
import { MATTER_ROLES, matterActionsFor, type MatterRole } from "@iusia/domain";
import { FIRM_ROLES } from "@iusia/domain";
import { api, ApiError } from "../api.js";
import { authClient } from "../auth-client.js";

/**
 * Administración del equipo de la firma.
 *
 * La identidad, la membresía y las invitaciones las gobierna Better Auth; esta vista
 * sólo las opera. El acceso a cada expediente sigue decidiéndolo el ACL de IUSIA:
 * pertenecer a la firma no abre los casos por sí solo.
 */
function RoleOptions() {
  return (
    <>
      {FIRM_ROLES.map((r) => (
        <option key={r} value={r}>
          {firmRoleLabel(r)}
        </option>
      ))}
    </>
  );
}

const TEAM_TABS = [
  { id: "miembros", label: "Miembros" },
  { id: "invitaciones", label: "Invitaciones" },
  { id: "permisos", label: "Roles y permisos" },
  { id: "acceso", label: "Acceso a casos" },
] as const;
type TeamTab = (typeof TEAM_TABS)[number]["id"];

export function Team() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TeamTab>("miembros");
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const members = useQuery({ queryKey: ["firm-members"], queryFn: api.firmMembers });
  const invitations = useQuery({ queryKey: ["firm-invitations"], queryFn: api.firmInvitations });

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("LAWYER");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [memberNotice, setMemberNotice] = useState<string | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["firm-members"] });
    void queryClient.invalidateQueries({ queryKey: ["firm-invitations"] });
  };

  const invite = useMutation({
    mutationFn: async () => {
      // El servidor fija y autoriza la firma; el navegador nunca elige el tenant.
      return api.createFirmInvitation(email, role);
    },
    onSuccess: (result) => {
      setEmail("");
      setError(null);
      setNotice(
        result.delivery_status === "SENT"
          ? `Invitación enviada a ${result.invitation.email}.`
          : `Invitación creada para ${result.invitation.email}. El correo no pudo entregarse.`,
      );
      refresh();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "No fue posible invitar"),
  });

  const cancelInvite = useMutation({
    mutationFn: async (invitationId: string) => {
      const res = await authClient.organization.cancelInvitation({ invitationId });
      if (res.error) throw new Error(res.error.message ?? "No fue posible cancelar");
    },
    onSuccess: refresh,
  });

  const changeRole = useMutation({
    mutationFn: (v: { userId: string; role: string }) => api.setMemberRole(v.userId, v.role),
    onSuccess: (_res, v) => {
      setMemberError(null);
      setMemberNotice(`Rol actualizado a ${firmRoleLabel(v.role)}.`);
      refresh();
    },
    onError: (e: unknown) => {
      setMemberNotice(null);
      setMemberError(e instanceof ApiError ? e.message : "No fue posible cambiar el rol");
    },
  });

  const remove = useMutation({
    mutationFn: (userId: string) => api.removeMember(userId),
    onSuccess: () => {
      setMemberError(null);
      setMemberNotice("La persona ya no pertenece a la firma. Su acceso quedó revocado.");
      refresh();
    },
    onError: (e: unknown) => {
      setMemberNotice(null);
      setMemberError(e instanceof ApiError ? e.message : "No fue posible retirar");
    },
  });

  const isAdmin = me.data?.firm_role === "FIRM_DIRECTOR" || me.data?.firm_role === "PARTNER";

  if (me.isLoading || members.isLoading) {
    return <Skeleton className="h-64" />;
  }
  if (!isAdmin) {
    return (
      <Card>
        <StateBlock
          kind="error"
          title="Sin permisos de administración"
          hint="La administración del equipo corresponde a la dirección de la firma."
        />
      </Card>
    );
  }

  const pending = (invitations.data?.invitations ?? []).filter((i) => i.status === "pending");
  const historic = (invitations.data?.invitations ?? []).filter((i) => i.status !== "pending");

  return (
    <div className="flex flex-col gap-5">
      <ScreenTitle
        eyebrow="Administración"
        title="Equipo"
        description="Quién pertenece a la firma, qué puede hacer y a qué expedientes accede."
      />

      <div role="tablist" aria-label="Administración del equipo" className="flex gap-0.5 border-b border-iusia-line">
        {TEAM_TABS.map((t) => {
          const selected = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setTab(t.id)}
              className={
                selected
                  ? "-mb-px border-b-2 border-iusia-action px-3.5 py-2.5 text-[13.5px] font-medium text-iusia-navy"
                  : "px-3.5 py-2.5 text-[13.5px] text-iusia-mist-text transition-colors hover:text-iusia-carbon"
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "permisos" ? <PermissionModel /> : null}
      {tab === "acceso" ? <MatterAccess /> : null}

      <div className={tab === "invitaciones" ? "" : "hidden"}>
        <InvitationsPanel
          pending={pending}
          historic={historic}
          onCancel={(id) => cancelInvite.mutate(id)}
          cancelling={cancelInvite.isPending}
        />
      </div>

      <div className={tab === "miembros" ? "flex flex-col gap-5" : "hidden"}>
      <Card>
        <CardHeader title="Invitar a un miembro" subtitle="El acceso a IUSIA es sólo por invitación." />
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            setError(null);
            setNotice(null);
            if (email.trim()) invite.mutate();
          }}
          className="flex flex-wrap items-end gap-3 px-6 py-5"
        >
          <Field label="Correo" className="min-w-[240px] flex-1">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Rol en la firma">
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              <RoleOptions />
            </Select>
          </Field>
          <Button type="submit" disabled={invite.isPending || !email.trim()}>
            {invite.isPending ? "Invitando…" : "Invitar"}
          </Button>
          <p className="w-full text-[13px] text-iusia-mist-text">
            {FIRM_ROLE_PRESENTATION[role]?.hint}
          </p>
        </form>
        {error ? (
          <p role="alert" className="px-6 pb-4 text-[13.5px] text-iusia-critical">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="px-6 pb-4 text-[13.5px] text-iusia-mist-text">
            {notice}
          </p>
        ) : null}
      </Card>

      <Card>
        <CardHeader
          title="Miembros"
          subtitle="Pertenecer a la firma no abre los expedientes: el acceso a cada caso se administra por expediente."
          action={
            <StatusChip
              label={`${members.data?.members.length ?? 0} ${
                (members.data?.members.length ?? 0) === 1 ? "miembro" : "miembros"
              }`}
              tone="neutral"
            />
          }
        />
        {memberError ? (
          <p role="alert" className="mx-6 mb-3 rounded-[10px] border border-iusia-critical/35 bg-iusia-critical/8 px-4 py-2.5 text-[13.5px] text-iusia-critical">
            {memberError}
          </p>
        ) : null}
        {memberNotice ? (
          <p role="status" className="mx-6 mb-3 text-[13px] text-iusia-success-text">
            {memberNotice}
          </p>
        ) : null}
        <ul className="divide-y divide-iusia-line/70">
          {(members.data?.members ?? []).map((m) => {
            const isMe = m.userId === me.data?.user.id;
            return (
              <li key={m.userId} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[14.5px] text-iusia-carbon">{m.name}</span>
                    {isMe ? <StatusChip label="Tú" tone="neutral" /> : null}
                  </span>
                  <span className="block truncate text-[12.5px] text-iusia-mist-text">{m.email}</span>
                </span>
                <span className="flex items-center gap-3">
                  <Select
                    value={m.role}
                    aria-label={`Rol de ${m.name}`}
                    onChange={(e) => changeRole.mutate({ userId: m.userId, role: e.target.value })}
                    disabled={changeRole.isPending}
                  >
                    <RoleOptions />
                  </Select>
                  {/* Retirarse a sí mismo dejaría a la firma sin quien la administre
                      justo cuando se está administrando: el servidor ya lo impide,
                      aquí simplemente no se ofrece. */}
                  {isMe ? (
                    <span className="text-[13px] text-iusia-mist-text">—</span>
                  ) : (
                    <ConfirmAction
                      label="Retirar"
                      confirmLabel="Sí, retirar"
                      pending={remove.isPending}
                      onConfirm={() => remove.mutate(m.userId)}
                    />
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>

      </div>

    </div>
  );
}

/** Invitaciones: quién está pendiente de aceptar y qué pasó con las anteriores. */
function InvitationsPanel({
  pending,
  historic,
  onCancel,
  cancelling,
}: {
  pending: Array<{ id: string; email: string; role: string | null; expires_at: string }>;
  historic: Array<{ id: string; email: string; status: string; created_at: string }>;
  onCancel: (id: string) => void;
  cancelling: boolean;
}) {
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader
          title="Pendientes de aceptar"
          subtitle={
            pending.length === 0
              ? undefined
              : `${pending.length} ${pending.length === 1 ? "persona invitada" : "personas invitadas"} sin aceptar todavía`
          }
        />
        {pending.length === 0 ? (
          <StateBlock
            kind="empty"
            title="Sin invitaciones pendientes"
            hint="Invita desde la pestaña Miembros."
          />
        ) : (
          <ul className="divide-y divide-iusia-line">
            {pending.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <span className="min-w-0">
                  <span className="block truncate text-[14px] text-iusia-carbon">{i.email}</span>
                  <span className="block text-[12.5px] text-iusia-mist-text">
                    {firmRoleLabel(i.role ?? "")} · caduca el{" "}
                    {new Date(i.expires_at).toLocaleDateString("es-CO", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <StatusChip label="Pendiente" tone="info" dot />
                  <ConfirmAction
                    label="Cancelar"
                    confirmLabel="Sí, cancelar"
                    pending={cancelling}
                    onConfirm={() => onCancel(i.id)}
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {historic.length > 0 ? (
        <div>
          <SectionLabel>Historial</SectionLabel>
          <Card>
            <ul className="divide-y divide-iusia-line">
              {historic.map((i) => {
                const t = invitationTerm(i.status);
                return (
                  <li key={i.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <span className="truncate text-[13px] text-iusia-mist-text">
                      {i.email} · {new Date(i.created_at).toLocaleDateString("es-CO")}
                    </span>
                    <StatusChip label={t.label} tone={t.tone} />
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Modelo de permisos, leído del control de acceso real.
 *
 * Las capacidades NO se redactan aquí: se derivan de `matterActionsFor`, la misma
 * función que el servidor evalúa para autorizar. Si alguien cambia el modelo, esta
 * pantalla cambia con él; si se inventara una lista paralela, prometería accesos
 * que el servidor negaría.
 *
 * No hay editor granular porque el modelo es por rol: mostrar interruptores por
 * capacidad simularía un control que no existe.
 */
function PermissionModel() {
  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-[12px] border border-iusia-line bg-iusia-paper px-5 py-4">
        <p className="text-[14px] text-iusia-carbon">
          Los permisos se conceden por <strong className="font-semibold">rol</strong>, no
          capacidad por capacidad.
        </p>
        <p className="mt-1 text-[13px] text-iusia-mist-text">
          Pertenecer a la firma no abre ningún expediente: el acceso se concede caso por
          caso, y dentro de cada caso el rol determina qué puede hacer esa persona.
        </p>
      </div>

      <div>
        <SectionLabel>Rol en la firma</SectionLabel>
        <Card>
          <ul className="divide-y divide-iusia-line">
            {Object.entries(FIRM_ROLE_PRESENTATION).map(([role, p]) => (
              <li key={role} className="flex items-start gap-4 px-5 py-3">
                <span className="w-40 shrink-0 text-[14px] font-medium text-iusia-navy">
                  {p.label}
                </span>
                <span className="text-[13.5px] text-iusia-mist-text">{p.hint}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div>
        <SectionLabel>Rol dentro de un expediente</SectionLabel>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {MATTER_ROLES.map((role) => {
            const t = matterRoleTerm(role);
            const actions = matterActionsFor(role as MatterRole);
            return (
              <Card key={role}>
                <CardHeader title={t.label} subtitle={t.hint} />
                <ul className="flex flex-col gap-1.5 px-5 py-4">
                  {actions.map((a) => (
                    <li key={a} className="flex items-start gap-2 text-[13.5px] text-iusia-carbon">
                      <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-iusia-mist" />
                      {matterActionLabel(a)}
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Quién accede a qué expediente. Sólo lectura: el acceso se concede en el caso. */
function MatterAccess() {
  const access = useQuery({ queryKey: ["matter-access"], queryFn: api.matterAccess });
  const [managedMatterId, setManagedMatterId] = useState<string | null>(null);

  if (access.isLoading) return <Skeleton className="h-64" />;
  const rows = access.data?.matters ?? [];
  if (rows.length === 0) {
    return (
      <Card>
        <StateBlock kind="empty" title="Sin expedientes" hint="Aún no hay casos en la firma." />
      </Card>
    );
  }

  return (
    <Workspace>
      <ul className="divide-y divide-iusia-line">
        {rows.map((m) => (
          <li key={m.matter_id} className="px-5 py-3.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-medium text-iusia-navy">
                  {m.title}
                </span>
                <span className="block text-[12px] text-iusia-mist-text tnum">{m.reference}</span>
              </span>
              <span className="shrink-0 text-[12.5px] text-iusia-mist-text tnum">
                {m.members.length} con acceso
              </span>
            </div>
            {m.members.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
                {m.members.map((mem) => (
                  <li key={mem.user_id} className="flex items-center gap-2 text-[13px]">
                    <span className="text-iusia-carbon">{mem.name}</span>
                    <StatusChip label={matterRoleTerm(mem.role).label} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-[13px] text-iusia-mist-text">
                Nadie tiene acceso todavía.
              </p>
            )}
            <Button size="sm" variant="secondary" className="mt-3" onClick={() => setManagedMatterId(m.matter_id)}>
              Gestionar equipo
            </Button>
          </li>
        ))}
      </ul>
      {managedMatterId ? <MatterTeamDrawer matterId={managedMatterId} onClose={() => setManagedMatterId(null)} /> : null}
    </Workspace>
  );
}

export function MatterTeamDrawer({ matterId, onClose }: { matterId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const team = useQuery({ queryKey: ["matter-team", matterId], queryFn: () => api.matterTeam(matterId) });
  const [leadId, setLeadId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [memberRole, setMemberRole] = useState("COLLABORATOR");
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["matter-team", matterId] });
    void queryClient.invalidateQueries({ queryKey: ["matter-access"] });
  };
  const lead = useMutation({ mutationFn: () => api.assignMatterLead(matterId, leadId), onSuccess: refresh });
  const add = useMutation({ mutationFn: () => api.addMatterMember(matterId, memberId, memberRole), onSuccess: refresh });
  const revoke = useMutation({ mutationFn: (userId: string) => api.revokeMatterMember(matterId, userId), onSuccess: refresh });
  const people = team.data?.firm_members ?? [];
  const leadCandidates = people.filter((p) => ["LAWYER", "PARTNER", "FIRM_DIRECTOR"].includes(p.role));
  return <Drawer open onClose={onClose} title="Equipo del expediente" width={560}>
    {team.isLoading ? <Skeleton className="h-48" /> : <div className="flex flex-col gap-5">
      <section><h3 className="text-[13px] font-semibold text-iusia-navy">Abogado líder</h3><p className="mt-1 text-[12px] text-iusia-mist-text">Sólo una persona lidera el expediente. El líder anterior queda como colaborador.</p>
        <div className="mt-3 flex gap-2"><Select value={leadId} onChange={(e) => setLeadId(e.target.value)} className="min-w-0 flex-1"><option value="">Seleccionar abogado…</option>{leadCandidates.map((p) => <option key={p.userId} value={p.userId}>{p.name} · {p.email}</option>)}</Select><ConfirmAction label="Asignar líder" confirmLabel="Sí, reemplazar líder" pending={lead.isPending} disabled={!leadId} onConfirm={() => lead.mutate()} /></div>
      </section>
      <section><h3 className="text-[13px] font-semibold text-iusia-navy">Agregar miembro</h3><div className="mt-3 grid gap-2 sm:grid-cols-[1fr_150px_auto]"><Select value={memberId} onChange={(e) => setMemberId(e.target.value)}><option value="">Seleccionar persona…</option>{people.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}</Select><Select value={memberRole} onChange={(e) => setMemberRole(e.target.value)}>{MATTER_ROLES.filter((r) => r !== "OWNER").map((r) => <option key={r} value={r}>{matterRoleTerm(r).label}</option>)}</Select><Button size="sm" disabled={!memberId || add.isPending} onClick={() => add.mutate()}>Agregar</Button></div></section>
      <section><h3 className="text-[13px] font-semibold text-iusia-navy">Miembros con acceso</h3><ul className="mt-2 divide-y divide-iusia-line rounded-[10px] border border-iusia-line">{(team.data?.members ?? []).map((p) => <li key={p.userId} className="flex items-center gap-3 px-3 py-2.5"><span className="min-w-0 flex-1"><span className="block truncate text-[13px] text-iusia-carbon">{p.name}</span><span className="block text-[11.5px] text-iusia-mist-text">{matterRoleTerm(p.role).label}</span></span>{p.role === "OWNER" ? <span className="text-[11.5px] text-iusia-mist-text">Líder</span> : <ConfirmAction label="Retirar" confirmLabel="Sí, retirar" pending={revoke.isPending} onConfirm={() => revoke.mutate(p.userId)} />}</li>)}</ul></section>
      {lead.error || add.error || revoke.error ? <p role="alert" className="text-[12px] text-iusia-critical">{(lead.error ?? add.error ?? revoke.error)?.message}</p> : null}
    </div>}
  </Drawer>;
}
