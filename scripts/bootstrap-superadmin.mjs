#!/usr/bin/env node
/**
 * Bootstrap del SYSTEM_SUPERADMIN (Sprint 7.8).
 *
 * Concede autoridad global de plataforma a UNA cuenta ya existente. Es una
 * operación de OPERADOR, no de producto: se ejecuta desde la máquina del
 * responsable con credenciales de Cloudflare, nunca desde el frontend ni desde una
 * ruta HTTP. No crea usuarios, no toca contraseñas y no imprime secretos.
 *
 * Idempotente: repetirlo deja el mismo estado. Fail-closed: si la cuenta no existe,
 * no hace nada (no se inventa un usuario para concederle poder).
 *
 * Uso:
 *   node scripts/bootstrap-superadmin.mjs <email> [--remote|--local]
 */
import { execFileSync } from "node:child_process";

const [emailArg, envArg = "--remote"] = process.argv.slice(2);

if (!emailArg || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailArg)) {
  console.error("Uso: node scripts/bootstrap-superadmin.mjs <email> [--remote|--local]");
  process.exit(1);
}
if (!["--remote", "--local"].includes(envArg)) {
  console.error("El entorno debe ser --remote o --local");
  process.exit(1);
}
// El email va en un literal SQL: se rechaza cualquier comilla en vez de escaparla.
if (emailArg.includes("'")) {
  console.error("Email inválido");
  process.exit(1);
}

function d1(sql) {
  const out = execFileSync(
    "pnpm",
    ["--filter", "@iusia/web", "exec", "wrangler", "d1", "execute", "iusia-db", envArg, "--json", "--command", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const json = JSON.parse(out.slice(out.indexOf("[")));
  return json[0]?.results ?? [];
}

const existing = d1(`SELECT id, system_role FROM user WHERE email = '${emailArg}' LIMIT 1`);
if (existing.length === 0) {
  console.error(
    `✖ No existe una cuenta con ese email. Inicia sesión una vez con ella y vuelve a ejecutar.\n` +
      `  El bootstrap NO crea usuarios.`,
  );
  process.exit(1);
}

const [user] = existing;
if (user.system_role === "SYSTEM_SUPERADMIN") {
  console.log(`✓ Sin cambios: la cuenta ya es SYSTEM_SUPERADMIN (user ${user.id}).`);
  process.exit(0);
}

d1(`UPDATE user SET system_role = 'SYSTEM_SUPERADMIN' WHERE email = '${emailArg}'`);
const [after] = d1(`SELECT id, system_role FROM user WHERE email = '${emailArg}' LIMIT 1`);
if (after?.system_role !== "SYSTEM_SUPERADMIN") {
  console.error("✖ El bootstrap no pudo confirmarse. Estado sin cambios verificables.");
  process.exit(1);
}
const total = d1(`SELECT COUNT(*) AS n FROM user WHERE system_role = 'SYSTEM_SUPERADMIN'`);
console.log(`✓ SYSTEM_SUPERADMIN concedido (user ${after.id}).`);
console.log(`  Cuentas con autoridad de sistema: ${total[0]?.n ?? "?"}`);
