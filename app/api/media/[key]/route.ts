import { env } from "cloudflare:workers";
import { getSessionUser } from "../../auth/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ key: string }> }) {
  const { key } = await context.params;
  const { YARN_MEDIA: bucket, DB } = env as unknown as { YARN_MEDIA: R2Bucket; DB: D1Database };
  const user = await getSessionUser(request);
  if (!user) return new Response("Unauthorized", { status: 401 });
  const project = await DB.prepare("SELECT id FROM yarn_projects WHERE user_id = ? AND (yarn_a_key = ? OR yarn_b_key = ? OR preview_key = ?)").bind(user.id, key, key, key).first();
  if (!project) return new Response("Not found", { status: 404 });
  const object = await bucket.get(key);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "private, max-age=3600");
  return new Response(object.body, { headers });
}
