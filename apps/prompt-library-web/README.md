# T8 Prompt Library · 静态版

把桌面版 `apps/prompt-library-desktop`（Electron）的**浏览半边**复刻成纯静态 HTML：
不打包、不装 Electron、不需要主进程，双击 `index.html` 就能用仓库里的 613 个案例 + 284 个技能。

## 打开方式

**A. 直接双击（file://）** —— 推荐，零依赖
```
apps/prompt-library-web/index.html
```

**B. 起个静态服务**（想让局域网/其他设备看时）。根目录必须是**仓库根**，不是本目录——
因为 GIF/poster 用的是相对路径 `../../catalog/...`：
```bash
cd minimax-h3-prompt-skill-T8
python3 -m http.server 8766
# 打开 http://127.0.0.1:8766/apps/prompt-library-web/index.html
```

## 目录结构

```
apps/prompt-library-web/
├── index.html            渲染层外壳（由桌面版 src/index.html 裁剪：去掉工作台与 API 设置弹窗）
├── styles.css            原样复用桌面版样式
├── shim.js               用浏览器能力实现 window.promptLibrary（替代 Electron preload）
├── vendor/
│   ├── app.js            桌面版渲染逻辑，仅 1 行改动（网格缩略图优先 poster）
│   ├── personal-library.js   收藏/合集/历史（localStorage）
│   └── catalog-sort.js       排序逻辑
├── data/catalog.js       生成物（已入库）：17.7 MB，613 案例 + 9 官方 + 2 社区（含提示词、双语、Creative DNA）
├── build.mjs             生成 data/catalog.js
├── verify.mjs            20 项真机验收（CDP 驱动 headless Chrome）
└── README.md
```

## 数据文件

`data/catalog.js` 已随库提供，clone 完直接打开 `index.html` 就能用，不必先构建。
它由 `build.mjs` 从仓库的 `catalog/` 与 `skills/` 现读生成（不是手写），
案例目录有更新或要切换缩略图模式时重跑一次并提交：

```bash
node build.mjs            # 重新生成 data/catalog.js
```

生成命令：

```bash
cd apps/prompt-library-web
node build.mjs                 # 默认：网格缩略图用 poster.webp
node build.mjs --thumb gif     # 与桌面版完全一致（缩略图直接加载 GIF，滚动会吃大量 IO）
node build.mjs --media <dir>   # 指定已解压的 mp4 媒体包目录，启用 <video> 播放
```

复用桌面版的目录解析源码（`apps/prompt-library-desktop/lib/catalog.cjs`），
所以案例读法、双语回退、发布状态过滤、警告收集与桌面版完全同源；唯一改写是把
Electron 的 `t8media://` 地址换成相对路径：

| 资源 scope | 桌面版 | 静态版 |
|---|---|---|
| `catalog`（GIF / poster） | `t8media://catalog/<path>` | `../../catalog/<path>` |
| `media`（完整 mp4） | `t8media://media/<id>/preview.mp4` | `media/<id>/preview.mp4` |

### 想要完整 MP4

从 Release 下载 `prompt-library-media-v1.4.8-part1~3.zip`（约 4.85 GB），
把三个包的内容**直接解压到 `apps/prompt-library-web/media/`**（根部能看到 `media-pack-manifest.json`），
再跑一次 `node build.mjs`。之后网格悬停播放、详情页直接播 mp4，"本地完整视频"统计也会变成 613。

## 通过第三方 CDN 访问（raw.githack / statically 等）

页面本身能被这类服务直出（HTML 里没有跨域依赖），但要注意它们的**资源会 302 到
raw.githubusercontent.com**，属于跨源加载。所以 `index.html` 的 CSP 已显式放行：

```
img-src / media-src ... https://raw.githubusercontent.com https://*.githubusercontent.com
                       https://raw.githack.com https://*.githack.com
```

自己改 CSP 时别把这两组域删掉，否则表现就是"页面出来了、卡片一片空白、图片全不加载"。
（本地 `file://` 与 GitHub Pages 同源，不需要这条也能显示。）

## 与桌面版的差异

| 能力 | 静态版 | 说明 |
|---|---|---|
| 列表 / 筛选 / 排序 / 搜索 | ✅ 原样 | 搜索、平台/模型/标签筛选、5 种排序、清除筛选 |
| 案例详情 + 双语切换 | ✅ 原样 | 概览、Quick start、Creative DNA、H3/Seedance 提示词、验收区 |
| 收藏 / 合集 / 历史 | ✅ 原样 | 存 localStorage（`t8-personal-library-v1`），清浏览器数据即清空 |
| 案例对比（最多 3 条） | ✅ 原样 | 并排看机制与两套提示词 |
| 复制提示词 / 概览 | ✅ 原样 | 剪贴板 API 不可用时自动降级到 execCommand |
| 打开来源链接 / GitHub | ✅ 改为新标签页 | 桌面版走 `shell.openExternal` |
| **AI 增强工作台**（路由、分镜、修稿、变体、Music 3、导出交接包） | ❌ 不含 | 需要主进程 + API Key + 本地文件与网络，静态页做不到；入口按钮已移除，直接调 IPC 会明确报错 |
| API 设置 / 本地 GGUF | ❌ 不含 | 同上（凭据存储属主进程职责） |
| 更新检查 | ❌ 改提示 | 点"检查更新"只回报静态数据版本与生成时间 |
| 打开媒体目录 | ❌ 不可用 | 浏览器无文件系统权限，改为页面内说明 |
| 网格缩略图 | ⚠️ 默认 poster | 桌面版直接把 GIF 当缩略图（7.4 GB / 613 个），浏览器里滚动会持续解码；静态版默认改用同帧 `poster.webp`（约 35 KB/条），GIF 在详情页播。`--thumb gif` 可切回 |

## 验收

`verify.mjs` 用 CDP 真机跑 20 项断言（不是"看起来能开"）：数据加载计数、网格渲染、缩略图来源、
poster/GIF 真实解码、搜索过滤、清除筛选、排序切换、详情弹窗、两套提示词切换、复制反馈、
收藏读写与计数、中英切换、对比并排、媒体包说明弹窗，以及"工作台能力被明确拒绝"。

```bash
# 1. 起一个开了调试端口的 Chrome（任意 Chrome / headless shell 都行）
chrome --headless=new --remote-debugging-port=9222 \
       --window-size=1440,1000 --no-sandbox --disable-gpu about:blank &

# 2. 跑验收（截图可选）；脚本默认连 127.0.0.1:9222
node verify.mjs "" --shot /tmp/shot.png
```

最近一次结果：**20 项全部通过**（案例 613 / 官方 9 / 社区 2，v1.4.8）。

## 已知限制

- `data/catalog.js` 单文件 17.7 MB（内含全部提示词与双语正文），首次打开需解析约 1 秒；
  换成按案例懒加载需要改渲染层，本次按"尽量少改桌面版代码"取舍。
- 媒体仍是仓库里的 GIF（每条 5–50 MB），详情页看动画会吃掉可观内存；装 mp4 包后更顺。
- file:// 下 Chrome/Safari 均可用；若浏览器禁止本地文件脚本，用上面 B 方式起服务。
