import { env } from "cloudflare:workers";
import { createSession } from "../session";

export const dynamic = "force-dynamic";

const MAX_ATTEMPTS = 6;

type Bindings = { DB: D1Database };

function bindings() {
  return env as unknown as Bindings;
}

function validEmail(value: unknown) {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function hashCode(email: string, code: string) {
  const bytes = new TextEncoder().encode(`${email}:${code}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: Request) {
  const { DB } = bindings();
  const body = await request.json().catch(() => null) as { email?: unknown; code?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!validEmail(email) || !/^\d{6}$/.test(code)) return Response.json({ error: "请输入邮箱和 6 位验证码" }, { status: 400 });

  const record = await DB.prepare("SELECT code_hash, expires_at, attempt_count FROM email_verification_codes WHERE email = ?").bind(email).first<{ code_hash: string; expires_at: number; attempt_count: number }>();
  if (!record || record.expires_at < Date.now()) {
    await DB.prepare("DELETE FROM email_verification_codes WHERE email = ?").bind(email).run();
    return Response.json({ error: "验证码已过期，请重新获取" }, { status: 400 });
  }
  if (record.attempt_count >= MAX_ATTEMPTS) {
    await DB.prepare("DELETE FROM email_verification_codes WHERE email = ?").bind(email).run();
    return Response.json({ error: "尝试次数过多，请重新获取验证码" }, { status: 429 });
  }
  const codeHash = await hashCode(email, code);
  if (codeHash !== record.code_hash) {
    await DB.prepare("UPDATE email_verification_codes SET attempt_count = attempt_count + 1 WHERE email = ?").bind(email).run();
    return Response.json({ error: "验证码不正确" }, { status: 400 });
  }
  await DB.prepare("DELETE FROM email_verification_codes WHERE email = ?").bind(email).run();
  const existing = await DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
  const userId = existing?.id ?? crypto.randomUUID();
  await DB.prepare(`INSERT INTO users (id, email, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(email) DO UPDATE SET updated_at = CURRENT_TIMESTAMP`).bind(userId, email).run();
  const session = await createSession(userId);
  return Response.json({ ok: true, email }, { headers: { "set-cookie": session } });
}
