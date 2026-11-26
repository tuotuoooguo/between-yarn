import { env } from "cloudflare:workers";
import { createSession } from "../session";

export const dynamic = "force-dynamic";

function db() { return (env as unknown as { DB: D1Database }).DB; }

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { accessToken?: unknown } | null;
  if (typeof body?.accessToken !== "string" || !body.accessToken) return Response.json({ error: "Google 登录信息无效" }, { status: 400 });
  const profile = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${body.accessToken}` } });
  if (!profile.ok) return Response.json({ error: "Google 登录未能完成" }, { status: 401 });
  const payload = await profile.json() as { email?: string; picture?: string };
  const email = payload.email?.trim().toLowerCase() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: "Google 未返回可用邮箱" }, { status: 400 });
  const existing = await db().prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
  const id = existing?.id ?? crypto.randomUUID();
  await db().prepare(`INSERT INTO users (id, email, avatar_url, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(email) DO UPDATE SET avatar_url = COALESCE(excluded.avatar_url, users.avatar_url), updated_at = CURRENT_TIMESTAMP`)
    .bind(id, email, payload.picture ?? null).run();
  const session = await createSession(id);
  return Response.json({ email, avatarUrl: payload.picture ?? null }, { headers: { "set-cookie": session } });
}
