/*
 * 静态版真机验收：用 CDP 驱动 headless Chrome，逐条跑真实交互并断言。
 * 用法：node verify.mjs [file:// 地址] [--shot <png 输出路径>]
 */
const target = process.argv[2] || "file:///workspace/steven/tasks/x-minimax-h3-prompt-skill-T8/apps/prompt-library-web/index.html";
const shotIndex = process.argv.indexOf("--shot");
const shotPath = shotIndex > 0 ? process.argv[shotIndex + 1] : null;

const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = list.find((t) => t.type === "page");
if (!page) throw new Error("没有可用的 page target");

const ws = new WebSocket(page.webSocketDebuggerUrl);
ws.binaryType = "arraybuffer";
let nextId = 0;
const pending = new Map();
ws.addEventListener("message", async (event) => {
  let text = event.data;
  if (text instanceof ArrayBuffer) text = Buffer.from(text).toString("utf8");
  else if (typeof text !== "string") text = await text.text();
  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    return;
  }
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject, timer } = pending.get(msg.id);
    pending.delete(msg.id);
    clearTimeout(timer);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
});
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP 超时：${method}`));
    }, 45000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });

const evaluate = async (expression) => {
  const res = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
  return res.result.value;
};

const results = [];
const check = (name, passed, detail = "") => {
  results.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", { url: target });
await new Promise((r) => setTimeout(r, 2500));

// 1 数据加载
const counts = await evaluate(`(() => {
  const t = (s) => document.querySelector(s)?.textContent?.trim() || "";
  return {
    all: t("#view-all-count"), cases: t("#view-case-count"), official: t("#view-official-count"),
    community: t("#view-community-count"), version: t("#catalog-version"),
    cards: document.querySelectorAll("#case-grid .case-card").length,
    warningHidden: document.querySelector("#catalog-warning")?.classList.contains("hidden") !== false,
    queryError: document.querySelector("#catalog-warning")?.textContent || ""
  };
})()`);
check("目录数据加载（613 案例 / 9 官方 / 2 社区）", counts.cases === "613" && counts.official === "9" && counts.community === "2", JSON.stringify(counts));
check("网格渲染案例卡", counts.cards === 624, `cards=${counts.cards}`);
check("无目录警告", counts.warningHidden, counts.queryError);

// 2 缩略图走 poster 而不是 30MB GIF
const thumbs = await evaluate(`(() => {
  const imgs = [...document.querySelectorAll("#case-grid .card-media img")];
  const gifOnly = imgs.filter((i) => !i.src.includes("poster.webp"));
  return { total: imgs.length, poster: imgs.filter((i) => i.src.includes("poster.webp")).length, gifOnly: gifOnly.map((i) => i.src.split("/").slice(-2).join("/")), sample: imgs[0]?.src || "" };
})()`);
// 官方/社区 Skill 目录只提供 gif 预览，没有 poster，允许回落到 gif
check("网格缩略图用 poster.webp（仅无 poster 的 Skill 回落 gif）", thumbs.total > 0 && thumbs.poster >= thumbs.total - 12, JSON.stringify(thumbs));

// 3 poster 真实可加载（file:// 相对路径 + 编码）
const posterLoads = await evaluate(`(async () => {
  const imgs = [...document.querySelectorAll("#case-grid .card-media img")].slice(0, 6);
  await Promise.all(imgs.map((img) => img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; setTimeout(r, 4000); })));
  return { ok: imgs.filter((i) => i.naturalWidth > 0).length, total: imgs.length, broken: imgs.filter((i) => i.src && i.naturalWidth === 0).map((i) => i.src.slice(-40)) };
})()`);
check("poster 图片真的解码成功", posterLoads.ok === posterLoads.total, JSON.stringify(posterLoads));

// 4 搜索过滤
const search = await evaluate(`(() => {
  const input = document.querySelector("#search");
  input.value = "收纳";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return new Promise((resolve) => setTimeout(() => resolve({
    cards: document.querySelectorAll("#case-grid .case-card").length,
    emptyShown: !document.querySelector("#empty-state")?.classList.contains("hidden")
  }), 400));
})()`);
check("搜索过滤生效", search.cards > 0 && search.cards < 624, JSON.stringify(search));

// 5 清空筛选恢复
const cleared = await evaluate(`(() => {
  document.querySelector("#clear-filters").click();
  return new Promise((resolve) => setTimeout(() => resolve(document.querySelectorAll("#case-grid .case-card").length), 400));
})()`);
check("清除筛选恢复全量", cleared === 624, `cards=${cleared}`);

// 6 排序切换
const sorted = await evaluate(`(() => {
  const sel = document.querySelector("#sort-order");
  const titles = () => [...document.querySelectorAll("#case-grid .case-card .card-title")].slice(0, 3).map((n) => n.textContent.trim());
  // 先复位，避免上一轮验证留下的 localStorage 影响判断
  sel.value = "oldest-added";
  sel.dispatchEvent(new Event("change", { bubbles: true }));
  return new Promise((resolve) => setTimeout(() => {
    const before = titles();
    sel.value = "title-asc";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    setTimeout(() => resolve({ before, after: titles() }), 400);
  }, 400));
})()`);
check("排序切换改变顺序", JSON.stringify(sorted.before) !== JSON.stringify(sorted.after), JSON.stringify(sorted.after));

// 7 打开详情：标题 / Creative DNA / 提示词正文
const detail = await evaluate(`(() => {
  document.querySelector("#case-grid .case-card").click();
  return new Promise((resolve) => setTimeout(() => {
    const prompt = document.querySelector("#prompt-text")?.textContent || "";
    resolve({
      open: document.querySelector("#case-dialog").open,
      title: document.querySelector("#detail-title")?.textContent?.trim() || "",
      promptLen: prompt.length,
      promptHead: prompt.slice(0, 60),
      dnaBlocks: document.querySelector("#creative-dna")?.children.length || 0,
      metaRows: document.querySelector("#detail-meta")?.children.length || 0,
      validation: document.querySelector("#validation-grid")?.children.length || 0
    });
  }, 700));
})()`);
check("详情弹窗打开且有标题", detail.open && detail.title.length > 0, detail.title);
check("MiniMax H3 提示词正文非空", detail.promptLen > 200, `len=${detail.promptLen} head=${JSON.stringify(detail.promptHead)}`);
check("Creative DNA / 元信息 / 验收区渲染", detail.dnaBlocks > 2 && detail.metaRows > 2, JSON.stringify({ dna: detail.dnaBlocks, meta: detail.metaRows, validation: detail.validation }));

// 8 提示词模型切换
const promptSwitch = await evaluate(`(() => {
  const before = document.querySelector("#prompt-text").textContent;
  document.querySelector("#tab-seedance").click();
  return new Promise((resolve) => setTimeout(() => resolve({
    changed: document.querySelector("#prompt-text").textContent !== before,
    len: document.querySelector("#prompt-text").textContent.length
  }), 400));
})()`);
check("Seedance 2.0 提示词切换独立", promptSwitch.changed && promptSwitch.len > 200, JSON.stringify(promptSwitch));

// 9 详情 GIF 是否真的加载（file:// 大文件）
const gifLoads = await evaluate(`(async () => {
  const img = document.querySelector("#detail-media img");
  if (!img) return { present: false };
  await new Promise((r) => { if (img.complete) return r(); img.onload = r; img.onerror = r; setTimeout(r, 12000); });
  return { present: true, src: img.src.slice(-45), w: img.naturalWidth, h: img.naturalHeight };
})()`);
check("详情 GIF 真的解码成功", gifLoads.present && gifLoads.w > 0, JSON.stringify(gifLoads));

// 10 复制按钮（剪贴板降级路径）
const copy = await evaluate(`(async () => {
  document.querySelector("#copy-prompt").click();
  await new Promise((r) => setTimeout(r, 300));
  return document.querySelector("#toast")?.textContent?.trim() || "";
})()`);
check("复制提示词给出反馈", copy.length > 0, copy);

// 11 收藏写入 localStorage
const favorite = await evaluate(`(() => {
  const btn = document.querySelector("#detail-favorite");
  const beforePressed = btn.getAttribute("aria-pressed");
  const readCount = () => {
    const raw = localStorage.getItem("t8-personal-library-v1");
    const data = raw ? JSON.parse(raw) : {};
    return (data.favorites || []).length;
  };
  const before = readCount();
  btn.click();
  return new Promise((resolve) => setTimeout(() => {
    const after = readCount();
    resolve({ beforePressed, afterPressed: btn.getAttribute("aria-pressed"), before, after,
      badge: document.querySelector("#view-favorite-count")?.textContent?.trim() });
  }, 400));
})()`);
check("收藏可切换并同步 localStorage 与计数", favorite.afterPressed !== favorite.beforePressed && favorite.after === favorite.before + (favorite.afterPressed === "true" ? 1 : -1), JSON.stringify(favorite));

// 12 关闭详情 + 双语切换
const locale = await evaluate(`(() => {
  document.querySelector("#close-dialog").click();
  document.querySelector("#global-locale-en").click();
  return new Promise((resolve) => setTimeout(() => resolve({
    title: document.querySelector("#page-title")?.textContent?.trim() || "",
    kicker: document.querySelector("#page-kicker")?.textContent?.trim() || "",
    cardTitle: document.querySelector("#case-grid .case-card .card-title")?.textContent?.trim() || ""
  }), 500));
})()`);
check("英文界面切换生效", /prompt|case|video/i.test(locale.kicker + locale.title), JSON.stringify(locale));

// 13 对比流程
const compare = await evaluate(`(() => {
  document.querySelector("#global-locale-zh").click();
  document.querySelector("#view-cases").click();
  return new Promise((resolve) => setTimeout(() => {
    const toggles = [...document.querySelectorAll("#case-grid .compare-toggle")].slice(0, 2);
    toggles.forEach((t) => t.click());
    return setTimeout(() => {
      const open = document.querySelector("#open-compare");
      const disabled = open.disabled;
      open.click();
      setTimeout(() => resolve({
        disabled,
        dialogOpen: document.querySelector("#compare-dialog").open,
        columns: document.querySelectorAll("#compare-grid > *").length
      }), 600);
    }, 400);
  }, 400));
})()`);
check("对比：选 2 条后打开并排视图", compare.dialogOpen === true && compare.columns > 0, JSON.stringify(compare));

// 14 媒体包安装说明弹窗
const mediaGuide = await evaluate(`(() => {
  document.querySelector("#close-compare").click();
  document.querySelector("#case-grid .case-card").click();
  return new Promise((resolve) => setTimeout(() => {
    const help = document.querySelector("#detail-media .media-fallback button");
    if (!help) return resolve({ buttonFound: false });
    help.click();
    setTimeout(() => resolve({
      buttonFound: true,
      open: document.querySelector("#media-install-dialog").open,
      path: document.querySelector("#media-install-path")?.textContent?.trim() || "",
      status: document.querySelector("#media-install-status")?.textContent?.trim() || ""
    }), 500);
  }, 600));
})()`);
check("完整视频包说明弹窗可打开", mediaGuide.open === true, JSON.stringify(mediaGuide));

// 15 静态版明确不提供的能力
const workbench = await evaluate(`(async () => {
  const btn = document.querySelector("#open-prompt-workbench");
  let rejected = "";
  try { await window.promptLibrary.promptProviders(); } catch (e) { rejected = e.message; }
  const update = await window.promptLibrary.checkForUpdates();
  return { buttonRemoved: !btn, rejected, update: update.message };
})()`);
check("工作台入口已移除、IPC 能力明确拒绝", workbench.buttonRemoved && workbench.rejected.includes("静态版"), JSON.stringify(workbench));

// 16 真实案例（30 MB 级 GIF）在详情里能解码 —— 官方 Skill 的小 gif 不算
const caseGif = await evaluate(`(() => {
  document.querySelector("#media-install-dialog")?.close();
  document.querySelector("#close-dialog")?.click();
  document.querySelector("#view-cases").click();
  return new Promise((resolve) => setTimeout(() => {
    document.querySelector("#case-grid .case-card").click();
    setTimeout(async () => {
      const img = document.querySelector("#detail-media img");
      if (!img) return resolve({ present: false });
      await new Promise((r) => { if (img.complete) return r(); img.onload = r; img.onerror = r; setTimeout(r, 20000); });
      resolve({ present: true, src: img.src.split("/").slice(-3).join("/"), w: img.naturalWidth, h: img.naturalHeight });
    }, 900);
  }, 600));
})()`);
check("真实案例大 GIF 在详情里解码成功", caseGif.present && caseGif.w > 0 && caseGif.src.startsWith("cases/"), JSON.stringify(caseGif));

if (shotPath) {
  await evaluate(`(() => { document.querySelector("#close-dialog")?.click(); document.querySelector("#media-install-dialog")?.close(); window.scrollTo(0,0); })()`);
  await new Promise((r) => setTimeout(r, 600));
  const shot = await send("Page.captureScreenshot", { format: "png" });
  const { writeFileSync } = await import("node:fs");
  writeFileSync(shotPath, Buffer.from(shot.data, "base64"));
  console.log(`截图：${shotPath}`);
}

const failed = results.filter((r) => !r.passed);
console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
if (failed.length) {
  console.log("失败项：" + failed.map((f) => f.name).join(" / "));
  process.exitCode = 1;
}
ws.close();
