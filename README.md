# 刻 KE

Tauri 2 + React + TypeScript 健身训练记录应用。本地优先：所有数据保存在本机
SQLite 数据库，无账号、无云同步。

- 仓库：<https://github.com/noahal1/KE>

## 开发

```bash
npm install
npm run fetch-gifs     # 下载训练动作 GIF 到 public/gifs/(多镜像,可重跑补缺)
npm run tauri dev      # 启动桌面应用(热更新)
npm run dev            # 仅前端(浏览器,SQL 插件不可用)
```

动作演示 GIF 优先从本地 `public/gifs/` 加载(离线可用),缺失时自动回退到
gcore / jsdelivr CDN。国内网络访问 `cdn.jsdelivr.net` 常被阻断,所以首次
必须先跑一次 `npm run fetch-gifs`(脚本会自动选用可用的镜像)。

## 快速测试

### 1. 冒烟测试(秒级,不启动 UI)

```bash
node scripts/sql-smoke-test.cjs     # 内存 SQLite 运行真实迁移 + seed,执行前端所有 SQL 查询
node scripts/metrics-smoke-test.mjs # 肌肉理论数值库锚点+性质+边界测试(见 THEORY.md)
node scripts/fatigue-report.mjs     # 合成 5 周数据的疲劳报告(周容量对标/ACWR/单调性/deload)
node scripts/fit-import-smoke-test.mjs # Garmin .fit 导入:枚举解析/动作匹配/分组/入库 SQL
npx tsc --noEmit                    # 全量类型检查
```

适合改了 SQL、数据层或重构后快速确认没有破坏。

### 2. 完整应用 + 端到端巡检

```bash
npm run tauri dev                  # 先启动(WebView2 需开启远程调试端口 9333)
node scripts/cdp-e2e.cjs           # 通过 CDP 遍历所有路由、用真实 window.__TAURI__ 执行 SQL、收集控制台报错
```

其他 CDP 脚本:`cdp-interactions.cjs`(页面交互)、`cdp-error-probe.cjs` / `cdp-style-probe.cjs`(错误与样式探测)。

### 建议工作流

- 小改动 → `sql-smoke-test.cjs` + `tsc --noEmit`
- 大改动 → `tauri dev` + `cdp-e2e.cjs`

## 版本与发布

版本号需要四处同步(发布工作流会校验一致,不一致直接失败):

- `package.json`
- `src/version.ts`(`APP_VERSION`)
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`(同步 `src-tauri/Cargo.lock`)

发布流程:改完版本号提交后打 tag(如 `v0.2.1`)并推送,GitHub Actions 会
自动构建 Windows / macOS / Linux 桌面包和 Android APK/APK 分包,并创建
Release 附带全部产物:

```bash
git tag v0.2.1 && git push origin v0.2.1
```

本地手动打包:

```bash
npx tauri build              # 桌面安装包
npx tauri android build      # Android(需 SDK/NDK,产物在 src-tauri/gen/android/app/build/outputs/)
```

### Android 签名

CI 从仓库 secrets 读取签名密钥库为 release APK 签名(未配置时 workflow 会
额外产出 debug 签名 APK 兜底,可安装但不可上架):

| Secret | 内容 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | 密钥库文件的 base64(`signing/ke.keystore.b64`) |
| `ANDROID_KEYSTORE_PASSWORD` | 密钥库密码 |
| `ANDROID_KEY_ALIAS` | 密钥别名(本地为 `ke`) |
| `ANDROID_KEY_PASSWORD` | 密钥密码 |

本地重新生成密钥库(JDK 自带 keytool):

```bash
keytool -genkeypair -v -keystore signing/ke.keystore -alias ke \
  -keyalg RSA -keysize 4096 -validity 10950 \
  -dname "CN=KE, O=noahal1, C=CN"
base64 -w0 signing/ke.keystore > signing/ke.keystore.b64   # 粘贴进 secret
```

`signing/` 已被 .gitignore 排除,密钥库只存在于本机与 GitHub secrets。
**务必另存一份离线备份**:丢失后无法再给同一应用发签名更新。

## 肌肉部位标注

每个动作都会显示训练部位标签(主/次肌群,已汉化),数据来自数据库的
`primary_muscles` / `secondary_muscles` 字段:

- **动作库**:列表行显示部位标签,详情弹窗内嵌人体肌肉分布图(前后双视图,
  三档灰度:主肌群实心墨色、次肌群中灰、其余淡灰底)
- **动作选择器 / 计划日 / 进行中训练 / 历史详情**:动作行旁均带部位标签

人体图组件:`src/components/BodyMap.tsx`(纯 SVG,无需图片资源);几何数据
`src/data/body-model.json` 由 `scripts/generate-body-model.cjs` 从
[react-body-highlighter](https://github.com/GV79/react-body-highlighter)@2.0.5(MIT,
许可证见 `scripts/body-model-LICENSE`)抽取生成,已按本项目的肌群 key 归一化;
标签组件:`src/components/MuscleTags.tsx`;解析逻辑:`src/muscles.ts`。
新增肌群 key 时需同步更新 `scripts/generate-body-model.cjs` 的区域映射和
`i18n.ts` 的 `muscle.*` 翻译,然后重新生成数据文件。

调整人体图的比例/配色后,无需启动应用即可目视验证:

```bash
node scripts/preview-bodymap.cjs     # 截图生成到系统临时目录,打开 .png 查看
node scripts/check-bodymap-pixels.cjs # 像素级测量头/肩/腰/腿宽度比例
node scripts/diag-ascii.cjs           # 终端 ASCII 渲染快速目检
```

## Garmin .fit 导入

历史记录页右上角「导入 Garmin」:选择从 Garmin Connect 导出的力量训练 .fit
文件,解析组数/次数/重量后自动匹配本地动作库,无法匹配的动作自动创建为自
定义动作,写入与手动记录相同的 sessions/set_logs 表。

- 解析器:`fit-file-parser`(MIT,官方 Garmin FIT SDK profile,动态导入分包)
- 枚举数据:`src/data/fit-enums.ts` 由 `npm run gen-fit-enums` 从解析器内置
  的 Garmin profile 生成;升级解析器版本后需重新生成
- 纯逻辑(枚举解析/名称匹配/分组)在 `src/lib/fitImport.ts`,由
  `scripts/fit-import-smoke-test.mjs` 覆盖

## 肌肉理论数值算法

`src/lib/metrics/` 是纯函数算法库(无 React / SQL):e1RM 与 %1RM 处方(§1)、
有效刺激与分肌群分数容量(§2)、容量地标 / 疲劳指标(§3)、进阶推荐(§4)、
身体数据层(§5)。公式、系数来源与置信度见 [THEORY.md](./THEORY.md);所有
可调参数集中在 `src/lib/metrics/landmarks.ts`。

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
