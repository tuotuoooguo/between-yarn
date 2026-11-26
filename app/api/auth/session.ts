import { env } from "cloudflare:workers";

const COOKIE = "__Host-between-yarn-session";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

type User = { id: string; email: string; avatar_url: string | null };

function db() { return (env as unknown as { DB: D1Database }).DB; }

function readCookie(request: Request) {
  const source = request.headers.get("cookie") ?? "";
  return source.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) ?? "";
}

export async function createSession(userId: string) {
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_MS).toISOString();
  await db().prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)").bind(id, userId, expiresAt).run();
  return `${COOKIE}=${id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(SESSION_MS / 1000)}`;
}

export async function getSessionUser(request: Request): Promise<User | null> {
  const id = readCookie(request);
  if (!id) return null;
  const user = await db().prepare(`SELECT users.id, users.email, users.avatar_url FROM sessions
    JOIN users ON users.id = sessions.user_id WHERE sessions.id = ? AND sessions.expires_at > ?`)
    .bind(id, new Date().toISOString()).first<User>();
  return user ?? null;
}

export async function POST(request: Request) {
  const id = readCookie(request);
  if (id) await db().prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
  return new Response(null, { status: 204, headers: { "set-cookie": `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` } });
}

export async function GET(request: Request) {
  const user = await getSessionUser(request);
  return Response.json({ user: user ? { email: user.email, avatarUrl: user.avatar_url } : null });
}
