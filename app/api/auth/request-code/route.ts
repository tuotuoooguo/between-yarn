import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

const CODE_LIFETIME_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_EMAIL_REQUESTS_PER_HOUR = 5;
const MAX_IP_REQUESTS_PER_HOUR = 20;

type Bindings = { DB: D1Database; RESEND_API_KEY?: string };

const schema = [
  `CREATE TABLE IF NOT EXISTS email_verification_codes (
    email TEXT PRIMARY KEY NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_sent_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS email_code_requests (
    id TEXT PRIMARY KEY NOT NULL,
    email TEXT NOT NULL,
    ip TEXT NOT NULL,
    requested_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_email_code_requests_email ON email_code_requests(email, requested_at)`,
  `CREATE INDEX IF NOT EXISTS idx_email_code_requests_ip ON email_code_requests(ip, requested_at)`,
];

function bindings() {
  return env as unknown as Bindings;
}

function validEmail(value: unknown) {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function makeCode() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return String(100000 + (values[0] % 900000));
}

async function hashCode(email: string, code: string) {
  const bytes = new TextEncoder().encode(`${email}:${code}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: Request) {
  const { DB, RESEND_API_KEY } = bindings();
  if (!RESEND_API_KEY) return Response.json({ error: "邮件服务尚未配置" }, { status: 503 });

  const body = await request.json().catch(() => null) as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!validEmail(email)) return Response.json({ error: "请输入有效邮箱" }, { status: 400 });

  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;
  const ip = request.headers.get("CF-Connecting-IP") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  await DB.batch(schema.map((statement) => DB.prepare(statement)));
  await DB.prepare("DELETE FROM email_code_requests WHERE requested_at < ?").bind(hourAgo).run();

  const latest = await DB.prepare("SELECT last_sent_at FROM email_verification_codes WHERE email = ?").bind(email).first<{ last_sent_at: number }>();
  if (latest && now - latest.last_sent_at < RESEND_COOLDOWN_MS) {
    return Response.json({ error: "请稍后再试" }, { status: 429 });
  }
  const emailCount = await DB.prepare("SELECT COUNT(*) AS total FROM email_code_requests WHERE email = ? AND requested_at >= ?").bind(email, hourAgo).first<{ total: number }>();
  const ipCount = await DB.prepare("SELECT COUNT(*) AS total FROM email_code_requests WHERE ip = ? AND requested_at >= ?").bind(ip, hourAgo).first<{ total: number }>();
  if ((emailCount?.total ?? 0) >= MAX_EMAIL_REQUESTS_PER_HOUR || (ipCount?.total ?? 0) >= MAX_IP_REQUESTS_PER_HOUR) {
    return Response.json({ error: "验证码请求过于频繁，请稍后再试" }, { status: 429 });
  }

  const code = makeCode();
  const codeHash = await hashCode(email, code);
  const expiresAt = now + CODE_LIFETIME_MS;
  await DB.batch([
    DB.prepare(`INSERT INTO email_verification_codes (email, code_hash, expires_at, attempt_count, last_sent_at)
      VALUES (?, ?, ?, 0, ?)
      ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempt_count = 0, last_sent_at = excluded.last_sent_at`)
      .bind(email, codeHash, expiresAt, now),
    DB.prepare("INSERT INTO email_code_requests (id, email, ip, requested_at) VALUES (?, ?, ?, ?)").bind(crypto.randomUUID(), email, ip, now),
  ]);

  const delivery = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "织间 Between Yarn <verify@betweenyarn.com>",
      to: [email],
      subject: "织间登录验证码 / Your Between Yarn sign-in code",
      html: `<div style="font-family:Arial,'PingFang SC','Microsoft YaHei',sans-serif;color:#153d58;max-width:560px;margin:0 auto"><h2 style="margin-bottom:20px">织间 · Between Yarn</h2><p>你的登录验证码是：</p><p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:12px 0 20px">${code}</p><p>验证码将在 10 分钟后失效。若不是你本人操作，请忽略这封邮件。</p><hr style="border:0;border-top:1px solid #d9e6eb;margin:28px 0"/><p>Your sign-in code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:12px 0 20px">${code}</p><p>This code expires in 10 minutes. If you did not request it, you can safely ignore this email.</p></div>`,
    }),
  });
  if (!delivery.ok) {
    await DB.prepare("DELETE FROM email_verification_codes WHERE email = ?").bind(email).run();
    return Response.json({ error: "发信域名尚未通过 Resend 验证，或邮件服务暂时拒绝了请求。请在 Resend 完成 betweenyarn.com 的验证后重试。" }, { status: 502 });
  }
  return Response.json({ ok: true, expiresIn: 600 });
}
