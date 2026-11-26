# Between Yarn · 织间

An image-based yarn pairing studio. Upload two yarn photos to preview how they look when held together, then save combinations to a personal inspiration library.

Live site: [betweenyarn.com](https://betweenyarn.com)

## Features

- Generate a knitted swatch preview from two yarn photos.
- Keep yarn names and colour notes with each combination.
- Sign in with Google or an email verification code.
- Save, revisit, and remove swatches from a personal inspiration library.
- Responsive interface in Simplified Chinese, Traditional Chinese, and English.

## Run locally

### Requirements

- Node.js `>=22.13.0`
- pnpm

```bash
pnpm install
pnpm dev
```

Open the local URL printed by Vite. To create a production build:

```bash
pnpm build
```

The local Cloudflare configuration uses placeholder D1 and R2 resources. Features that need persistent storage or external services require equivalent bindings and credentials in your development or deployment environment.

## Runtime configuration

The application expects these server-side secrets and bindings in its Cloudflare Workers environment:

| Name | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Generates yarn swatch previews through the OpenAI Images API. |
| `RESEND_API_KEY` | Sends email sign-in verification codes through Resend. |
| `DB` | Cloudflare D1 database for accounts, sessions, verification codes, and saved swatches. |
| `YARN_MEDIA` | Cloudflare R2 bucket for uploaded yarn photos and generated previews. |

Never commit API keys or other private credentials. Store them as deployment secrets and keep local values in ignored `.env*` files. Google sign-in also requires the deployed domain to be allowed in the Google OAuth client configuration.

## Build notes

This project uses [vinext](https://github.com/cloudflare/vinext) with the Cloudflare Vite plugin and Workers runtime. `.openai/hosting.json` declares the Site's D1 and R2 bindings. The deployment environment must provide the bindings and secrets listed above.

## License

No license has been specified yet. All rights reserved unless the repository owner adds a license.

---

# 织间 · Between Yarn

一个毛线搭配预览工具。上传两张毛线照片，看看它们并股织成小样后的颜色与质感，并可将搭配保存到个人灵感库。

线上网站：[betweenyarn.com](https://betweenyarn.com)

## 功能

- 根据两张毛线照片生成针织小样预览。
- 为每种搭配记录毛线名称与颜色备注。
- 使用 Google 账号或邮箱验证码登录。
- 将小样保存到个人灵感库，之后查看或移除。
- 支持简体中文、繁体中文和英文，并适配手机与桌面页面。

## 本地运行

### 环境要求

- Node.js `>=22.13.0`
- pnpm

```bash
pnpm install
pnpm dev
```

打开 Vite 输出的本地网址。生成生产构建：

```bash
pnpm build
```

本地 Cloudflare 配置使用占位 D1 和 R2 资源。需要持久化存储或调用外部服务的功能，须在开发或部署环境配置对应绑定和凭据。

## 运行时配置

应用在 Cloudflare Workers 环境中需要以下服务端密钥和绑定：

| 名称 | 用途 |
| --- | --- |
| `OPENAI_API_KEY` | 通过 OpenAI Images API 生成毛线小样预览。 |
| `RESEND_API_KEY` | 通过 Resend 发送邮箱登录验证码。 |
| `DB` | Cloudflare D1 数据库，用于账号、会话、验证码和已保存小样。 |
| `YARN_MEDIA` | Cloudflare R2 存储桶，用于上传的毛线照片和生成的预览图。 |

请勿将 API 密钥或其他私密凭据提交到仓库。请将密钥配置为部署环境的 Secret；本地密钥应放在已忽略的 `.env*` 文件中。Google 登录还要求在 Google OAuth 客户端配置中允许线上域名。

## 构建说明

项目使用 [vinext](https://github.com/cloudflare/vinext)、Cloudflare Vite 插件和 Workers 运行环境。`.openai/hosting.json` 声明了 Site 使用的 D1 与 R2 绑定。部署环境需要提供上表列出的绑定和密钥。

## 许可证

目前尚未指定许可证。除非仓库所有者另行添加许可证，代码版权保留。
