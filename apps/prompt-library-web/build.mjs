#!/usr/bin/env node
/*
 * 静态版目录数据生成器。
 *
 * 直接复用桌面版的目录解析逻辑（apps/prompt-library-desktop/lib/catalog.cjs），
 * 把 613 个案例 + 284 个技能读成一份浏览器可直接用的 JS 数据，
 * 唯一改动是把 Electron 的 t8media:// 资源地址换成相对路径：
 *   scope=catalog → ../../catalog/<relativePath>   （GIF / poster，仓库里就有）
 *   scope=media   → media/<relativePath>           （可选：解压出来的 mp4 媒体包）
 *
 * 用法：
 *   node build.mjs                 # 用 apps/prompt-library-web/media 作为媒体包目录（存在则启用 mp4）
 *   node build.mjs --media <dir>   # 指定媒体目录
 *   node build.mjs --out <file>    # 指定输出文件
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

function parseArgs(argv) {
  const out = { media: null, out: path.join(here, "data", "catalog.js"), thumb: "poster" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--media") out.media = argv[++i];
    else if (arg === "--out") out.out = path.resolve(argv[++i]);
    else if (arg === "--thumb") out.thumb = String(argv[++i] || "").trim();
    else if (arg === "--help" || arg === "-h") {
      console.log("node build.mjs [--media <media-dir>] [--out <catalog.js>] [--thumb poster|gif]");
      process.exit(0);
    } else {
      console.error(`未知参数：${arg}`);
      process.exit(1);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const catalogRoot = path.join(repoRoot, "catalog");
const skillsRoot = path.join(repoRoot, "skills");
const mediaRoot = path.resolve(args.media || path.join(here, "media"));

for (const [label, dir] of [["catalog", catalogRoot], ["skills", skillsRoot]]) {
  if (!existsSync(dir)) {
    console.error(`找不到 ${label} 目录：${dir}`);
    process.exit(1);
  }
}
const mediaAvailable = existsSync(mediaRoot) && statSync(mediaRoot).isDirectory();

const { loadCatalog } = require(path.join(repoRoot, "apps", "prompt-library-desktop", "lib", "catalog.cjs"));

const encodePath = (value) => String(value).split("/").map(encodeURIComponent).join("/");

function toUrl(asset, scopePrefix) {
  if (!asset) return null;
  const scope = asset.scope;
  const relative = encodePath(asset.relativePath);
  if (scope === "media") return `media/${relative}`;
  if (scope === "catalog") return `../../catalog/${relative}`;
  return `${scopePrefix}${relative}`;
}

const thumbMode = args.thumb === "gif" ? "gif" : "poster";
if (!["poster", "gif"].includes(args.thumb)) {
  console.error(`--thumb 只能是 poster 或 gif，收到：${args.thumb}`);
  process.exit(1);
}

const serializeMediaItem = (item, mediaPresent) => {
  const media = item.media || {};
  const videoUrl = media.video ? toUrl(media.video) : null;
  const gifUrl = toUrl(media.gif, "");
  const posterUrl = toUrl(media.poster, "");
  return {
    ...item,
    media: {
      gifUrl,
      posterUrl,
      // 网格缩略图：poster 模式用静态帧（约 35 KB/条），gif 模式与桌面版完全一致
      thumbUrl: thumbMode === "poster" ? posterUrl || gifUrl : gifUrl || posterUrl,
      videoUrl: mediaPresent ? videoUrl : null,
      hasFullVideo: Boolean(mediaPresent && media.video),
      previewKind: media.previewKind || "source_preview",
      previewStatus: media.previewStatus || {}
    }
  };
};

const startedAt = Date.now();
const catalog = loadCatalog({
  catalogRoot,
  mediaRoot: mediaAvailable ? mediaRoot : null,
  skillsRoot
});

const payload = {
  schemaVersion: catalog.schemaVersion,
  catalogVersion: catalog.catalogVersion,
  generatedAt: catalog.generatedAt,
  warnings: catalog.warnings,
  officialSkills: catalog.officialSkills.map((item) => serializeMediaItem(item, mediaAvailable)),
  communitySkills: catalog.communitySkills.map((item) => serializeMediaItem(item, mediaAvailable)),
  cases: catalog.cases.map((item) => serializeMediaItem(item, mediaAvailable))
};

const buildMeta = {
  generatedAt: new Date().toISOString(),
  catalogVersion: catalog.catalogVersion,
  counts: {
    cases: payload.cases.length,
    officialSkills: payload.officialSkills.length,
    communitySkills: payload.communitySkills.length,
    warnings: payload.warnings.length,
    withVideo: [...payload.cases, ...payload.officialSkills, ...payload.communitySkills].filter((item) => item.media.hasFullVideo).length
  },
  thumbMode,
  mediaRoot: mediaAvailable ? "media/" : "",
  mediaManifestPresent: mediaAvailable && existsSync(path.join(mediaRoot, "media-pack-manifest.json")),
  sourceRepo: repoRoot
};

const body = [
  "/* 自动生成，请勿手改。重新生成：node build.mjs */",
  `window.__T8_BUILD__ = ${JSON.stringify(buildMeta)};`,
  `window.__T8_CATALOG__ = ${JSON.stringify(payload)};`,
  ""
].join("\n");

mkdirSync(path.dirname(args.out), { recursive: true });
writeFileSync(args.out, body, "utf8");

const sizeMb = (Buffer.byteLength(body) / 1024 / 1024).toFixed(2);
console.log(`输出：${args.out}`);
console.log(`大小：${sizeMb} MB，耗时 ${Date.now() - startedAt} ms`);
console.log(`案例 ${buildMeta.counts.cases} / 官方技能 ${buildMeta.counts.officialSkills} / 社区技能 ${buildMeta.counts.communitySkills}`);
console.log(`带完整视频：${buildMeta.counts.withVideo}（媒体目录${mediaAvailable ? `：${mediaRoot}${buildMeta.mediaManifestPresent ? "，已检测到 media-pack-manifest.json" : "，未检测到 media-pack-manifest.json"}` : "未启用"}）`);
if (buildMeta.counts.warnings) console.log(`目录警告 ${buildMeta.counts.warnings} 条（会显示在页面顶部）`);
