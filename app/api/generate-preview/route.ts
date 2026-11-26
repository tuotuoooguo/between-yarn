import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

type Quality = "medium" | "high";

function bindings() {
  return env as unknown as { OPENAI_API_KEY?: string };
}

function imageField(form: FormData, name: string) {
  const value = form.get(name);
  if (!(value instanceof File) || !value.type.startsWith("image/") || value.size > 8 * 1024 * 1024) return null;
  return value;
}

const prompt = `Create one consistent catalog-style studio photograph of a complete hand-knitted rectangular stockinette swatch made by holding exactly two reference yarns together as one vertical plied strand. Preserve their actual colours, relative thicknesses, fibre character, and direction. Apply this fixed construction to every result: the two yarns cross and travel together through every individual V-shaped stitch, visibly entwined within the same stitch instead of being assigned to separate rows, columns, or stitch legs. The denser, thicker, more opaque yarn is the structural core and visually supplies about 70% of the finished swatch's colour. If the other reference yarn is fine, airy, fuzzy, mohair-like, or translucent, it is a continuous visible companion layer at about 30% visual strength: its own colour and texture must be clearly present as fine strands and fuzzy fibres that wrap, cross, and lie alongside the core in every stitch. It must never vanish, but must not become an equally thick solid strand. Do not average the colours into a flat new colour. The result should look softly marled and naturally fused from a distance, yet clearly show both original yarns intertwined on close inspection. Do not treat them as colourwork: no alternating coloured rows, columns, stripes, checkerboards, solid single-colour stitch legs, isolated occasional accent fibres, or separate parallel colour tracks. Use a chunky, clearly legible gauge with large stitches: about 14 stitch columns and 12 rows. The finished swatch must be fully visible with neat cast-on, bind-off, and side edges, centered at about 80% of a square image. Use an entirely pure white seamless background with an even white margin on every side: no linen, tabletop, colour cast, frame, border, yarn balls, hands, knitting needles, labels, text, or graphic repeating pattern.`;

export async function POST(request: NextRequest) {
  const { OPENAI_API_KEY } = bindings();
  if (!OPENAI_API_KEY) return Response.json({ error: "生成服务尚未配置" }, { status: 503 });

  const form = await request.formData();
  const yarnA = imageField(form, "yarnA");
  const yarnB = imageField(form, "yarnB");
  const quality: Quality = "medium";
  if (!yarnA || !yarnB) return Response.json({ error: "请上传两张毛线照片" }, { status: 400 });

  const upstream = new FormData();
  upstream.append("model", "gpt-image-1.5");
  upstream.append("quality", quality);
  upstream.append("size", "1024x1024");
  upstream.append("output_format", "jpeg");
  upstream.append("output_compression", "90");
  upstream.append("image[]", yarnA, "yarn-a.jpg");
  upstream.append("image[]", yarnB, "yarn-b.jpg");
  upstream.append("prompt", prompt);

  const result = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: upstream,
  });
  const data = await result.json() as { data?: Array<{ b64_json?: string }>; error?: { message?: string } };
  if (!result.ok || !data.data?.[0]?.b64_json) {
    return Response.json({ error: data.error?.message || "生成服务暂时未能完成这张小样" }, { status: result.status || 502 });
  }
  return Response.json({ image: `data:image/jpeg;base64,${data.data[0].b64_json}` });
}
