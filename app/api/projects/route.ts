import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";
import { getSessionUser } from "../auth/session";

export const dynamic = "force-dynamic";

const createTable = `CREATE TABLE IF NOT EXISTS yarn_projects (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  yarn_a_name TEXT NOT NULL,
  yarn_b_name TEXT NOT NULL,
  yarn_a_key TEXT NOT NULL,
  yarn_b_key TEXT NOT NULL,
  preview_key TEXT NOT NULL,
  color_a TEXT NOT NULL,
  color_b TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

const createIndex = `CREATE INDEX IF NOT EXISTS idx_yarn_projects_created_at ON yarn_projects(created_at DESC)`;

function bindings() {
  return env as unknown as { DB: D1Database; YARN_MEDIA: R2Bucket };
}

async function ensureSchema(db: D1Database) {
  await db.batch([db.prepare(createTable), db.prepare(createIndex)]);
}

function textField(form: FormData, name: string, fallback = "") {
  const value = form.get(name);
  return typeof value === "string" ? value.trim().slice(0, 80) : fallback;
}

function imageField(form: FormData, name: string) {
  const value = form.get(name);
  if (!(value instanceof File) || !value.type.startsWith("image/") || value.size > 12 * 1024 * 1024) return null;
  return value;
}

export async function GET(request: NextRequest) {
  const { DB } = bindings();
  const user = await getSessionUser(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const result = await DB.prepare(`SELECT id, name, yarn_a_name, yarn_b_name, yarn_a_key, yarn_b_key, preview_key, color_a, color_b, created_at
    FROM yarn_projects WHERE user_id = ? ORDER BY created_at DESC LIMIT 120`).bind(user.id).all();
  return Response.json({ projects: result.results ?? [] });
}

export async function POST(request: NextRequest) {
  const { DB, YARN_MEDIA } = bindings();
  const user = await getSessionUser(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const form = await request.formData();
  const yarnA = imageField(form, "yarnA");
  const yarnB = imageField(form, "yarnB");
  const preview = imageField(form, "preview");
  if (!yarnA || !yarnB || !preview) return Response.json({ error: "需要三张有效图片" }, { status: 400 });

  const id = crypto.randomUUID();
  const keys = { yarnA: `${id}-a.jpg`, yarnB: `${id}-b.jpg`, preview: `${id}-preview.jpg` };
  await Promise.all([
    YARN_MEDIA.put(keys.yarnA, yarnA.stream(), { httpMetadata: { contentType: yarnA.type } }),
    YARN_MEDIA.put(keys.yarnB, yarnB.stream(), { httpMetadata: { contentType: yarnB.type } }),
    YARN_MEDIA.put(keys.preview, preview.stream(), { httpMetadata: { contentType: preview.type } }),
  ]);

  const project = {
    id,
    name: textField(form, "name", "未命名搭配") || "未命名搭配",
    yarn_a_name: textField(form, "yarnAName", "毛线 A") || "毛线 A",
    yarn_b_name: textField(form, "yarnBName", "毛线 B") || "毛线 B",
    yarn_a_key: keys.yarnA,
    yarn_b_key: keys.yarnB,
    preview_key: keys.preview,
    color_a: textField(form, "colorA", "#8a7568"),
    color_b: textField(form, "colorB", "#b15d6d"),
  };

  try {
    await ensureSchema(DB);
    await DB.prepare(`INSERT INTO yarn_projects
      (id, name, yarn_a_name, yarn_b_name, yarn_a_key, yarn_b_key, preview_key, color_a, color_b, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(project.id, project.name, project.yarn_a_name, project.yarn_b_name, project.yarn_a_key, project.yarn_b_key, project.preview_key, project.color_a, project.color_b, user.id)
      .run();
  } catch (error) {
    await Promise.all([YARN_MEDIA.delete(keys.yarnA), YARN_MEDIA.delete(keys.yarnB), YARN_MEDIA.delete(keys.preview)]);
    throw error;
  }

  const saved = await DB.prepare(`SELECT id, name, yarn_a_name, yarn_b_name, yarn_a_key, yarn_b_key, preview_key, color_a, color_b, created_at
    FROM yarn_projects WHERE id = ?`).bind(id).first();
  return Response.json({ project: saved }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const { DB, YARN_MEDIA } = bindings();
  const user = await getSessionUser(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!id) return Response.json({ error: "缺少记录编号" }, { status: 400 });
  await ensureSchema(DB);
  const project = await DB.prepare("SELECT yarn_a_key, yarn_b_key, preview_key FROM yarn_projects WHERE id = ? AND user_id = ?").bind(id, user.id).first<{ yarn_a_key: string; yarn_b_key: string; preview_key: string }>();
  if (!project) return Response.json({ error: "记录不存在" }, { status: 404 });
  await DB.prepare("DELETE FROM yarn_projects WHERE id = ? AND user_id = ?").bind(id, user.id).run();
  await Promise.all([YARN_MEDIA.delete(project.yarn_a_key), YARN_MEDIA.delete(project.yarn_b_key), YARN_MEDIA.delete(project.preview_key)]);
  return Response.json({ ok: true });
}
