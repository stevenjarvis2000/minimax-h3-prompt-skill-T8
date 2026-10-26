/*
 * 静态版 shim：把 Electron preload 暴露的 window.promptLibrary 用纯浏览器能力实现。
 * 渲染层（vendor/app.js）原样复用，只在这里替换「主进程那一半」。
 * 不包含：AI 增强工作台、本地 GGUF、更新检查、项目/凭证存储（需要主进程 + 磁盘 + 网络）。
 */
(function installStaticShim() {
  "use strict";

  const RELEASES_URL = "https://github.com/T8mars/minimax-h3-prompt-skill-T8/releases/latest";
  // 注意：本文件先于 data/catalog.js 执行，数据必须用时再取
  const buildMeta = () => window.__T8_BUILD__ || {};

  function toast(message) {
    const node = document.querySelector("#toast");
    if (!node) return;
    node.textContent = message;
    node.dataset.visible = "true";
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => {
      node.dataset.visible = "false";
    }, 2600);
  }

  async function copyText(text) {
    const value = String(text ?? "");
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch {
      /* 落到 textarea 兜底 */
    }
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    if (!ok) throw new Error("当前浏览器不允许剪贴板写入");
    return true;
  }

  function requireCatalog() {
    const catalog = window.__T8_CATALOG__;
    if (!catalog) throw new Error("data/catalog.js 没有加载：请先运行 node build.mjs 生成目录数据");
    return catalog;
  }

  const implemented = {
    loadCatalog: async () => requireCatalog(),
    copyText,
    openExternal: async (url) => {
      const value = String(url || "");
      if (!/^https:\/\//u.test(value)) throw new Error("只允许打开 HTTPS 链接");
      const opened = window.open(value, "_blank", "noopener,noreferrer");
      if (!opened) throw new Error("浏览器拦截了新窗口");
      return true;
    },
    mediaInstallInfo: async () => ({
      mediaRoot: buildMeta().mediaRoot || "media/",
      manifestPresent: buildMeta().mediaManifestPresent === true,
      archivePartCount: 3,
      releaseUrl: RELEASES_URL
    }),
    openMediaFolder: async () => {
      throw new Error("静态版没有文件系统权限，无法打开目录；解压位置见说明");
    },
    checkForUpdates: async () => {
      const meta = buildMeta();
      return {
        state: "current",
        message: meta.catalogVersion
          ? `静态版 v${meta.catalogVersion}（数据生成于 ${meta.generatedAt || "未知"}），不联网检查更新`
          : "静态版不检查更新"
      };
    },
    installUpdate: () => {},
    onUpdateStatus: () => () => {}
  };

  const unavailable = new Proxy(
    {},
    {
      get: (_target, key) => async () => {
        throw new Error(`静态版不提供 ${String(key)}（该能力依赖 Electron 主进程）`);
      }
    }
  );

  window.promptLibrary = new Proxy(implemented, {
    get(target, key) {
      if (key in target) return target[key];
      if (typeof key === "string") return unavailable[key];
      return undefined;
    }
  });

  // 静态版没有工作台：把入口按钮从界面上拿掉，避免点开空壳
  document.addEventListener("DOMContentLoaded", () => {
    for (const selector of ["#open-prompt-workbench", "#install-update"]) {
      document.querySelector(selector)?.classList.add("hidden");
    }
    document.querySelector("#open-prompt-workbench")?.remove();
    const checkButton = document.querySelector("#check-update");
    if (checkButton) checkButton.addEventListener("click", () => toast("静态版不检查更新，数据版本见页首 CATALOG"));
    const meta = buildMeta();
    if (meta.generatedAt) {
      const version = document.querySelector("#catalog-version");
      if (version) version.title = `静态数据生成于 ${meta.generatedAt}`;
    }
  });
})();
