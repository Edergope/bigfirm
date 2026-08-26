import { firmRoleLabel } from "@iusia/domain";

export interface OrganizationInvitationEmailInput {
  organizationName: string;
  inviterName: string;
  role: string;
  inviteLink: string;
  expiresAt: Date;
}

export interface RenderedOrganizationInvitationEmail {
  subject: string;
  text: string;
  html: string;
}

/** Escapa cada valor dinámico antes de interpolarlo en el HTML del correo. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

export function formatInvitationExpiry(expiresAt: Date): string {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "America/Bogota",
  }).format(expiresAt);
}

/**
 * Correo transaccional compatible con clientes tradicionales: tablas e inline CSS,
 * sin imágenes obligatorias ni JavaScript. El texto queda disponible como fallback.
 */
export function renderOrganizationInvitationEmail(
  input: OrganizationInvitationEmailInput,
): RenderedOrganizationInvitationEmail {
  const organizationName = escapeHtml(input.organizationName);
  const inviterName = escapeHtml(input.inviterName);
  const roleLabel = escapeHtml(firmRoleLabel(input.role));
  const inviteLink = escapeHtml(input.inviteLink);
  const expiration = escapeHtml(formatInvitationExpiry(input.expiresAt));
  const subject = `${input.organizationName} te invitó a IUSIA`;
  const text = [
    `${input.inviterName} te invitó a trabajar en ${input.organizationName}.`,
    "",
    `Rol asignado: ${firmRoleLabel(input.role)}.`,
    "",
    `Aceptar invitación: ${input.inviteLink}`,
    "",
    `Esta invitación vence el ${formatInvitationExpiry(input.expiresAt)}.`,
    "",
    "Si no esperabas esta invitación, puedes ignorar este mensaje.",
  ].join("\n");

  const html = `<!doctype html>
<html lang="es"><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#eef2f7;color:#172033;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#eef2f7;"><tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 8px 24px rgba(18,32,56,.10);">
      <tr><td style="padding:30px 40px;background:#0b1f3a;color:#ffffff;">
        <div style="font-size:28px;line-height:32px;font-weight:700;letter-spacing:2px;">IUSIA</div>
        <div style="margin-top:5px;font-size:14px;line-height:20px;color:#dbe7f6;">Inteligencia jurídica</div>
      </td></tr>
      <tr><td style="padding:38px 40px 32px;">
        <h1 style="margin:0 0 16px;color:#0b1f3a;font-size:25px;line-height:32px;font-weight:700;">Te han invitado a trabajar en<br>${organizationName}</h1>
        <p style="margin:0 0 25px;font-size:16px;line-height:25px;color:#3c485d;">${inviterName} te ha invitado a IUSIA.</p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 28px;background:#f4f7fb;border-left:4px solid #1c5d99;"><tr><td style="padding:15px 18px;">
          <div style="font-size:12px;line-height:18px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;color:#5c6c82;">Rol asignado</div>
          <div style="margin-top:4px;font-size:17px;line-height:24px;font-weight:700;color:#0b1f3a;">${roleLabel}</div>
        </td></tr></table>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="border-radius:7px;background:#0f5ea8;">
          <a href="${inviteLink}" style="display:inline-block;padding:14px 23px;border-radius:7px;color:#ffffff;font-size:16px;line-height:20px;font-weight:700;text-decoration:none;">Aceptar invitación</a>
        </td></tr></table>
        <p style="margin:27px 0 0;font-size:14px;line-height:22px;color:#5c6c82;">Esta invitación vence el ${expiration}.</p>
      </td></tr>
      <tr><td style="padding:22px 40px;background:#f4f7fb;border-top:1px solid #dce4ef;">
        <p style="margin:0;font-size:13px;line-height:20px;color:#5c6c82;">Si no esperabas esta invitación, puedes ignorar este mensaje.</p>
        <p style="margin:13px 0 0;font-size:13px;line-height:20px;color:#0b1f3a;font-weight:700;">IUSIA <span style="font-weight:400;color:#5c6c82;">· Firma jurídica aumentada</span></p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  return { subject, text, html };
}
