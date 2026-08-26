import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  renderOrganizationInvitationEmail,
} from "../auth/organization-invitation-email.js";

describe("renderOrganizationInvitationEmail", () => {
  const rendered = renderOrganizationInvitationEmail({
    organizationName: "Pisoso Legal",
    inviterName: "Eder González",
    role: "LAWYER",
    inviteLink: "https://iusia.test/invitacion?invitationId=inv_abc",
    expiresAt: new Date("2026-08-30T18:00:00.000Z"),
  });

  it("incluye asunto, datos humanos, CTA, vencimiento y fallback de texto", () => {
    expect(rendered.subject).toBe("Pisoso Legal te invitó a IUSIA");
    expect(rendered.text).toContain("Eder González");
    expect(rendered.text).toContain("Abogado");
    expect(rendered.text).toContain("https://iusia.test/invitacion?invitationId=inv_abc");
    expect(rendered.text).toContain("Esta invitación vence el");
    expect(rendered.html).toContain("Aceptar invitación");
    expect(rendered.html).toContain("IUSIA");
    expect(rendered.html).toContain("max-width:600px");
  });

  it("escapa valores dinámicos antes de insertarlos en HTML", () => {
    const unsafe = renderOrganizationInvitationEmail({
      organizationName: "<Admin & Partner>",
      inviterName: 'Ana "<script>alert(1)</script>',
      role: "EXTERNAL_LAWYER",
      inviteLink: "https://iusia.test/invitacion?invitationId=<unsafe>&x=1",
      expiresAt: new Date("2026-08-30T18:00:00.000Z"),
    });
    expect(unsafe.html).toContain("&lt;Admin &amp; Partner&gt;");
    expect(unsafe.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(unsafe.html).not.toContain("<script>alert(1)</script>");
    expect(unsafe.html).toContain("invitationId=&lt;unsafe&gt;&amp;x=1");
    expect(escapeHtml(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&#39;");
  });
});
