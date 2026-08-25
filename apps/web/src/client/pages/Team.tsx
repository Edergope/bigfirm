import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  StateBlock,
  StatusChip,
  ConfirmAction,
  FIRM_ROLE_PRESENTATION,
  firmRoleLabel,
} from "@iusia/ui";
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

export function Team() {
  const queryClient = useQueryClient();
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
      // API nativa del plugin organization: el servidor fija organización y token.
      const res = await authClient.organization.inviteMember({ email, role: role as never });
      if (res.error) throw new Error(res.error.message ?? "No fue posible invitar");
    },
    onSuccess: () => {
      setEmail("");
      setError(null);
      setNotice("Invitación creada. Si el envío de correo está configurado, ya está en camino.");
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
      <PageHeader
        title="Equipo"
        description="Miembros de la firma, invitaciones y roles. El acceso a cada expediente se administra por caso."
      />

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
        <ul className="divide-y divide-iusia-mist/20">
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

      <Card>
        <CardHeader
          title="Invitaciones pendientes"
          subtitle={
            pending.length === 0
              ? undefined
              : `${pending.length} ${pending.length === 1 ? "persona invitada" : "personas invitadas"} sin aceptar todavía`
          }
        />
        {pending.length === 0 ? (
          <StateBlock kind="empty" title="Sin invitaciones pendientes" />
        ) : (
          <ul className="divide-y divide-iusia-mist/20">
            {pending.map((i) => (
              <li key={i.id} className="flex items-center justify-between px-6 py-3">
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
                <span className="flex items-center gap-3">
                  <StatusChip label="Pendiente" tone="info" dot />
                  <ConfirmAction
                    label="Cancelar"
                    confirmLabel="Sí, cancelar"
                    pending={cancelInvite.isPending}
                    onConfirm={() => cancelInvite.mutate(i.id)}
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
        {historic.length > 0 ? (
          <ul className="divide-y divide-iusia-mist/15 border-t border-iusia-mist/20">
            {historic.map((i) => (
              <li key={i.id} className="flex items-center justify-between px-6 py-2.5">
                <span className="truncate text-[13px] text-iusia-mist-text">
                  {i.email} · {new Date(i.created_at).toLocaleDateString("es-CO")}
                </span>
                <StatusChip
                  label={i.status === "accepted" ? "Aceptada" : i.status === "expired" ? "Caducada" : "Cancelada"}
                  tone={i.status === "accepted" ? "success" : "neutral"}
                />
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    </div>
  );
}
