"use client";

import { ChangeEvent, DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { localeLabels, translations } from "./i18n";
import type { Dictionary, Locale } from "./i18n";

const GOOGLE_CLIENT_ID = "407305775131-bbm23f7aapd024rehsj8c6mm1hftp0ta.apps.googleusercontent.com";

type GoogleTokenResponse = { access_token?: string; error?: string };

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (options: { client_id: string; scope: string; callback: (response: GoogleTokenResponse) => void }) => { requestAccessToken: (options?: { prompt?: string }) => void };
        };
      };
    };
  }
}

type YarnSlot = "a" | "b";
type WorkspaceView = "studio" | "library";
type YarnFile = {
  file: File;
  url: string;
};

type PreviewData = {
  blob: Blob;
  colorA: string;
  colorB: string;
};

type SavedProject = {
  id: string;
  name: string;
  yarn_a_name: string;
  yarn_b_name: string;
  yarn_a_key: string;
  yarn_b_key: string;
  preview_key: string;
  color_a: string;
  color_b: string;
  created_at: string;
};

type AvatarCrop = { src: string; width: number; height: number };

const mediaUrl = (key: string) => `/api/media/${encodeURIComponent(key)}`;

function readImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

const supportedImageTypes = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

function isHeicFile(file: File) {
  return file.type === "image/heic" || file.type === "image/heif" || /\.hei[cf]$/i.test(file.name);
}

function isSupportedImageFile(file: File) {
  return supportedImageTypes.includes(file.type) || /\.(jpe?g|png|webp|hei[cf])$/i.test(file.name);
}

async function prepareImageFile(file: File) {
  if (!isHeicFile(file)) return file;
  const { default: heic2any } = await import("heic2any");
  const result = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
  const jpeg = Array.isArray(result) ? result[0] : result;
  return new File([jpeg], file.name.replace(/\.hei[cf]$/i, ".jpg"), { type: "image/jpeg" });
}

function averageColor(image: HTMLImageElement) {
  const sample = document.createElement("canvas");
  sample.width = 36;
  sample.height = 36;
  const ctx = sample.getContext("2d", { willReadFrequently: true });
  if (!ctx) return "#9e6f60";
  const side = Math.min(image.naturalWidth, image.naturalHeight) * 0.72;
  ctx.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 36, 36);
  const pixels = ctx.getImageData(0, 0, 36, 36).data;
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let index = 0; index < pixels.length; index += 16) {
    if (pixels[index + 3] < 160) continue;
    r += pixels[index];
    g += pixels[index + 1];
    b += pixels[index + 2];
    count += 1;
  }
  const hex = (value: number) => Math.round(value / Math.max(count, 1)).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

type Rgb = { r: number; g: number; b: number };
type YarnProfile = {
  color: string;
  rgb: Rgb;
  fuzz: number;
  thickness: number;
};

function hexToRgb(hex: string): Rgb {
  return { r: Number.parseInt(hex.slice(1, 3), 16), g: Number.parseInt(hex.slice(3, 5), 16), b: Number.parseInt(hex.slice(5, 7), 16) };
}

function mixRgb(first: Rgb, second: Rgb, amount: number) {
  const mix = (a: number, b: number) => Math.round(a + (b - a) * amount);
  return `rgb(${mix(first.r, second.r)}, ${mix(first.g, second.g)}, ${mix(first.b, second.b)})`;
}

function analyzeYarn(image: HTMLImageElement): YarnProfile {
  const color = averageColor(image);
  const rgb = hexToRgb(color);
  const sample = document.createElement("canvas");
  sample.width = 52;
  sample.height = 52;
  const context = sample.getContext("2d", { willReadFrequently: true });
  if (!context) return { color, rgb, fuzz: 0.2, thickness: 0.7 };
  const side = Math.min(image.naturalWidth, image.naturalHeight) * 0.68;
  context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 52, 52);
  const pixels = context.getImageData(0, 0, 52, 52).data;
  let contrast = 0;
  let brightSpecks = 0;
  let total = 0;
  for (let y = 1; y < 51; y += 2) {
    for (let x = 1; x < 51; x += 2) {
      const index = (y * 52 + x) * 4;
      const next = (y * 52 + x + 1) * 4;
      const luminance = pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722;
      const nextLuminance = pixels[next] * 0.2126 + pixels[next + 1] * 0.7152 + pixels[next + 2] * 0.0722;
      contrast += Math.abs(luminance - nextLuminance);
      if (luminance > 190) brightSpecks += 1;
      total += 1;
    }
  }
  const texture = contrast / Math.max(total, 1);
  const fuzz = Math.min(0.72, Math.max(0.08, (texture - 10) / 42 + brightSpecks / Math.max(total, 1) * 0.35));
  // A diffuse, pale photo generally indicates a fine mohair companion; compact darker yarn reads as the structural strand.
  const lightness = (rgb.r + rgb.g + rgb.b) / 765;
  const thickness = Math.min(0.92, Math.max(0.38, 0.8 - fuzz * 0.28 - lightness * 0.08));
  return { color, rgb, fuzz, thickness };
}

function fiberTexture(image: HTMLImageElement, tint: string) {
  const texture = document.createElement("canvas");
  texture.width = 160;
  texture.height = 160;
  const context = texture.getContext("2d");
  if (!context) return texture;
  const side = Math.min(image.naturalWidth, image.naturalHeight) * 0.7;
  context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 160, 160);
  // Preserve the photographed light/dark fibre variation while anchoring it to the inferred yarn colour.
  context.globalCompositeOperation = "color";
  context.fillStyle = tint;
  context.fillRect(0, 0, 160, 160);
  context.globalCompositeOperation = "soft-light";
  context.fillStyle = tint;
  context.globalAlpha = 0.55;
  context.fillRect(0, 0, 160, 160);
  context.globalCompositeOperation = "source-over";
  context.globalAlpha = 1;
  return texture;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

async function compressForUpload(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const image = await readImage(url);
    const maxSide = 1200;
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    ctx?.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("图片压缩失败"))), "image/jpeg", 0.8),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function makeAvatarDataUrl(crop: AvatarCrop, zoom: number, offset: { x: number; y: number }) {
  try {
    const image = await readImage(crop.src);
    const size = 256;
    const shortest = Math.min(crop.width, crop.height);
    const displayBase = 260 / shortest;
    const sourceSide = shortest / zoom;
    const sourceX = Math.max(0, Math.min(crop.width - sourceSide, (crop.width - sourceSide) / 2 - offset.x / (displayBase * zoom)));
    const sourceY = Math.max(0, Math.min(crop.height - sourceSide, (crop.height - sourceSide) / 2 - offset.y / (displayBase * zoom)));
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("图片处理失败");
    context.drawImage(image, sourceX, sourceY, sourceSide, sourceSide, 0, 0, size, size);
    return canvas.toDataURL("image/jpeg", 0.82);
  } catch (error) { throw error; }
}

function formatDate(value: string, locale: Locale) {
  const date = new Date(value.endsWith("Z") ? value : `${value.replace(" ", "T")}Z`);
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function UploadCard({
  slot,
  label,
  yarn,
  name,
  onName,
  onFile,
  onClear,
  copy,
}: {
  slot: YarnSlot;
  label: string;
  yarn: YarnFile | null;
  name: string;
  onName: (value: string) => void;
  onFile: (file: File) => void | Promise<void>;
  onClear: () => void;
  copy: Dictionary;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void onFile(file);
    event.target.value = "";
  };

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void onFile(file);
  };

  return (
    <article className={`upload-card upload-${slot}`}>
      <div className="card-kicker">
        <span className="step-dot">{slot === "a" ? "01" : "02"}</span>
        <span>{label}</span>
      </div>
      <label className="yarn-name">
        <span>{copy.yarnName}<small>{copy.optional}</small></span>
        <input value={name} onChange={(event) => onName(event.target.value)} placeholder={slot === "a" ? copy.yarnAPlaceholder : copy.yarnBPlaceholder} maxLength={32} />
      </label>
      <div
        className={`drop-zone ${dragging ? "is-dragging" : ""} ${yarn ? "has-image" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") inputRef.current?.click();
        }}
        aria-label={copy.dropAria(label)}
      >
        {yarn ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={yarn.url} alt={copy.photoAlt(label)} />
            <div className="image-actions">
              <span>{copy.changePhoto}</span>
              <button
                type="button"
                aria-label={copy.removeAria(label)}
                onClick={(event) => { event.stopPropagation(); onClear(); }}
              >
                ×
              </button>
            </div>
          </>
        ) : (
          <div className="upload-prompt">
            <span className="camera-mark" aria-hidden="true"><i /></span>
            <strong>{copy.upload}</strong>
            <small>{copy.uploadDrag}</small>
          </div>
        )}
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,.heic,.heif" onChange={choose} hidden />
      </div>
    </article>
  );
}

export default function Home() {
  const [locale, setLocale] = useState<Locale>("zh-CN");
  const [activeView, setActiveView] = useState<WorkspaceView>("studio");
  const [yarnA, setYarnA] = useState<YarnFile | null>(null);
  const [yarnB, setYarnB] = useState<YarnFile | null>(null);
  const [nameA, setNameA] = useState("");
  const [nameB, setNameB] = useState("");
  const [projectName, setProjectName] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [projects, setProjects] = useState<SavedProject[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"idle" | "working" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<SavedProject | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authCode, setAuthCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authNotice, setAuthNotice] = useState("");
  const [codeHelpOpen, setCodeHelpOpen] = useState(false);
  const [memberEmail, setMemberEmail] = useState<string | null>(null);
  const [memberAvatar, setMemberAvatar] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileNotice, setProfileNotice] = useState("");
  const [avatarChoiceOpen, setAvatarChoiceOpen] = useState(false);
  const [avatarCrop, setAvatarCrop] = useState<AvatarCrop | null>(null);
  const [avatarZoom, setAvatarZoom] = useState(1);
  const [avatarOffset, setAvatarOffset] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const avatarDragRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const copy = translations[locale];

  useEffect(() => {
    const savedLocale = window.localStorage.getItem("yarn-studio-locale") as Locale | null;
    if (savedLocale && savedLocale in translations) {
      setLocale(savedLocale);
      document.documentElement.lang = savedLocale;
    }
    void fetch("/api/auth/session", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) return;
      const data = await response.json() as { user: { email: string; avatarUrl: string | null } | null };
      if (data.user) { setMemberEmail(data.user.email); setMemberAvatar(data.user.avatarUrl); }
    });

    const scriptId = "google-identity-services";
    if (!document.getElementById(scriptId)) {
      const script = document.createElement("script");
      script.id = scriptId;
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  }, []);

  const changeLocale = (next: Locale) => {
    setLocale(next);
    setMessage("");
    window.localStorage.setItem("yarn-studio-locale", next);
    document.documentElement.lang = next;
  };

  const loadProjects = async () => {
    if (!memberEmail) { setProjects([]); return; }
    try {
      const response = await fetch("/api/projects", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const data = await response.json() as { projects: SavedProject[] };
      setProjects(data.projects);
    } catch {
      setMessage(copy.loadError);
    }
  };

  useEffect(() => { void loadProjects(); }, [locale, memberEmail]);

  const filteredProjects = useMemo(() => {
    const query = search.trim().toLocaleLowerCase(locale);
    if (!query) return projects;
    return projects.filter((project) => `${project.name} ${project.yarn_a_name} ${project.yarn_b_name}`.toLocaleLowerCase(locale).includes(query));
  }, [projects, search, locale]);

  const clearPreview = () => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setPreviewData(null);
  };

  const assignFile = async (slot: YarnSlot, file: File) => {
    if (!isSupportedImageFile(file)) {
      setMessage(copy.invalidImage);
      return;
    }
    if (file.size > 24 * 1024 * 1024) {
      setMessage(copy.tooLarge);
      return;
    }
    try {
      const preparedFile = await prepareImageFile(file);
      const next = { file: preparedFile, url: URL.createObjectURL(preparedFile) };
      const previous = slot === "a" ? yarnA : yarnB;
      if (previous) URL.revokeObjectURL(previous.url);
      if (slot === "a") setYarnA(next); else setYarnB(next);
      clearPreview();
      setMessage("");
      setStatus("idle");
    } catch {
      setMessage(locale === "en" ? "This HEIC image could not be converted. Please try another photo." : "这张 HEIC 图片暂时无法转换，请换一张图片再试。");
    }
  };

  const clearFile = (slot: YarnSlot) => {
    const previous = slot === "a" ? yarnA : yarnB;
    if (previous) URL.revokeObjectURL(previous.url);
    if (slot === "a") setYarnA(null); else setYarnB(null);
    clearPreview();
  };

  const drawSwatch = async () => {
    if (!yarnA || !yarnB || !canvasRef.current) return null;
    const [imageA, imageB] = await Promise.all([readImage(yarnA.url), readImage(yarnB.url)]);
    const profileA = analyzeYarn(imageA);
    const profileB = analyzeYarn(imageB);
    const colorA = profileA.color;
    const colorB = profileB.color;
    const canvas = canvasRef.current;
    canvas.width = 1200;
    canvas.height = 840;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法生成预览");

    ctx.fillStyle = "#eee9df";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const backdrop = ctx.createRadialGradient(600, 390, 100, 600, 390, 630);
    backdrop.addColorStop(0, "rgba(255,255,255,.92)");
    backdrop.addColorStop(1, "rgba(207,199,186,.48)");
    ctx.fillStyle = backdrop;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.shadowColor = "rgba(64, 47, 35, .25)";
    ctx.shadowBlur = 44;
    ctx.shadowOffsetY = 26;
    roundedRect(ctx, 180, 104, 840, 610, 34);
    ctx.fillStyle = "#b8b0a3";
    ctx.fill();
    ctx.restore();

    ctx.save();
    roundedRect(ctx, 180, 104, 840, 610, 34);
    ctx.clip();
    const textureA = ctx.createPattern(fiberTexture(imageA, colorA), "repeat");
    const textureB = ctx.createPattern(fiberTexture(imageB, colorB), "repeat");
    textureA?.setTransform(new DOMMatrix().scale(0.17).rotate(-0.24));
    textureB?.setTransform(new DOMMatrix().scale(0.17).rotate(0.22).translate(28, 48));
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // Held-together yarn rarely reads as two equal strands: the denser, less fuzzy yarn
    // forms the structural core, while the loftier yarn sits as a light halo on top.
    const structureScore = (profile: YarnProfile) => profile.thickness * 1.35 + (1 - profile.fuzz) * 0.7;
    const main = structureScore(profileA) >= structureScore(profileB) ? profileA : profileB;
    const companion = main === profileA ? profileB : profileA;
    const mainTexture = main === profileA ? textureA : textureB;
    const companionTexture = companion === profileA ? textureA : textureB;
    const mainWidth = 13 + main.thickness * 5;
    const companionWidth = Math.max(2.6, mainWidth * (0.22 + companion.thickness * 0.18));
    const drawCompositeLeg = (path: Path2D, side: number, x: number, y: number) => {
      ctx.save();
      ctx.shadowColor = "rgba(31, 24, 20, .28)";
      ctx.shadowBlur = 4;
      ctx.shadowOffsetY = 2;
      ctx.strokeStyle = mixRgb(main.rgb, { r: 20, g: 17, b: 15 }, 0.24);
      ctx.lineWidth = mainWidth + 2;
      ctx.stroke(path);
      ctx.shadowColor = "transparent";
      ctx.strokeStyle = main.color;
      ctx.lineWidth = mainWidth;
      ctx.stroke(path);
      if (mainTexture) {
        ctx.globalAlpha = 0.58;
        ctx.strokeStyle = mainTexture;
        ctx.stroke(path);
      }
      ctx.globalAlpha = 0.24;
      ctx.strokeStyle = mixRgb(main.rgb, { r: 255, g: 249, b: 240 }, 0.55);
      ctx.lineWidth = Math.max(1, mainWidth * 0.15);
      ctx.stroke(path);
      ctx.globalAlpha = 0.54;
      ctx.strokeStyle = companion.color;
      ctx.lineWidth = companionWidth;
      ctx.translate(side * (mainWidth * 0.23), 0);
      ctx.stroke(path);
      if (companionTexture) {
        ctx.globalAlpha = 0.38;
        ctx.strokeStyle = companionTexture;
        ctx.stroke(path);
      }
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = mixRgb(companion.rgb, { r: 255, g: 250, b: 245 }, 0.46);
      ctx.lineWidth = Math.max(0.85, companionWidth * 0.23);
      ctx.stroke(path);
      if (companion.fuzz > 0.18) {
        ctx.globalAlpha = Math.min(0.32, 0.08 + companion.fuzz * 0.42);
        ctx.strokeStyle = companion.color;
        ctx.lineWidth = 0.85;
        const hairs = Math.round(1 + companion.fuzz * 3);
        for (let hair = 0; hair < hairs; hair += 1) {
          const progress = (hair + 1) / (hairs + 1);
          const px = x + (side < 0 ? 7 + progress * 20 : 45 - progress * 20);
          const py = y + 8 + progress * 25;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.quadraticCurveTo(px + side * (7 + hair * 2), py - 7, px + side * (10 + hair * 3), py - 1);
          ctx.stroke();
        }
      }
      ctx.restore();
    };
    const stitchW = 57;
    const stitchH = 51;
    for (let row = -1; row < 13; row += 1) {
      for (let col = -1; col < 17; col += 1) {
        const x = 178 + col * stitchW + (row % 2 ? stitchW / 2 : 0);
        const y = 112 + row * stitchH;
        const left = new Path2D();
        left.moveTo(x + 6, y + 2);
        left.bezierCurveTo(x + 7, y + 18, x + 17, y + 35, x + 28.5, y + 47);
        const right = new Path2D();
        right.moveTo(x + 51, y + 2);
        right.bezierCurveTo(x + 50, y + 18, x + 40, y + 35, x + 28.5, y + 47);
        drawCompositeLeg(left, -1, x, y);
        drawCompositeLeg(right, 1, x, y);
      }
    }
    const edgeShade = ctx.createLinearGradient(180, 0, 1020, 0);
    edgeShade.addColorStop(0, "rgba(34,23,18,.28)");
    edgeShade.addColorStop(0.12, "transparent");
    edgeShade.addColorStop(0.88, "transparent");
    edgeShade.addColorStop(1, "rgba(34,23,18,.25)");
    ctx.fillStyle = edgeShade;
    ctx.fillRect(180, 104, 840, 610);
    ctx.restore();

    ctx.fillStyle = "rgba(49,39,31,.65)";
    ctx.font = "500 20px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`${nameA || copy.defaultA}  ×  ${nameB || copy.defaultB} · ${copy.stitchStockinette}`, 600, 775);

    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("生成失败")), "image/jpeg", 0.9));
    return { blob, colorA, colorB };
  };

  const generatePreview = async () => {
    if (!yarnA || !yarnB) {
      setMessage(copy.needTwo);
      return;
    }
    setStatus("working");
    setMessage(copy.composing);
    try {
      const [uploadA, uploadB] = await Promise.all([compressForUpload(yarnA.file), compressForUpload(yarnB.file)]);
      const form = new FormData();
      form.append("yarnA", uploadA, "yarn-a.jpg");
      form.append("yarnB", uploadB, "yarn-b.jpg");
      form.append("quality", "medium");
      const response = await fetch("/api/generate-preview", { method: "POST", body: form });
      const payload = await response.json() as { image?: string; error?: string };
      if (!response.ok || !payload.image) throw new Error(payload.error || "generation failed");
      const imageResponse = await fetch(payload.image);
      const blob = await imageResponse.blob();
      const [imageA, imageB] = await Promise.all([readImage(yarnA.url), readImage(yarnB.url)]);
      const rendered = { blob, colorA: averageColor(imageA), colorB: averageColor(imageB) };
      if (preview) URL.revokeObjectURL(preview);
      setPreview(URL.createObjectURL(rendered.blob));
      setPreviewData(rendered);
      setStatus("idle");
      setMessage(copy.previewReady);
    } catch {
      setStatus("error");
      setMessage(copy.saveError);
    }
  };

  const saveProject = async () => {
    if (!yarnA || !yarnB) {
      setMessage(copy.needTwo);
      return;
    }
    if (!previewData) {
      setMessage(copy.needPreview);
      return;
    }
    setStatus("working");
    setMessage(copy.composing);
    try {
      const [uploadA, uploadB] = await Promise.all([compressForUpload(yarnA.file), compressForUpload(yarnB.file)]);

      const form = new FormData();
      form.append("name", projectName.trim() || `${nameA.trim() || copy.defaultA} × ${nameB.trim() || copy.defaultB}`);
      form.append("yarnAName", nameA.trim() || copy.defaultA);
      form.append("yarnBName", nameB.trim() || copy.defaultB);
      form.append("colorA", previewData.colorA);
      form.append("colorB", previewData.colorB);
      form.append("yarnA", uploadA, "yarn-a.jpg");
      form.append("yarnB", uploadB, "yarn-b.jpg");
      form.append("preview", previewData.blob, "preview.jpg");
      const response = await fetch("/api/projects", { method: "POST", body: form });
      if (!response.ok) throw new Error();
      const data = await response.json() as { project: SavedProject };
      setProjects((current) => [data.project, ...current]);
      setStatus("saved");
      setMessage(copy.saved(data.project.name));
    } catch {
      setStatus("error");
      setMessage(copy.saveError);
    }
  };

  const resetDraft = () => {
    if (yarnA) URL.revokeObjectURL(yarnA.url);
    if (yarnB) URL.revokeObjectURL(yarnB.url);
    setYarnA(null);
    setYarnB(null);
    setNameA("");
    setNameB("");
    setProjectName("");
    clearPreview();
    setStatus("idle");
    setMessage("");
  };

  const changeStitch = (next: StitchPattern) => {
    setStitchPattern(next);
    clearPreview();
    setStatus("idle");
    setMessage("");
  };

  const deleteProject = async (project: SavedProject) => {
    const response = await fetch(`/api/projects?id=${encodeURIComponent(project.id)}`, { method: "DELETE" });
    if (response.ok) {
      setProjects((current) => current.filter((item) => item.id !== project.id));
      setSelected(null);
      // Deleting happens in the library. Do not surface its transient status back in the studio.
      setMessage("");
    } else {
      setMessage(copy.removeError);
    }
  };

  const openAuth = () => {
    setAuthNotice("");
    setAuthCode("");
    setCodeSent(false);
    setAuthOpen(true);
  };

  const finishAuth = (email: string, avatar?: string | null) => {
    const value = email.trim() || (locale === "en" ? "hello@betweenyarn.com" : "hello@betweenyarn.com");
    if (avatar) {
      window.localStorage.setItem("between-yarn-member-avatar", avatar);
      setMemberAvatar(avatar);
    }
    setMemberEmail(value);
    setAuthOpen(false);
    setAuthNotice("");
  };

  const completeGoogleSignIn = async (response: GoogleTokenResponse) => {
    try {
      if (!response.access_token) throw new Error("missing token");
      const profileResponse = await fetch("/api/auth/google", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken: response.access_token }) });
      const payload = await profileResponse.json() as { email?: string; avatarUrl?: string | null; error?: string };
      if (!profileResponse.ok || !payload.email) throw new Error(payload.error);
      finishAuth(payload.email, payload.avatarUrl);
    } catch {
      setAuthNotice(locale === "en" ? "Google sign-in could not be completed. Please try again." : "Google 登录未能完成，请重试。");
    }
  };

  const startGoogleAuth = () => {
    const start = () => {
      if (!window.google?.accounts.oauth2) {
        setAuthNotice(locale === "en" ? "Google sign-in is loading. Please try again in a moment." : "Google 登录正在加载，请稍后重试。");
        return;
      }
      setAuthNotice("");
      window.google.accounts.oauth2.initTokenClient({ client_id: GOOGLE_CLIENT_ID, scope: "openid email profile", callback: (response) => { void completeGoogleSignIn(response); } }).requestAccessToken({ prompt: "select_account" });
    };
    const script = document.getElementById("google-identity-services") as HTMLScriptElement | null;
    if (window.google?.accounts.oauth2) start(); else if (script) script.addEventListener("load", start, { once: true }); else setAuthNotice(locale === "en" ? "Google sign-in is unavailable right now." : "Google 登录暂时不可用。");
  };

  const signOut = () => {
    void fetch("/api/auth/session", { method: "POST" });
    window.localStorage.removeItem("between-yarn-member-avatar");
    setMemberEmail(null);
    setMemberAvatar(null);
    setProfileOpen(false);
    setActiveView("studio");
  };

  const clampAvatarOffset = (offset: { x: number; y: number }, crop = avatarCrop, zoom = avatarZoom) => {
    if (!crop) return { x: 0, y: 0 };
    const base = 260 / Math.min(crop.width, crop.height);
    const limitX = Math.max(0, (crop.width * base * zoom - 260) / 2);
    const limitY = Math.max(0, (crop.height * base * zoom - 260) / 2);
    return { x: Math.max(-limitX, Math.min(limitX, offset.x)), y: Math.max(-limitY, Math.min(limitY, offset.y)) };
  };

  const updateAvatar = async (file: File | undefined) => {
    if (!file) return;
    if (!isSupportedImageFile(file)) {
      setAvatarChoiceOpen(false);
      setProfileNotice(locale === "en" ? "Unsupported file. Please use JPG, PNG, WebP, HEIC, or HEIF." : "不支持该格式，请使用 JPG、PNG、WebP、HEIC 或 HEIF 图片。");
      return;
    }
    setProfileNotice("");
    let preparedFile: File;
    try {
      preparedFile = await prepareImageFile(file);
    } catch {
      setAvatarChoiceOpen(false);
      setProfileNotice(locale === "en" ? "This HEIC image could not be converted. Please try another photo." : "这张 HEIC 图片暂时无法转换，请换一张图片再试。");
      return;
    }
    const src = URL.createObjectURL(preparedFile);
    void readImage(src).then((image) => {
      setAvatarChoiceOpen(false);
      setAvatarCrop({ src, width: image.naturalWidth, height: image.naturalHeight });
      setAvatarZoom(1);
      setAvatarOffset({ x: 0, y: 0 });
    }).catch(() => {
      URL.revokeObjectURL(src);
      setProfileNotice(locale === "en" ? "This image could not be used. Please try another one." : "这张图片暂时无法使用，请换一张再试。");
    });
  };

  const closeAvatarCrop = () => {
    if (avatarCrop) URL.revokeObjectURL(avatarCrop.src);
    setAvatarCrop(null);
    avatarDragRef.current = null;
  };

  const saveAvatarCrop = async () => {
    if (!avatarCrop) return;
    try {
      const avatar = await makeAvatarDataUrl(avatarCrop, avatarZoom, avatarOffset);
      window.localStorage.setItem("between-yarn-member-avatar", avatar);
      setMemberAvatar(avatar);
      setProfileNotice(locale === "en" ? "Avatar updated." : "头像已更新。");
    } catch {
      setProfileNotice(locale === "en" ? "This image could not be used. Please try another one." : "这张图片暂时无法使用，请换一张再试。");
    } finally {
      closeAvatarCrop();
    }
  };

  const useDefaultAvatar = () => {
    window.localStorage.removeItem("between-yarn-member-avatar");
    setMemberAvatar(null);
    setAvatarChoiceOpen(false);
    setProfileNotice(locale === "en" ? "Default avatar restored." : "已恢复默认头像。");
  };

  const sendEmailCode = async () => {
    setAuthSubmitting(true);
    setAuthNotice("");
    try {
      const response = await fetch("/api/auth/request-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: authEmail }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error);
      setCodeSent(true);
      setCodeHelpOpen(false);
      setAuthNotice(locale === "en" ? "A six-digit code has been sent to your email." : "六码验证码已发送至你的邮箱。");
    } catch (error) {
      setAuthNotice(error instanceof Error && error.message ? error.message : (locale === "en" ? "Unable to send the code. Please try again." : "验证码暂时未能发出，请稍后重试。"));
    } finally {
      setAuthSubmitting(false);
    }
  };

  const requestEmailCode = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendEmailCode();
  };

  const verifyEmailCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthSubmitting(true);
    setAuthNotice("");
    try {
      const response = await fetch("/api/auth/verify-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: authEmail, code: authCode }) });
      const data = await response.json() as { error?: string; email?: string };
      if (!response.ok || !data.email) throw new Error(data.error);
      finishAuth(data.email);
    } catch (error) {
      setAuthNotice(error instanceof Error && error.message ? error.message : (locale === "en" ? "The code could not be verified." : "验证码验证失败，请重试。"));
    } finally {
      setAuthSubmitting(false);
    }
  };

  const openLibrary = () => {
    if (!memberEmail) {
      openAuth();
      return;
    }
    setActiveView("library");
  };

  return (
    <main data-locale={locale}>
      <header className="studio-masthead" id="top">
        <div className="masthead-note">
          <p>{copy.siteIntro}</p>
          <span>{copy.siteIntroSub}</span>
        </div>
        <a className="brand" href="#top" aria-label={copy.brandAria}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="brand-logo" src="/logo-yarn-crayon-v5.png" alt="" />
          <span>{copy.brand}<small>{copy.brandSub}</small></span>
        </a>
        <label className="language-control">
          <span>{copy.language}</span>
          <select value={locale} onChange={(event) => changeLocale(event.target.value as Locale)} aria-label={copy.language}>
            {(Object.keys(localeLabels) as Locale[]).map((key) => <option key={key} value={key}>{localeLabels[key]}</option>)}
          </select>
          <i aria-hidden="true">⌄</i>
        </label>
        <div className="member-control">
          {memberEmail ? <><button className="avatar-button" type="button" onClick={() => setProfileOpen(true)} aria-label={locale === "en" ? "Open profile" : "打开个人主页"}><img src={memberAvatar || "/avatar-default.png"} alt="" /></button><button className="header-signout" type="button" onClick={() => setProfileOpen(true)}>{locale === "en" ? "Profile" : "个人主页"}</button></> : <button type="button" onClick={openAuth}>{locale === "en" ? "Sign in" : "登录 / 注册"}</button>}
        </div>
      </header>

      <nav className="workspace-tabs" role="tablist" aria-label={copy.navAria}>
        <button type="button" role="tab" aria-selected={activeView === "studio"} className={activeView === "studio" ? "is-active" : ""} onClick={() => setActiveView("studio")}>{copy.tabPairing}</button>
        <button type="button" role="tab" aria-selected={activeView === "library"} className={activeView === "library" ? "is-active" : ""} onClick={openLibrary}>{copy.tabLibrary}<small>{projects.length}</small></button>
      </nav>

      {activeView === "studio" ? <>
      <section className="pairing-workbench" id="studio">
        <div className="upload-column">
          <UploadCard slot="a" label={copy.yarnOne} yarn={yarnA} name={nameA} onName={setNameA} onFile={(file) => assignFile("a", file)} onClear={() => clearFile("a")} copy={copy} />
          <UploadCard slot="b" label={copy.yarnTwo} yarn={yarnB} name={nameB} onName={setNameB} onFile={(file) => assignFile("b", file)} onClear={() => clearFile("b")} copy={copy} />
          <button className="preview-button" type="button" disabled={status === "working"} onClick={() => void generatePreview()}>
            <span>{status === "working" ? copy.workingButton : copy.generateButton}</span>
          </button>
        </div>

        <section className="workbench-preview" aria-labelledby="preview-title">
          <div className="preview-heading">
            <div>
              <p className="card-kicker">{copy.pairingResult}</p>
              <h2 id="preview-title">{copy.swatch}</h2>
            </div>
          </div>

          <div className={`swatch-stage ${preview ? "has-preview" : ""}`}>
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt={copy.previewAlt} />
            ) : (
              <div className="placeholder-swatch" aria-label={copy.waitingAria}>
                <div className="knit-lines" aria-hidden="true">{Array.from({ length: 60 }, (_, index) => <i key={index} />)}</div>
              </div>
            )}
          </div>

          <label className="project-name">
            <span>{copy.projectLabel}<small>{copy.optional}</small></span>
            <input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder={copy.projectPlaceholder} maxLength={40} />
          </label>
          <div className="preview-actions">
            <button className="save-button" type="button" disabled={status === "working" || !previewData} onClick={() => memberEmail ? void saveProject() : openAuth()}>{copy.saveButton}</button>
            <button className="reset-button" type="button" onClick={() => setConfirmReset(true)}>{copy.resetButton}</button>
          </div>
          {message && <p className={`status-message status-${status}`} aria-live="polite">{message}</p>}
        </section>
      </section>
      <aside className="membership-note" aria-label={locale === "en" ? "Beta access" : "内测说明"}>
        <div>
          <span className="membership-kicker">{locale === "en" ? "BETA ACCESS" : "免费内测"}</span>
          <p>{locale === "en" ? "During this free beta, guests can generate 3 yarn-combination swatches in total. Sign in to generate up to 8 each day, and your daily allowance resets each day." : locale === "zh-HK" ? "目前為免費內測階段，訪客總共可生成 3 次合股樣圖；登入後每天可生成 8 次合股樣圖，每日次數會重置。" : "目前为免费内测阶段，游客总共可生成3次合股样图，登录后每天可生成8次合股样图，每日次数将重置。"}</p>
        </div>
      </aside>
      </>

      : <section className="library" id="library">
        <div className="library-head">
          <div>
            <p className="eyebrow"><span /> {copy.libraryEyebrow}</p>
            <h2>{copy.libraryTitle}</h2>
          </div>
          <label className="search-box">
            <span aria-hidden="true" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={copy.searchPlaceholder} aria-label={copy.searchAria} />
          </label>
        </div>

        {filteredProjects.length > 0 ? (
          <div className="project-grid">
            {filteredProjects.map((project) => (
              <button className="project-card" type="button" key={project.id} onClick={() => setSelected(project)}>
                <div className="project-image">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mediaUrl(project.preview_key)} alt={copy.projectAlt(project.name)} />
                  <span>{formatDate(project.created_at, locale)}</span>
                </div>
                <div className="project-info">
                  <h3>{project.name}</h3>
                  <div className="yarn-pair">
                    <span style={{ background: project.color_a }} /><small>{project.yarn_a_name}</small>
                    <b>+</b>
                    <span style={{ background: project.color_b }} /><small>{project.yarn_b_name}</small>
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-library">
            <div className="empty-balls" aria-hidden="true"><i /><i /></div>
            <h3>{projects.length ? copy.emptySearchTitle : copy.emptyTitle}</h3>
            <p>{projects.length ? copy.emptySearchText : copy.emptyText}</p>
            {!projects.length && <button type="button" onClick={() => setActiveView("studio")}>{copy.emptyCta}</button>}
          </div>
        )}
      </section>}

      <canvas ref={canvasRef} className="render-canvas" aria-hidden="true" />

      <footer id="contact"><span>{copy.brand}</span><p>{copy.footer}</p><div><a href="/legal">{locale === "en" ? "Terms & Privacy" : "服务条款与隐私政策"}</a><a href="#contact">{locale === "en" ? "Leave us a message" : "给我们留言"}</a><small>{locale === "en" ? "Suggestions welcome: tuotuoooguo@gmail.com" : "有任何建议，欢迎发送邮件至 tuotuoooguo@gmail.com"}</small><a href="#top">{copy.backTop}</a></div></footer>

      {selected && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setSelected(null)}>
          <section className="detail-modal" role="dialog" aria-modal="true" aria-labelledby="detail-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" type="button" onClick={() => setSelected(null)} aria-label={copy.close}>×</button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="modal-preview" src={mediaUrl(selected.preview_key)} alt={copy.projectAlt(selected.name)} />
            <div className="modal-copy">
              <p>{formatDate(selected.created_at, locale)}</p>
              <h2 id="detail-title">{selected.name}</h2>
              <div className="source-photos">
                <figure>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mediaUrl(selected.yarn_a_key)} alt={selected.yarn_a_name} />
                  <figcaption><i style={{ background: selected.color_a }} />{selected.yarn_a_name}</figcaption>
                </figure>
                <span>+</span>
                <figure>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mediaUrl(selected.yarn_b_key)} alt={selected.yarn_b_name} />
                  <figcaption><i style={{ background: selected.color_b }} />{selected.yarn_b_name}</figcaption>
                </figure>
              </div>
              <button className="delete-button" type="button" onClick={() => void deleteProject(selected)}>{copy.deleteRecord}</button>
            </div>
          </section>
        </div>
      )}

      {confirmReset && (
        <div className="modal-backdrop confirmation-backdrop" role="presentation" onMouseDown={() => setConfirmReset(false)}>
          <section className="reset-confirmation" role="dialog" aria-modal="true" aria-labelledby="reset-title" onMouseDown={(event) => event.stopPropagation()}>
            <span className="confirmation-thread" aria-hidden="true">〰</span>
            <h2 id="reset-title">{copy.resetTitle}</h2>
            <p>{status === "saved" ? copy.resetSavedText : copy.resetText}</p>
            <div>
              <button className="confirm-cancel" type="button" onClick={() => setConfirmReset(false)}>{copy.resetCancel}</button>
              <button className="confirm-reset" type="button" onClick={() => { resetDraft(); setConfirmReset(false); }}>{copy.resetConfirm}</button>
            </div>
          </section>
        </div>
      )}

      {authOpen && (
        <div className="modal-backdrop auth-backdrop" role="presentation" onMouseDown={() => setAuthOpen(false)}>
          <section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" type="button" onClick={() => setAuthOpen(false)} aria-label={copy.close}>×</button>
            <p className="auth-kicker">{locale === "en" ? "BETWEEN YARN" : "织间"}</p>
            <h2 id="auth-title">{locale === "en" ? "Sign in or create an account" : "登录或创建账号"}</h2>
            <p className="auth-intro">{locale === "en" ? "Sign in to save your swatches and receive free daily generations." : "登录后可保存合股样图，并获得每日免费生成次数。"}</p>
            <button className="google-button" type="button" onClick={startGoogleAuth}><span className="google-button-content"><svg className="google-logo" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.35 12.25c0-.73-.07-1.44-.2-2.12H12v4.01h5.23a4.47 4.47 0 0 1-1.94 2.93v2.61h3.15c1.84-1.7 2.91-4.21 2.91-7.43Z"/><path fill="#34A853" d="M12 21.75c2.62 0 4.82-.87 6.44-2.36l-3.15-2.44c-.87.58-1.99.92-3.29.92-2.53 0-4.68-1.71-5.45-4.01H3.3v2.52A9.74 9.74 0 0 0 12 21.75Z"/><path fill="#FBBC05" d="M6.55 13.86A5.85 5.85 0 0 1 6.25 12c0-.65.11-1.28.3-1.86V7.62H3.3A9.74 9.74 0 0 0 2.25 12c0 1.58.38 3.07 1.05 4.38l3.25-2.52Z"/><path fill="#EA4335" d="M12 6.13c1.43 0 2.71.49 3.72 1.45l2.79-2.79C16.81 3.2 14.62 2.25 12 2.25A9.74 9.74 0 0 0 3.3 7.62l3.25 2.52C7.32 7.84 9.47 6.13 12 6.13Z"/></svg>{locale === "en" ? "Continue with Google" : "使用 Google 继续"}</span></button>
            <div className="auth-divider"><span>{locale === "en" ? "or" : "或"}</span></div>
            <form onSubmit={codeSent ? verifyEmailCode : requestEmailCode}>
              <label><span>{locale === "en" ? "Email" : "邮箱"}</span><input type="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} required autoComplete="email" placeholder={locale === "en" ? "you@example.com" : "name@example.com"} /></label>
              {codeSent && <label><span>{locale === "en" ? "Verification code" : "验证码"}</span><input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={authCode} onChange={(event) => setAuthCode(event.target.value.replace(/\D/g, ""))} required autoComplete="one-time-code" placeholder={locale === "en" ? "Six-digit code" : "输入六码验证码"} /></label>}
              <button className="auth-submit" type="submit" disabled={authSubmitting}>{authSubmitting ? (locale === "en" ? "Please wait…" : "请稍候…") : codeSent ? (locale === "en" ? "Verify and sign in" : "验证并登录") : (locale === "en" ? "Send verification code" : "发送验证码")}</button>
            </form>
            {codeSent && <button className="auth-switch" type="button" onClick={() => { setCodeSent(false); setAuthEmail(""); setAuthCode(""); setAuthNotice(""); setCodeHelpOpen(false); }} disabled={authSubmitting}>{locale === "en" ? "Use a different email" : "换一个邮箱"}</button>}
            {codeSent && <div className="code-help"><button type="button" onClick={() => setCodeHelpOpen((open) => !open)}>{locale === "en" ? "Didn't receive the code?" : "没有收到验证码？"}</button>{codeHelpOpen && <p>{locale === "en" ? <>Check spam, promotions, and that the email is correct. Wait one minute, then <button type="button" onClick={() => void sendEmailCode()} disabled={authSubmitting}>resend the code</button>. If it still does not arrive, <a href="/#contact" onClick={() => setAuthOpen(false)}>use the contact details on our homepage</a>.</> : <>请先检查垃圾邮件、推广邮件和邮箱拼写。等待一分钟后可 <button type="button" onClick={() => void sendEmailCode()} disabled={authSubmitting}>重新发送验证码</button>。仍未收到请 <a href="/#contact" onClick={() => setAuthOpen(false)}>遵照首页联系方式联系我们</a>。</>}</p>}</div>}
            {authNotice && <p className="auth-notice" role="status">{authNotice}</p>}
          </section>
        </div>
      )}

      {profileOpen && memberEmail && (
        <div className="modal-backdrop profile-backdrop" role="presentation" onMouseDown={() => setProfileOpen(false)}>
          <section className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" type="button" onClick={() => setProfileOpen(false)} aria-label={copy.close}>×</button>
            <p className="auth-kicker">{locale === "en" ? "ACCOUNT" : "个人主页"}</p>
            <h2 id="profile-title">{locale === "en" ? "Your profile" : "我的账号"}</h2>
            <div className="profile-summary"><img src={memberAvatar || "/avatar-default.png"} alt="" /><div><strong>{memberEmail}</strong><button className="avatar-upload" type="button" onClick={() => setAvatarChoiceOpen(true)}>{locale === "en" ? "Change avatar" : "更换头像"}</button><input ref={avatarInputRef} className="avatar-input" type="file" accept="image/jpeg,image/png,image/webp,.heic,.heif" onChange={(event) => { void updateAvatar(event.target.files?.[0]); event.currentTarget.value = ""; }} /></div></div>
            <p className="profile-note">{locale === "en" ? "Your account uses Google sign-in or a one-time email verification code. There is no password to manage." : "账号使用 Google 登录或邮箱一次性验证码，无需设置和修改密码。"}</p>
            {profileNotice && <p className="profile-message" role="status">{profileNotice}</p>}
            <button className="profile-signout" type="button" onClick={signOut}>{locale === "en" ? "Sign out" : "退出登录"}</button>
          </section>
        </div>
      )}

      {avatarChoiceOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setAvatarChoiceOpen(false)}>
          <section className="avatar-choice-modal" role="dialog" aria-modal="true" aria-label={locale === "en" ? "Change avatar" : "更换头像"} onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" type="button" onClick={() => setAvatarChoiceOpen(false)} aria-label={copy.close}>×</button>
            <p className="auth-kicker">{locale === "en" ? "PROFILE" : "个人主页"}</p><h2>{locale === "en" ? "Change avatar" : "更换头像"}</h2>
            <button type="button" className="avatar-choice-primary" onClick={() => avatarInputRef.current?.click()}>{locale === "en" ? "Upload from photos or files" : "从相册或本地文件上传"}</button>
            <button type="button" className="avatar-choice-secondary" onClick={useDefaultAvatar}>{locale === "en" ? "Use default avatar" : "使用默认头像"}</button>
          </section>
        </div>
      )}

      {avatarCrop && (
        <div className="modal-backdrop" role="presentation">
          <section className="avatar-crop-modal" role="dialog" aria-modal="true" aria-label={locale === "en" ? "Crop avatar" : "裁切头像"}>
            <button className="modal-close" type="button" onClick={closeAvatarCrop} aria-label={copy.close}>×</button>
            <p className="auth-kicker">{locale === "en" ? "AVATAR" : "头像"}</p><h2>{locale === "en" ? "Choose the visible area" : "框选头像区域"}</h2><p>{locale === "en" ? "Drag the photo within the circular frame, then adjust its size." : "拖动照片来选择圆形头像区域，也可以调节大小。"}</p>
            <div className="avatar-crop-window" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); avatarDragRef.current = { x: event.clientX, y: event.clientY, offsetX: avatarOffset.x, offsetY: avatarOffset.y }; }} onPointerMove={(event) => { const drag = avatarDragRef.current; if (!drag) return; setAvatarOffset(clampAvatarOffset({ x: drag.offsetX + event.clientX - drag.x, y: drag.offsetY + event.clientY - drag.y })); }} onPointerUp={() => { avatarDragRef.current = null; }}>
              <img src={avatarCrop.src} alt="" style={{ width: `${avatarCrop.width * 260 / Math.min(avatarCrop.width, avatarCrop.height)}px`, height: `${avatarCrop.height * 260 / Math.min(avatarCrop.width, avatarCrop.height)}px`, transform: `translate(-50%, -50%) translate(${avatarOffset.x}px, ${avatarOffset.y}px) scale(${avatarZoom})` }} />
              <span aria-hidden="true" />
            </div>
            <label className="avatar-zoom"><span>{locale === "en" ? "Size" : "大小"}</span><input type="range" min="1" max="2.8" step="0.01" value={avatarZoom} onChange={(event) => { const zoom = Number(event.target.value); setAvatarZoom(zoom); setAvatarOffset(clampAvatarOffset(avatarOffset, avatarCrop, zoom)); }} /></label>
            <button type="button" className="avatar-choice-primary" onClick={() => void saveAvatarCrop()}>{locale === "en" ? "Use this avatar" : "使用这张头像"}</button>
          </section>
        </div>
      )}

    </main>
  );
}
