import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

const title = "织间 · Between Yarn｜把两团喜欢的毛线放在一起看看";
const description = "拍下两团毛线，看看它们合股后的颜色与质感，把喜欢的小样收进自己的灵感库。";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og-v4.png`;
  return {
    title,
    description,
    openGraph: { title, description, type: "website", locale: "zh_CN", images: [{ url: image, width: 1536, height: 1024, alt: "织间——喜欢的颜色，合在一起才知道" }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
