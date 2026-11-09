# Patina 结构归一（Structural Merge）方案

> 状态：待评审 · 版本：v1 · 作者：架构师
> 适用仓库：`D:\101-Workshop\261109-Timing`（Tauri 2 + React 19，`master`）
> 本文只出方案，**不含任何源码改动**。文内所有数字均为本机实测，命令写在 §9 附录。
> 唯一写出的文件：`docs/refactor/patina-structural-merge.md`。

---

## 0. 结论速览（先看这 8 条）

| # | 结论 |
|---|---|
| 1 | **前端铺平进 `src/` 顶层，但不并入宿主「层优先」目录**。`src/patina/{app,features,platform,shared}` → `src/{app,features,platform,shared}`。理由见 §1.1：**446 个文件移动、1,642 处相对引用里只有 11 行需要人手重算**（已用解析器逐条模拟验证，改完 2,889 处全部命中，失败 0）。 |
| 2 | **Rust 铺平进宿主六层，一层一个 `insight/` 命名空间**：`app/insight`、`commands/insight`、`infra/insight`、`models/insight`、`services/insight/{data,engine}`。1302 处 `crate::patina::*` 改写（1300 单遍正则 + 2 处花括号分组手工改），编译器全量验证。 |
| 3 | **`data/` 不拆进 `repositories/` 与 `services/`，而是整体落 `services/insight/data/`**。实测 `data ↔ engine` 互引（16 / 32 次），按层拆会造出 `repositories ↔ jobs` 环，与 AGENTS.md 的层序文档冲突。 |
| 4 | 命名规范化只改 **17 个 Rust 文件**（命令模块补 `_cmd.rs` 后缀）；前端 **0 个改名**。`insight/` 子目录本身完成消歧，不给文件名加产品前缀。 |
| 5 | 门禁豁免 5 类**全部撤销**：L6（154 处 `eprintln!`）、L3（**1 个文件 2 行** import）、size（152 个超限文件）、eslint（834 → 3 处真修 + 1 个生成文件窄豁免）、contract 字面量（8 处）。每条都有实测方法（§4）。 |
| 6 | `check-vendored-diff` **不退役、改造并保留**：它管的不是「规则豁免」而是「改动登记账本」，归一后仍然有用。豁免类全撤，账本类保留（§6）。 |
| 7 | 切 **5 个批次**，T01 / T02 之间**无依赖、可并行**，每批单提交、`git revert` 干净回滚（§5）。 |
| 8 | 三个最高风险：**Tailwind `source("./")` 扫描根静默失效**（门禁抓不到）、**契约脚本把 insight 命令误算进宿主 80 条**、**`#[path]` 模块单元被按文件拆散**（§7）。 |

---

## 1. 边界裁决

### 1.1 前端：铺平进 `src/`，**不**并入宿主层优先目录

**结论：`src/patina/` 这个 vendored 子树消失，其中的 4 个域目录升级为 `src/` 的一等公民；但它们不与 `src/components|hooks|lib|services|stores|types` 合并。**

#### 为什么不合并进宿主目录（拒绝「全铺平到 components/」）

实测账本，先把代价摆出来：

| 项 | 数字 | 来源 |
|---|---|---|
| Patina 前端文件 / 行 | **446 文件 / 69,828 行**（其中代码文件 **433** 个：`.ts` 281 + `.tsx` 130 + `.css` 22；其余 13 个是 `.png/.svg/.jpg/.avif` 资产） | §9-A1 |
| 宿主前端文件 / 行 | 363 / 47,216 | §9-A1 |
| Patina `features/*/components` | 122 个 .tsx（分布在 9 个业务域） | §9-A2 |
| Patina `features/*/hooks` | 53 个 | §9-A2 |
| Patina `features/*/services` | 104 个 | §9-A2 |
| 宿主 `src/components/` 现有 | 168 个 | §9-A2 |
| Patina 相对路径 import | **1,642** 处（1,621 处 TS/TSX + 21 处 `App.css` 的 `@import`） | §9-A3 |
| 其中需要人手重算的 | **11 行**（8 行在 `App.tsx`/`main.tsx`，3 行是指向 `src-tauri/icons/` 的资产） | §1.1.1 |

若按宿主层优先目录铺平：`src/components/` 从 168 → **290** 个文件，`src/services/` 从 24 → **128**，`src/hooks/` 从 34 → **87**。三个目录都跨过了「一眼扫得完」的门槛，而**域名信息全部丢失**——`SettingsDataSafetyPanel.tsx` 与 `SettingsPanel.tsx`（宿主）并排躺着，没有任何结构告诉你它们属于两套不同的 UI 语言（Patina = Tailwind v4 特性切片；宿主 = 手写 CSS + 悬浮条）。

这不是审美问题，是**可维护性问题**：Patina 上游仍在维护，`features/<域>/` 是吸收上游补丁的坐标系。打散后「上游改了 history 域」变成「去三个目录里找 30 个文件」。

#### 为什么「去前缀」就是本案的正确答案

`src/patina/{app,features,platform,shared,styles}` 这 5 个目录在宿主 `src/` 下的同名者，除了顶层 3 个文件外**没有任何目录冲突**（实测：宿主无 `src/app`、`src/features`、`src/platform`、`src/shared`）。也就是说把 `src/patina/` 这一层**剥掉**，剩下 4 个目录天然就是 `src/` 的一等公民。

关键量：**4 个目录内部的相对位置关系完全不变**（搬迁前后都是 `src/` 下的兄弟），所以 **1,642 处相对引用里 1,631 处原样成立**，只剩 11 行必须人手重算——全部集中在「自身位置变了」的 5 个文件上（详见 §1.1.1，已用解析器逐条模拟，不是估算）。

> 先泼一盆冷水：我第一版方案写的是「1,621 处一处都不用改」，**那是错的**。3 处指向 `src-tauri/icons/*.png` 的资产 import 因为少了一层 `src/patina/`，`../` 要各减 1。这类错误 `tsc` 也未必全抓（`.png` 走的是 Vite 资产解析，不是 TS 模块解析），所以本方案把它升级成「可执行验证」而不是「论证」，见 §1.1.1。

这带来一个别处买不到的性质：**这一批的改动可以从 git 自证**——`check:vendored` 的逐文件 sha256 在新路径上若仍全绿，就说明 446 个文件一个字节都没动，移动是纯 `git mv`。任何「顺手改」都会立刻变红。

#### 1.1.1 相对引用怎么算对（本批唯一真实工作量）+ 怎么验证没算错

**没有路径别名可用**（已复核：`tsconfig.json` 无 `paths`、`vite.config.ts` 无 `resolve.alias`；那 38 处 `@` 开头全是 `@tauri-apps/*` scoped 包名，见 §9-A3）。所以「搬文件」= 只能改相对路径本身。手段是**两步**：

**第一步：整层 `git mv`，让 1,631 处相对路径在数学上原样成立。**
相对路径 = 「从当前文件所在目录向上 N 层，再向下走」。只要搬迁后**文件之间的相对位置不变**，路径就仍然指向同一个目标。本方案把 5 个域目录整体上提一层（互相之间仍是兄弟），所以域内互相引用、域间互相引用全部保持成立——这一条是结构决定的，不是逐处校验出来的。

**第二步：只有「自己位置变了」的文件才需要重算。** 全仓只有 5 个这样的文件、共 11 行：

| 文件 | 行 | 原 | 新 | 为什么变 |
|---|---|---|---|---|
| `src/app/App.tsx` | 3 | `./app/AppShellLocaleRoot` | `./AppShellLocaleRoot` | 自己进了 `app/`，`app/` 变成同目录 |
| 同上 | 4 | `./platform/runtime/appIconEventGateway.ts` | `../platform/runtime/appIconEventGateway.ts` | `platform/` 变成兄弟 |
| 同上 | 5 | `./platform/desktop/windowControlGateway` | `../platform/desktop/windowControlGateway` | 同上 |
| 同上 | 8 | `./app/mini/MiniShell`（`lazy(() => import(...))`） | `./mini/MiniShell` | 同第 3 行 |
| 同上 | 9 | `./app/tool-notification/ToolNotificationShell` | `./tool-notification/ToolNotificationShell` | 同上 |
| 同上 | 12 | `./app/services/resourceDiagnosticsService.ts`（`import(...)`） | `./services/resourceDiagnosticsService.ts` | 同上 |
| `src/app/main.tsx` | 4 | `./platform/persistence/iconThemeColorStore.ts` | `../platform/persistence/iconThemeColorStore.ts` | `platform/` 变成兄弟 |
| 同上 | 5 | `./shared/hooks/useIconThemeColors.ts` | `../shared/hooks/useIconThemeColors.ts` | `shared/` 变成兄弟 |
| `src/app/components/AppSidebar.tsx` | 5 | `../../../../src-tauri/icons/128x128@2x.png` | `../../../src-tauri/icons/128x128@2x.png` | 目录深度 4 → 3 |
| `src/app/components/AppTitleBar.tsx` | 5 | `../../../../src-tauri/icons/128x128@2x.png` | `../../../src-tauri/icons/128x128@2x.png` | 目录深度 4 → 3 |
| `src/features/about/components/AboutPanel.tsx` | 4 | `../../../../../src-tauri/icons/icon.png` | `../../../../src-tauri/icons/icon.png` | 目录深度 5 → 4 |

**第三步：用解析器证明「只有这 11 行」。** 下面这段可直接跑（不写文件、不改仓库），它把所有文件的相对引用按**新**位置重新解析，并在目标文件集里查这个路径是否存在：

```python
# 用法：在仓库根执行 python - <<'PY' ... PY（Windows 下 python 可能是 python 或 py）
import os, re, posixpath
MAP = [('src/patina/app/','src/app/'), ('src/patina/features/','src/features/'),
       ('src/patina/platform/','src/platform/'), ('src/patina/shared/','src/shared/'),
       ('src/patina/styles/','src/app/styles/'),
       ('src/patina/App.tsx','src/app/App.tsx'), ('src/patina/main.tsx','src/app/main.tsx'),
       ('src/patina/App.css','src/app/App.css'), ('src/patina/vite-env.d.ts','src/vite-env.d.ts')]
def newp(p):
    for a, b in MAP:
        if p == a or p.startswith(a): return b + p[len(a):]
    return p
allf = set()
for root in ['src', 'src-tauri/icons', 'tests']:          # 资产与仓根 fixtures 都要收
    for dp, dn, fn in os.walk(root):
        dn[:] = [d for d in dn if d not in ('node_modules','target','dist','gen')]
        for f in fn: allf.add(os.path.join(dp, f).replace('\\', '/'))
mapped = {newp(p) for p in allf}
EXTS = ['', '.ts', '.tsx', '.css', '.json', '.png', '.svg', '.jpg', '.avif', '/index.ts', '/index.tsx']
def ok(p): return any(p + e in mapped for e in EXTS)
def strip(s):   # 关键：别让文档注释里的 "from './x'" 变成假阳性
    s = re.sub(r'/\*[\s\S]*?\*/', '', s)
    return re.sub(r'^\s*//.*$', '', s, flags=re.M)
bad = []; total = 0
for p in sorted(allf):
    if not p.endswith(('.ts', '.tsx', '.css')): continue
    d = posixpath.dirname(newp(p))
    for line in strip(open(p, encoding='utf-8', errors='ignore').read()).splitlines():
        for m in re.finditer(r'''(?:\bfrom\s+|import\s*\(\s*|^\s*@import\s+)['"]([^'"]+)['"]''', line):
            s = m.group(1).strip()
            if not s.startswith('.'): continue
            total += 1
            t = posixpath.normpath(posixpath.join(d, s))
            if not ok(t): bad.append((p, s))
print(f'相对引用 {total} 处，解析失败 {len(bad)} 处')
for b in bad: print('  ✗', b[0], '->', b[1])
```

**实测基线（迁移前跑，得到的就是「待手改清单」）：**

```
相对引用 2889 处，解析失败 11 处
  ✗ src/patina/App.tsx -> ./app/AppShellLocaleRoot
  ✗ src/patina/App.tsx -> ./platform/runtime/appIconEventGateway.ts
  ✗ src/patina/App.tsx -> ./platform/desktop/windowControlGateway
  ✗ src/patina/App.tsx -> ./app/mini/MiniShell
  ✗ src/patina/App.tsx -> ./app/tool-notification/ToolNotificationShell
  ✗ src/patina/App.tsx -> ./app/services/resourceDiagnosticsService.ts
  ✗ src/patina/main.tsx -> ./platform/persistence/iconThemeColorStore.ts
  ✗ src/patina/main.tsx -> ./shared/hooks/useIconThemeColors.ts
  ✗ src/patina/app/components/AppSidebar.tsx -> ../../../../src-tauri/icons/128x128@2x.png
  ✗ src/patina/app/components/AppTitleBar.tsx -> ../../../../src-tauri/icons/128x128@2x.png
  ✗ src/patina/features/about/components/AboutPanel.tsx -> ../../../../../src-tauri/icons/icon.png
```

**把上表 11 行按第三列替换后再跑同一段脚本 → `相对引用 2889 处，解析失败 0 处`**（已实测）。这就是 T01 的验收判据，也是「没算错」的机械证明。

**三层验证（缺一不可，因为三者覆盖的失效模式不同）：**

| 层 | 命令 | 抓什么 | 抓不到什么 |
|---|---|---|---|
| L-1 解析器 | 上面那段 python | 相对路径指空、指错（.png/.css/`.json` 也算） | 路径对但语义错（搬错目录后仍能解析） |
| L-2 类型 | `npx tsc --noEmit` | TS/TSX 相对路径、类型 | `.css`/`.png` 资产（走 Vite 解析） |
| L-3 行为 | `npm test`（**必须是 700 passed / 87 files，不是「≥0》**） | 运行时真加载、源码级测试的 `readFileSync` 死路径 | 未被测试覆盖的模块 |
| L-4 构建 | `npm run build` + `grep -o 'quiet-' dist/assets/patina-*.css \| wc -l` | Tailwind 扫描根（§7 R1） | — |

> 三条都要跑的理由：`tsc` 会放过 `.css`/`.png`（不是 TS 模块）；`npm test` 会放过没有测试的模块；解析器只看路径不跑代码。2026-11 这次实测里，**恰恰是解析器抓到了 3 处资产 import 的层级错误**，而 `tsc` 对它们无感（Vite 的资产导入靠 `vite/client` 的 wildcard 声明兜底）。

#### 顶层 3 处冲突的处置

| 冲突 | 处置 | 理由 |
|---|---|---|
| `App.tsx` | → `src/app/App.tsx` | 它是分析窗根组件，与它的壳 `AppShellLocaleRoot` 同目录 |
| `main.tsx` | → `src/app/main.tsx` | 分析窗入口，与根组件同目录 |
| `styles/` | → `src/app/styles/` | **必须与聚合器 `App.css` 同目录**：`App.css` 里 21 条 `@import "./styles/..."` 是相对路径，一起搬才不用改 21 行 |
| `vite-env.d.ts` | → `src/vite-env.d.ts` | 全仓一份即可，宿主侧原本没有 |

内容编辑总量：**11 行 import（5 个文件）+ 1 行 CSS**（`tailwindcss` 的 `source("./")` → `source("../")`）+ `patina.html` 的 script 路径 + `vite.config.ts` 一行注释 + `eslint.config.js` 的 override 路径。**合计 9 个文件**，逐条列在 §5 T01，是这一批唯一的「人写的字」。

> 为什么 `src/app/` 不叫 `src/shell/`（更好听、且不会与「app 入口」混淆）：改名会让跨域相对引用（`../app/...`）失效，本批就从「11 行编辑」退化成「全量路径重写」，收益只是目录名好听一点。**保住「11 行」这个可穷举、可复核的量级比目录名重要。** 混淆风险用 AGENTS.md 一行说明消掉（§5 T04）。

#### 窗边界怎么变成机械规则（而不是靠目录名暗示）

实测：**宿主前端引用 Patina = 0 处；Patina 前端引用宿主 = 3 处（全是图标资源）**（§9-A4）。两个窗口今天已经事实上隔离，只通过 IPC 命令名交互（11 个 `platform/**/*Gateway.ts`，全部在 `src/platform/` 下，`components/` 与 `hooks/` 里 `ipc.`/`invoke(` 命中数 = **0**）。

所以归一后新增一条门禁 **L9（双窗隔离）**，把「今天恰好成立」变成「明天不许破坏」：

```
L9  src/{components,hooks,lib,mocks,services,stores,styles,types}/**  （主窗）
    不得 import src/{app,features,platform,shared}/**               （分析窗）
    反之亦然；唯一例外：src-tauri/icons/** 静态资源。
```

### 1.2 Rust：铺平进宿主六层，每层一个 `insight/` 命名空间

**结论：`src-tauri/src/patina/` 消失；6 个层目录分别落进宿主同名/同义层，并在其中占一个 `insight/` 子目录。**

与前端相反，Rust **必须做层合并**，因为 `app`、`commands`、`platform` 三个目录名与宿主**硬冲突**，`src-tauri/src/patina/* → src-tauri/src/*` 这种「只剥一层」的搬法在 Rust 侧物理上不成立。而一旦要合并目录，唯一有依据的合并方式就是**按层语义**：

| Patina 层 | 出边（实测，§9-B2） | 宿主同义层 | 落位 |
|---|---|---|---|
| `domain/` (37) | **0**（纯叶子） | `models/` | `models/insight/` |
| `platform/` (56) | 只依赖 `domain`（15 次） | `infra/`（路径/时钟/凭据/Win32 适配） | `infra/insight/` |
| `data/` (137) | → domain 138、engine 16、platform 34 | 无同义层（自带 sqlx 池 + schema + 迁移） | `services/insight/data/` |
| `engine/` (39) | → data 32、domain 109、platform 24 | `jobs/`（调度器/运行时） | `services/insight/engine/` |
| `app/` (29) | → data 39、domain 63、engine 35、platform 40 | `app/` | `app/insight/` |
| `commands/` (21) | → app 26、data 39、domain 24、engine 22、platform 9 | `commands/` | `commands/insight/` |

**这个映射产出的是一个无环 DAG**：`models ← infra ← services ← app ← commands`，与 AGENTS.md 现有层序（`platform → infra → services → app/jobs → commands`）一致。

#### `data/` 为什么不进 `repositories/`（本案最关键的否决）

题面问「`data/`(136) → 宿主是 `repositories/` 还是 `services/`」。答案是 **`services/insight/data/`**，也就是「都不进，整体成块」。三条实测理由：

1. **`data/` 不是一个 repositories 目录，是一个完整持久化栈。** 137 个文件中只有 52 个在 `data/repositories/`；其余是 `sqlite_pool`（13）、`schema.rs`（1,887 行）+ `schema_contracts.rs`、`storage_migration*`、5 个 `*_store.rs`、8 个 `*_service.rs`、`backup/`、`export/`、`import/`、`remote_*`、`scheduled_*`。把它们塞进 12 个文件的 `repositories/`，等于让那个目录 92% 的内容不是 repository。
2. **拆成 3 份（repositories / services / infra）会打断一个已有闭环。** `sqlite_pool` 依赖 `data::repositories::mini_window::load` 与 `data::activity_read_model::maintain_once`（§9-B3）。若 pool 进 `infra/` 而 repositories 进 `repositories/`，就得到 `infra → repositories` 这条 AGENTS.md 层序里不存在的边；而 `repositories/` 在宿主是**services 之下**的一层，`infra` 却在 services 之上 → 环。
3. **`data ↔ engine` 互引，二者是一个单元。** `data → engine` 16 次、`engine → data` 32 次（§9-B2）。若 `engine` 进 `jobs/`、`data` 进 `repositories/`，就做出 `repositories ↔ jobs` 跨层环。放进同一个 `services/insight/` 下，环变成层内的实现细节，不污染层序。

顺带解决一个真问题：**Patina 的 3 个命令文件直接 `use ...data::repositories`**（`commands/{mini_window,persistence_read,settings}.rs`，§9-B4）。若 data 落进 `repositories/`，这三个文件在归一批就会把 **L5（commands 禁 repositories）打红**，逼出一个「把 3 个文件里的查询下沉到 service」的额外重构。落 `services/insight/data/` 后它们 `use crate::services::insight::data::...` —— **L5 天然满足，零重构**。

代价（必须写清）：`services/` 从 56 → 232 个文件（其中 177 在 `services/insight/`）。`engine/` 里的 `backup_scheduler.rs` / `export_scheduler.rs` / `updater.rs` 语义上更像 `jobs/`，本方案的处置是**留在 `services/insight/engine/`，并在文档里登记为将来的候选**：等 `data ↔ engine` 环被打破（那是真重构，不是搬家）再挪。

---

## 2. 目录映射表（逐条）

### 2.1 前端（446 文件）

| # | 现值 | 新路径 | 文件数 | 理由 |
|---|---|---|---|---|
| F1 | `src/patina/app/` | `src/app/` | 53 | 分析窗应用壳（`AppShell*`、`providers/`、`mini/`、`tool-notification/`、`components/`、`hooks/`、`services/`、`types/`）。与宿主无同名目录，零成本升级为一等公民。 |
| F2 | `src/patina/features/` | `src/features/` | 220 | 9 个业务域（`settings` 49 / `classification` 44 / `tools` 41 / `data` 37 / `history` 30 / `about` 14 / `destination` 12 / `dashboard` 6 / `update` 4）。**不动内部结构**——这是吸收上游补丁的坐标系。 |
| F3 | `src/patina/platform/` | `src/platform/` | 54 | 分析窗的传输层与平台适配（`desktop/`、`runtime/`、`persistence/`、`storage/`、`backup/`、`browser/`）。全部分析窗的 `invoke`/窗口 API 都收口在这里（实测 11 个 gateway 文件）。 |
| F4 | `src/patina/shared/` | `src/shared/` | 94 | 分析窗内部共享（`components/` 静默组件族、`i18n/`、`charts/`、`motion/`、`theme/`、`lib/`、`types/`、`classification/`、`colors/`、`settings/`、`hooks/`）。 |
| F5 | `src/patina/styles/` | `src/app/styles/` | 21 | **必须与聚合器 `App.css` 同目录**：`App.css` 的 21 条 `@import "./styles/…"` 是相对路径，同搬则 0 改动；同时 Tailwind v4 的 `source("./")` 扫描根要落在分析窗根。 |
| F6 | `src/patina/App.tsx` | `src/app/App.tsx` | 1 | 分析窗根组件，与壳同目录。5 行 import 需改（见 §5 T01）。 |
| F7 | `src/patina/main.tsx` | `src/app/main.tsx` | 1 | 分析窗入口。3 行 import 需改。 |
| F8 | `src/patina/App.css` | `src/app/App.css` | 1 | Tailwind 入口 + 21 条 `@import` 聚合。`source("./")` → `source("../")` 一行改动。 |
| F9 | `src/patina/vite-env.d.ts` | `src/vite-env.d.ts` | 1 | 全仓一份类型声明，宿主侧原本缺。 |
| F10 | `src/patina/vite-env.d.ts` 以外的 `src/patina/` 空壳 | 删除 | 0 | 目录消失即 vendored 子树消失。 |

映射结果：`src/` = `{app(77), features(220), platform(54), shared(94)}` + 宿主 `{App.tsx, components(168), hooks(34), lib(45), mocks(8), main.tsx, services(24), stores(16), styles(53), types(13)}` + `vite-env.d.ts`。

### 2.2 后端（320 文件）

| # | 现值 | 新路径 | 文件数 | 理由 |
|---|---|---|---|---|
| B1 | `src-tauri/src/patina/domain/` | `src-tauri/src/models/insight/` | 37 | 纯类型 + 规则，出边 **0**，与 `models/` 同义。 |
| B2 | `src-tauri/src/patina/platform/` | `src-tauri/src/infra/insight/` | 56 | 路径/时钟/凭据/WebDAV/存储控制/Win32 适配 = `infra/` 同义；只依赖 `domain`，**L4（infra 禁 services）天然满足**。 |
| B3 | `src-tauri/src/patina/data/` | `src-tauri/src/services/insight/data/` | 137 | 完整持久化栈（sqlx 池 + schema + 迁移 + stores + repositories）。见 §1.2 的三条否决理由。 |
| B4 | `src-tauri/src/patina/engine/` | `src-tauri/src/services/insight/engine/` | 39 | 与 `data` 互相引用（16/32），必须同层。层内保留 `tracking/`、`tools/`、`web_activity/`、`*_scheduler` 结构。 |
| B5 | `src-tauri/src/patina/app/` | `src-tauri/src/app/insight/` | 29 | 装配层同义。落进 `app/insight/` 后，`bootstrap.rs` / `tray.rs` / `state.rs` / `import.rs` / `diagnostics.rs` 与宿主同名文件的冲突**自动消失**，0 改名。 |
| B6 | `src-tauri/src/patina/commands/` | `src-tauri/src/commands/insight/` | 21 | 命令层同义。嵌套一层后 `settings.rs` 与宿主 `settings_cmd.rs` 由目录消歧。 |
| B7 | `src-tauri/src/patina/mod.rs` | 删除；`flush_coverage` 移到 `src-tauri/src/platform/coverage.rs`（**不是 `lib.rs`**，理由见 §5.2.1⑦） | 1 | 顶层 `pub mod` 拆成 6 处 `#[cfg(desktop)] mod insight;`；`#![allow(dead_code)]` 改为 6 处 `#[allow(dead_code)]` 挂在 `mod insight;` 上（模块级 allow 覆盖整棵子树）；`patina::flush_coverage` 2 处引用 → `crate::platform::coverage::flush_coverage`。 |
| B8 | （新增） | `src-tauri/src/services/insight/mod.rs` | 1 | 声明 `pub mod data; pub mod engine;`。全案唯一新建文件。 |

合并后的目录规模：

| 目录 | 变化 |
|---|---|
| `app/` | 16 → 46（其中 30 在 `app/insight/`） |
| `commands/` | 24 → 45（其中 22 在 `commands/insight/`） |
| `infra/` | 43 → 99（其中 57 在 `infra/insight/`） |
| `models/` | 30 → 67（其中 38 在 `models/insight/`） |
| `services/` | 56 → 232（其中 177 在 `services/insight/{data,engine}/`） |
| `repositories/` / `jobs/` / `platform/` | 不动（12 / 9 / 7） |

**必须整单元搬运**（实测约束，见 §7 风险 3）：Patina 内共 **34 个「同名 .rs + 同名目录」模块**、**90 处 `#[path]` 属性**、**56 个 `*_tests.rs`**。`#[path]` 是相对路径（相对父模块所在目录），所以只要「主文件 / 同名子目录 / `*_mod_tests.rs`」一起走，90 处 `#[path]` 与 723 处 `super::` **全部零改动**（已逐条验证：`super::` 引用全部指向层内兄弟模块，无跨层）。

---

## 3. 命名规范化

### 3.1 规则

| 规则 | 内容 | 受影响文件数 |
|---|---|---|
| **N1 目录即命名空间** | `insight/` 子目录承担消歧。**不给文件名加产品前缀**（不出现 `patina_settings.rs` / `insight_settings.rs`）。 | 0 |
| **N2 命令模块后缀** | `commands/**` 下**定义了 `#[tauri::command]` 函数**的文件，文件名必须以 `_cmd.rs` 结尾；非命令模块（DTO / 守卫 / 测试）不加，沿用原名。 | **17**（`activity_read_model` `backup` `diagnostics` `export` `import` `mini_window` `persistence` `persistence_read` `settings` `storage` `tool_notifications` `tools` `tracking` `update` `web_activity` `web_activity_analysis` `window`） |
| **N3 非命令文件不改名** | `commands/insight/{error.rs, window_guard.rs, mod.rs, tools_mod_tests.rs}` 保持原名（它们不是命令模块；`error.rs` 是 `CommandErrorDto`）。 | 0 |
| **N4 类型名不加前缀** | 全落进 `insight` 命名空间后，`crate::models::insight::settings::X` 与 `crate::models::settings::X` 不冲突，**不做任何类型改名**。 | 0 |
| **N5 前端零改名** | 3 处顶层冲突靠换目录解决，不靠改文件名。 | 0 |
| **N6 运行时标识不动** | 窗口 label `"patina"`、`patina.html`、数据目录 `data_root/patina`、Cargo feature `patina_coverage` **本轮不改**（见 §8 非目标）。 | 0 |

### 3.2 N2 的数量核对

`grep -c '#\[tauri::command\]' src-tauri/src/patina/commands/*.rs` → 合计 **117** 条命令，分布在 **17** 个模块文件（`tools.rs` 20 / `backup.rs` 15 / `storage.rs` 12 / `persistence.rs` 12 / `persistence_read.rs` 8 / `window.rs` 7 / `settings.rs` 7 / `import.rs` 7 / `mini_window.rs` 6 / `export.rs` 5 / `update.rs` 4 / `tracking.rs` 4 / `tool_notifications.rs` 4 / `activity_read_model.rs` 3 / `web_activity_analysis.rs` 1 / `web_activity.rs` 1 / `diagnostics.rs` 1）。改名后 `check:contract` 里「Patina 117」这个数**必须不变**——这是 N2 的自检判据。

### 3.3 同域不同名的标准答案

> Patina `commands/settings.rs`（7 条命令） vs 宿主 `commands/settings_cmd.rs`（4 条命令，实测）。

归一后：

```
src-tauri/src/commands/settings_cmd.rs          ← 宿主（不动）
src-tauri/src/commands/insight/settings_cmd.rs  ← Patina（N2 加后缀）
```

模块路径分别是 `crate::commands::settings_cmd::*` 与 `crate::commands::insight::settings_cmd::*`，**三重消歧**（层 / 命名空间 / 后缀）。命令名本身由 `check:contract` 的「宿主与 Patina 命令名集合必须不相交」钉死（当前 80 与 117 无交集，归一批继续生效）。

---

## 4. 门禁豁免如何逐个撤掉

现状：`scripts/check-layers.mjs` 的 `VENDORED`、`scripts/check-size.mjs` 的 `VENDORED`、`eslint.config.js` 的 `src/patina/**` override、`check-contract.mjs` 的字面量豁免，四套豁免全部以**路径前缀**为判据。归一后前缀消失，豁免**自动失效**——这就是「结构归一」的机械定义：**规则不再认识你的出身。**

### 4.1 L6：154 处 `eprintln!` → `crate::log_*!`

**实测**：`grep -rnE '\beprintln!\(' src-tauri/src/patina --include=*.rs | wc -l` → **154**（宿主全域 0）。按层分布：`app` 86 / `data` 24 / `platform` 20 / `engine` 20 / `domain` 3 / `mod.rs` 1。宏体跨行的 **26 处**；带 `[tag]` 前缀的 **140 处**（`[backup]` `[tray]` `[startup]` `[main-window]` `[mini]` `[tracker]` `[tools]` `[import]`）。

> **T03 开工实测 = 153，不是 154**：那 1 处是 `patina/mod.rs` 里 `flush_coverage` 的那句，
> 随 T02 搬到 `platform/coverage.rs` 时已就地改成 `crate::log_error!`（见 §5.2.1⑦）。
> 所以本节的 154 是「归一前原数」，T03 的作业量是 153。

**判定规则（机械 + 人工复核，两步）：**

| 步 | 动作 | 覆盖 |
|---|---|---|
| S1 机械打标 | 取宏体首个 `"…"` 字面量，按顺序匹配：①含 `committed but` → **warn**（主流程已成功，旁路失败）；②`(?i)fail\|error\|cannot\|unable\|invalid\|rejected\|unavailable\|denied\|panic` → **error**；③`(?i)warn\|deprecat\|fallback\|degrade\|skip\|stale\|retry\|timeout\|ignor\|recover` → **warn**；④其余 → **info** | 154/154 自动打标；粗分布 **error 114 / info 36 / warn 4**（实测） |
| S2 剥前缀 | 删掉宏体里的 `"[tag] ` 前缀（`log_*!` 自带 `module_path!()`，重复打标签等于双前缀） | 140/154 |
| S3 人工复核 | **必须逐处过一遍**，重点是 ①26 处多行宏（机械规则只能看首参）②114 处被判 error 的（其中「restore committed but … failed」这类应降为 warn） | 154/154 |

**是否需要人工逐处判？是。** 理由不是懒，而是「级别」是语义而非语法：同一个 `failed to …` 在主流程里是 error，在「已提交后的旁路刷新」里是 warn。S1 的机械规则只能把 154 处压成 3 桶，**S3 复核是省不掉的**，但它有明确清单（26 + 114 处），半天可完成。

**判据**：
```bash
grep -rnE '\beprintln!\(' src-tauri/src --include=*.rs | wc -l     # 期望 0
grep -rc 'log_info!\|log_warn!\|log_error!' src-tauri/src/services/insight --include=*.rs | wc -l
```
`platform/log.rs` 的 4 个宏（`log_error` / `log_warn` / `log_info` / `log_debug`）已存在，零新增依赖。

**为什么值得做（不只是为了门禁）**：`eprintln!` 在 Release 的 GUI 进程里**无处可见**（注释里写得很清楚）。这 154 处诊断今天只在 `npm run tauri dev` 的终端活着——归一是把它们接进 `<app_data>/logs/timing-YYYY-MM-DD.log` 的唯一时机。

### 4.2 L3：`@tauri-apps/api/window` 收口

**实测（逐行复核，不是估）**：

```bash
grep -rn '@tauri-apps/api/window'      src --include=*.ts --include=*.tsx   # 6 行 = 2 文件
grep -rn '@tauri-apps/api/webviewWindow' src --include=*.ts --include=*.tsx # 1 行 = 1 文件
```

| 文件 | `api/window` 代码行 | `api/webviewWindow` 代码行 | 说明 |
|---|---|---|---|
| `src/lib/window.ts` | **3**（第 12 行 import、第 24/25 行 re-export）+ 2 行**注释** | 0 | L3 白名单内；注释里提到字面量属正常（grep 会数到 5 行，其中 2 行是文档） |
| `src/patina/platform/desktop/windowControlGateway.ts`（227 行，10 处 `getCurrentWindow()`） | **1**（第 3 行） | **1**（第 2 行） | 唯一违规 | 
| **Patina 合计** | **1 处** | **1 处** | 都在同一文件、相邻两行 |

所以 L3 的收口成本就是**一个文件的 2 行 import** —— 比预想低，因为 Patina 已经把窗口 API 集中到了 `platform/desktop/` 这一层（`components/` 与 `hooks/` 里 0 命中，§9-A6）。你复核的数字（Patina 里 1 处）是对的，我原稿写「2 个文件」是把宿主自己的 `src/lib/window.ts` 也算进去了，容易误读，这里拆开列。

**能否都收口到 `src/lib/window.ts`？能，但不要直接收。**

`src/lib/window.ts` 现在 `import { ipc, isTauri } from '../services/ipc'` 与 `./platform`，把分析窗接过去等于把**宿主 IPC 全表 + browserMock** 拖进分析窗 bundle。正确做法是加一层薄壳：

```
src/lib/windowApi.ts        ← 新建，纯 re-export，零业务依赖：
                              export { getCurrentWindow, getCurrentWebviewWindow,
                                       LogicalPosition, LogicalSize } from '@tauri-apps/api/window'
                              export { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
src/lib/window.ts           ← 改为从 './windowApi' 导入（对外导出面不变，主窗 0 改动）
src/platform/desktop/windowControlGateway.ts
                            ← 改为从 '../../lib/windowApi' 导入（1 行）
```

L3 文案改为：`@tauri-apps/api/window` 与 `@tauri-apps/api/webviewWindow` **只允许出现在 `src/lib/windowApi.ts`**（白名单从 1 个文件变成 1 个文件，判据更严：多了 `webviewWindow`——今天它根本没被管）。

**判据**：
```bash
grep -rl '@tauri-apps/api/window\|@tauri-apps/api/webviewWindow' src --include=*.ts --include=*.tsx
# 期望：只有 src/lib/windowApi.ts
```

### 4.3 size：152 个超限文件 → 上限例外 + 棘轮（**不拆**）

**实测**（`node scripts/check-size.mjs` 当前输出「vendored 子树另有 152 个超限文件，最大 1936 行」）：

| 分类 | 数量 | 明细 |
|---|---|---|
| 前端 | **61** | `.css` **8**（最大 `quiet-pro.css` 1,936）、`.ts/.tsx` **53**（最大 `features/settings/components/Settings.tsx` 1,736） |
| 后端 | **91** | 其中 `*_tests.rs` / `*_mod_tests.rs` **21**；最大 `data/schema.rs` 1,887 |
| ≥600 行 | **53** | 300–599 行 **99** |
| 宿主侧现状 | **0** | `scripts/size-allowlist.json` 当前为空——宿主是严格守 300 行的 |

**处置策略：不拆，转成「上限例外 + 棘轮」。**

- 理由 A：拆 152 个继承文件 = 把它们从「可逐行对照上游」变成「只能靠自己维护」。这与 §6 保留 `check-vendored-diff` 的目的直接冲突——**一边建账本一边把账本撕了**没有意义。
- 理由 B：8 个超限 `.css` 是**聚合器模式**（`App.css` 按序 `@import` 21 个文件），拆细会引入加载顺序耦合，收益为负。
- 理由 C：真正该拆的是**宿主已经动过的** 2 个超限文件——`features/history/components/History.tsx`（1,206 行，D2 接线改过）与 `features/settings/components/Settings.tsx`（364 行，D3 主题改过）。它们已经不是上游原样，拆分不损失对账。列入 P1 后续，不在本迁移内。

**机制（复用现有白名单，最小改动）**：给 `scripts/check-size.mjs` 加 `--freeze` 子命令，把 152 个超限文件写进 `scripts/size-allowlist.json`，并在条目里增加 `maxLines` 字段，门禁改为「当前行数 > `maxLines` 即失败（行数只许减不许增）」。分档到期：

| 档 | 条数 | owner | expires |
|---|---|---|---|
| ≥600 行 | 53 | `insight-merge` | `2026-12-31` |
| 300–599 行 | 99 | `insight-merge` | `2026-06-30` |

**判据**：
```bash
node scripts/check-size.mjs          # 期望 OK + "白名单 152 条"
node scripts/check-size.mjs --freeze # 生成/更新 allowlist（幂等）
# 棘轮自检：给任一 allowlist 文件加一行 → 必须变红
```

### 4.4 eslint：834 → 3 处真修 + 1 个生成文件窄豁免

**实测方法**（用 ESLint Node API 把 `src/patina/**` 的 override 去掉再跑，不动仓库文件）：

```bash
node --input-type=module -e "
import { ESLint } from 'eslint';
const base = (await import('./eslint.config.js')).default;
const cfg = base.filter(c => !(c.files && String(c.files).includes('src/patina')));
const es = new ESLint({ overrideConfigFile: true, overrideConfig: cfg, cwd: process.cwd() });
const res = await es.lintFiles(['src/patina']);
const agg = {};
for (const r of res) for (const m of r.messages) agg[m.ruleId] = (agg[m.ruleId]||0)+1;
console.log(agg);
"
```

**实测结果：834 个问题（全部 error 级，`lint` 用 `--max-warnings=0`）**：

| 规则 | 数量 | 位置 | 处置 |
|---|---|---|---|
| `no-sparse-arrays` | **831** | `src/patina/shared/i18n/generated/resources.ts` 一个文件 | **保留窄豁免**：给 `src/shared/i18n/generated/**` 关掉这一条。它是**生成物**，`[,,]` 的 length 是语义（换 `undefined` 会变密数组）。 |
| `prefer-const` | **2** | `app/services/startupWarmupService.ts`、`shared/colors/displayColor.ts` | 改成 `const` |
| `no-control-regex` | **1** | `features/settings/services/remoteBackupUploadDraft.ts` | 保留正则意图，加 `// eslint-disable-next-line no-control-regex -- 按控制字符切片` |

> **⚠ T03 实测：这条 `eslint-disable` 处方不可行。** ESLint 9 的 flat config 默认
> `linterOptions.reportUnusedDisableDirectives = "warn"`，而子树的 override 还把
> `no-control-regex` 关着 → 那条 disable 被判「未使用」，在 `--max-warnings=0` 下**直接红**。
> T03 的处置是**改代码而不是加豁免**：把控制字符判断从正则里拿出来按码点判
> （`hasReservedOrControlChar()`），语义一字不差、有没有 override 都干净。
> 这样 T04 撤 override 时，这三处不需要任何 disable 注释。

即：override 从「3 条规则 × 整棵子树」缩成「1 条规则 × 1 个生成目录」，另外 **3 处真修**。**代价接近零**，因为 99.6% 的问题集中在一个生成文件里——这是本次审计最省的一刀。

**判据**：`npm run lint` → 0（`--max-warnings=0`）。并加一条防回退注释：`eslint.config.js` 的 override 块只允许出现 `files: ['src/shared/i18n/generated/**']`。

### 4.5 contract：8 处 `.emit("字面量")` → insight 事件常量

**实测**：`grep -rnoE '\.emit\(\s*"' src-tauri/src/patina --include=*.rs | wc -l` → **8**（宿主 0）。涉及 4 个事件名：

| 事件名 | Rust emit 点 | 前端监听 |
|---|---|---|
| `app-settings-changed` | 4（`app/backup.rs`、`app/tray.rs`、`commands/settings.rs`×2） | `platform/runtime/appSettingsEventGateway.ts` |
| `app-icon-changed` | 1（`data/tracking_runtime.rs`） | `platform/runtime/appIconEventGateway.ts` |
| `active-window-changed` | 2（`engine/tracking/runtime.rs`、`engine/tracking/runtime/anonymous_activity.rs`） | `platform/runtime/trackingRuntimeGateway.ts` |
| `power-lifecycle-changed` | 1（`platform/windows/power.rs`） | **0（Rust 内部事件）** |

`check-contract.mjs` 今天对这 8 处的放行条件是 `isVendored(rel)`（路径前缀），归一后失效。

**⚠ T03 实测：字面量不止 8 处。** `grep -rnoE '\.emit\(\s*"'` 是单行正则，漏掉换行写法。
用 contract 自己的正则（`\.emit\(\s*(…|"[^"]*")`，`\s*` 跨行）实测 = **12 处**：

| 被 12 处计数漏掉的事件 | 位置 | 说明 |
|---|---|---|
| `tracking-data-changed` | `app/web_activity.rs`、`engine/tracking/runtime/support.rs`、`engine/tracking/startup.rs` | 3 处都是 `.emit(\n  "tracking-data-changed",` 的换行写法 |
| `power-watcher-ready` | `platform/windows/power.rs` | 同上（`power-lifecycle-changed` 与它同文件，共 2 处） |

另有 **2 处 `.emit_to(label, "事件名")`**（`main_window/tools_navigation.rs` 的 `main-tools-target-changed`、
`mini_window.rs` 的 `mini-window-state`）：contract 的字面量正则只认 `.emit(`，不认 `.emit_to(`。
**但语义相同（前端在 listen），所以 T03 一并常量化。**

**处置：把「路径豁免」换成「双事件通道」，判据更严而不是更松。**

```
后端常量：src-tauri/src/models/insight/events.rs   （新建，8 个 pub const）
前端常量：src/platform/runtime/insightEvents.ts     （新建，6 个名字；power-* 两个不进前端）
emit 侧：12 处 .emit 字面量 + 2 处 emit_to 字面量 → 常量
listen 侧：6 个 gateway 的字面量 → 常量
```

> **后端常量为什放 `models/insight/` 而不是 `app/insight/`（原稿写法）**：14 个 emit 点里
> `app` 4 / `commands` 2 / `infra` 2 / `services` 6。放 `app/insight/` 会让 `infra` 与
> `services` **反向依赖装配层**——`app/mod.rs` 的模块文档写着「禁止：被 `infra` 反向依赖
> （否则又成环）」，而当前全仓 `services|infra|models` 对 `crate::app::insight` 的引用是 **0**。
> `models/insight` 是「出边 0 的纯叶子」（§2.2 B1），8 个 `&'static str` 常量最适合它。
> 连带影响：T04 的 `insightEvents()` 解析器要读 `src-tauri/src/models/insight/events.rs`。

`check-contract.mjs` 增加 `insightEvents()` / `insightFeEvents()` 两个解析器与三条检查：
1. 后端 insight 常量 ↔ 前端 insight 常量（`power-lifecycle-changed` 例外，登记在脚本里带理由）；
2. 每个前端声明必须 ≥1 个 emit 点（今天这条对 insight **完全没有**）；
3. 全仓 `.emit("字面量")` 必须为 0（**取消路径豁免**）。

**判据**：
```bash
grep -rnE '\.emit\(\s*"' src-tauri/src --include=*.rs | wc -l   # 期望 0
npm run check:contract                                          # 期望摘要仍为 80(+117)/17/11
```

### 4.6 L1 / L2 扩围（不是撤豁免，是补覆盖）

归一后 `src/features/**/components/` 不再是「vendored」——但 `check-layers.mjs` 的 L1 只扫 `src/components/`，会**漏掉它们**（绿着空转，比红更危险）。所以 L1/L2 的扫描前缀扩为：

```
L1:  src/components/  +  src/app/**/components/  +  src/features/**/components/  +  src/shared/components/
L2:  src/stores/      +  src/**/*Store.ts        +  src/features/**/stores/
```

**实测：扩围后命中数 = 0**（`grep -rlE '\bipc\.|\binvoke\(' src/patina --include=*.ts*` 的 11 个文件全部在 `platform/` 下，`components/` 与 `hooks/` 命中 0）。所以扩围这一步是**免费的**——现在是把它从「恰好成立」变成「不许破坏」的最好时机。

---

## 5. 分批顺序（5 批，每批独立可验证 / 可回滚）

### 批次总表

| ID | 名称 | 主要文件 | 依赖 | 优先级 | 预估规模 |
|---|---|---|---|---|---|
| **T01** | 前端去前缀 | 446 移动 + **9 文件 / 12 行**编辑 + 3 个门禁脚本的路径常量 + baseline 路径重写 | 无 | P0 | 大（纯 rename） |
| **T02** | 后端去子树 | 320 移动 + 1302 处引用 + 6 处 `mod` + 17 改名 + 3 个门禁脚本 + baseline 路径重写 | 无 | P0 | 大 |
| **T03** | 代码归一化 | 154 `eprintln!` + 1 处窗口 API + `windowApi.ts` + 3 处 lint + 4 事件常量/11 处字面量 | T01, T02 | P0 | 中 |
| **T04** | 门禁重锚（撤豁免） | `check-layers` / `check-size` / `check-contract` / `eslint.config.js` / `size-allowlist.json` | T03 | P0 | 中 |
| **T05** | 账本改造与文档收尾 | `check-vendored-diff.mjs`（`--upstream` 映射）+ `AGENTS.md` / `README.md` / `THIRD-PARTY-NOTICES.md` | T04 | P1 | 小 |

> 与「第一个任务必须是项目基础设施」的项目规则不同：本任务是对**在维护的仓库**做迁移，基础设施（构建、CI、依赖）已经存在且不动，所以 T01 直接是第一个可交付批次。这是一处刻意的规则偏离，理由写在这里以免被当成疏漏。

### 阶段 0（前置，不算批次）

#### 0.1 并发安全：**另有一个会话正在动同一个工作区**

实测 `git status --short` 显示：`src-tauri/src/tests/md_*.rs` 一批重命名已暂存（`R`）+ `src-tauri/src/tests/mod.rs` 已改（`M`）+ `src-tauri/src/tests/md/mod.rs` 未跟踪（`??`）+ `README.md` 修改。这是**另一个会话正在把 `tests/md_*` 收进 `tests/md/`**（53 个暂存重命名），不是我们的活。

**因此本方案的硬约束（写死，不许例外）：**

1. **不动 `src-tauri/src/tests/**` 任何一个字节。** 本方案 §2.2 的 6 条映射全部落在 `app/commands/infra/models/services`，与 `tests/` 无交集。
2. **T02 会改 `src-tauri/src/lib.rs`**（只删 `#[cfg(desktop)] mod patina;`；`flush_coverage` 落在新文件 `platform/coverage.rs`，不进 `lib.rs`）。它与对方正在改的 `mod tests;` 那一行**相邻但不相交**。**改动前必须先 `git diff src-tauri/src/lib.rs` 审一遍**；若对方也动了 `lib.rs`，先 rebase 再重跑 `cargo test --lib`，不要直接把我们的版本覆盖上去。
3. **不要把对方的工作 stash 掉**（那等于抢占别人的工作区）。正确做法是**开独立 worktree 做本迁移**：

```bash
git worktree add ../261109-Timing-merge HEAD      # 干净副本，HEAD 不含对方未提交的改动
cd ../261109-Timing-merge
npm ci                                             # 依赖独立安装（package-lock 已存在）
# cargo 首次编译需重建 target/，约十几分钟；可与对方商定共用一个 CARGO_TARGET_DIR
```

在 worktree 里，T01/T02 的巨大 rename 与对方的 `tests/md/` 重构**物理隔离**，`git revert` 也不会踩到别人的文件。

#### 0.2 基线登记（顺序不能反）

在**动手之前**先存三份基线，否则事后无法证明「搬迁没改变行为」，只能证明「退出码是 0」：

```bash
git log --oneline -1 > /tmp/merge-baseline.txt          # 迁移起点 sha
npm run check            >> /tmp/merge-baseline.txt      # 8 步门禁完整输出
npm test                 >> /tmp/merge-baseline.txt      # 期望 87 files / 700 passed
(cd src-tauri && cargo test --lib) >> /tmp/merge-baseline.txt   # 期望 1684 passed / 1 env-fail / 9 ignored
npm run build && grep -o 'quiet-' dist/assets/patina-*.css | wc -l >> /tmp/merge-baseline.txt  # Tailwind 扫描根基线（§7 R1 的唯一判据）
```

---

### T01 前端去前缀

**动什么**

```bash
git mv src/patina/app       src/app
git mv src/patina/features  src/features
git mv src/patina/platform  src/platform
git mv src/patina/shared    src/shared
git mv src/patina/styles    src/app/styles
git mv src/patina/App.tsx   src/app/App.tsx
git mv src/patina/main.tsx  src/app/main.tsx
git mv src/patina/App.css   src/app/App.css
git mv src/patina/vite-env.d.ts src/vite-env.d.ts
```

内容编辑（**共 9 个文件 / 12 行**，逐条列清，防止夹带；11 行 import 见 §1.1.1 的表，此处只列落点）：

| 文件 | 改什么 |
|---|---|
| `src/app/App.tsx` | **6 行**：`./app/AppShellLocaleRoot`→`./AppShellLocaleRoot`；`./app/mini/MiniShell`→`./mini/MiniShell`；`./app/tool-notification/…`→`./tool-notification/…`；`./app/services/…`→`./services/…`；`./platform/runtime/…`→`../platform/runtime/…`；`./platform/desktop/…`→`../platform/desktop/…`。`./App.css` 不变 |
| `src/app/main.tsx` | **2 行**：`./platform/…`→`../platform/…`；`./shared/…`→`../shared/…`。`./App` 不变 |
| `src/app/components/AppSidebar.tsx` | **1 行**：`../../../../src-tauri/icons/128x128@2x.png` → `../../../src-tauri/icons/128x128@2x.png`（目录深度 4→3） |
| `src/app/components/AppTitleBar.tsx` | **1 行**：同上 |
| `src/features/about/components/AboutPanel.tsx` | **1 行**：`../../../../../src-tauri/icons/icon.png` → `../../../../src-tauri/icons/icon.png`（深度 5→4） |
| `src/app/App.css` | `@import "tailwindcss" source("./");` → `source("../");` **（唯一有静默风险的一行，见 §7 R1）** |
| `patina.html` | `<script src="/src/patina/main.tsx">` → `/src/app/main.tsx` |
| `vite.config.ts` | 注释里 `src/patina/App.css` → `src/app/App.css`（不改任何逻辑，`input` 用的是 HTML 路径） |
| `eslint.config.js` | override 的 `files: ['src/patina/**']` → 与 §4.4 的最终口径同步（T01 先改成 `['src/app/**','src/features/**','src/platform/**','src/shared/**']`，T04 再缩到生成目录） |

> 前 5 个文件里的 11 行**必须人手改**，因为它们自己换了位置；其余 1,631 处相对引用靠 §1.1.1 的「整层 mv」保持成立。改完必须跑 §1.1.1 的解析器，期望 `解析失败 0 处`。

门禁脚本与账本（**同批必改，否则批次之间会红**）：

- `scripts/check-layers.mjs` 的 `VENDORED` → `['src/app/','src/features/','src/platform/','src/shared/']`（T04 删除）
- `scripts/check-size.mjs` 的 `VENDORED` → 同上（T04 删除）
- `scripts/check-vendored-diff.mjs` 的 `ROOTS` → 同上；`scripts/vendored-baseline.json` / `vendored-allowlist.json` 的路径按前缀映射重写：

```bash
node -e "
const fs=require('fs');
const map={'src/patina/app/':'src/app/','src/patina/features/':'src/features/',
 'src/patina/platform/':'src/platform/','src/patina/shared/':'src/shared/',
 'src/patina/styles/':'src/app/styles/'};
const fix=p=>{for(const k in map) if(p.startsWith(k)) return map[k]+p.slice(k.length); return p;};
for(const f of ['scripts/vendored-baseline.json','scripts/vendored-allowlist.json']){
  const j=JSON.parse(fs.readFileSync(f,'utf8'));
  if(j.files) j.files=Object.fromEntries(Object.entries(j.files).map(([k,v])=>[fix(k),v]));
  if(j.entries) j.entries=j.entries.map(e=>({...e,path:fix(e.path)}));
  if(j.roots) j.roots=['src/app/','src/features/','src/platform/','src/shared/'];
  fs.writeFileSync(f,JSON.stringify(j,null,2)+'\n');
}"
```

外加 allowlist 登记（这 5 个文件的内容确实变了，哈希会变）：`src/app/App.tsx`、`src/app/main.tsx`、`src/app/App.css`、`src/app/components/AppSidebar.tsx`、`src/app/components/AppTitleBar.tsx`；以及 `src/features/about/components/AboutPanel.tsx`，共 **6 条** `change: "modified"`，reason 写清「去前缀导致的相对 import 深度调整 / Tailwind source 根调整」。

**判据命令与期望输出（四条验证缺一不可，理由见 §1.1.1）**

```bash
# L-1 解析器：证明 1,631 处靠结构成立、11 处靠手改补齐，无遗漏
python - <<'PY'  …（§1.1.1 的脚本原样贴入）…  PY
#   期望：相对引用 2889 处，解析失败 0 处
#   若失败 >0：每一条都是漏改的行，按 §1.1.1 的表逐个补

# L-2 类型 / L-3 行为 / L-4 构建
npm run typecheck     # 0 error
npm run lint          # 0 problem
npm test              # 87 files / 700 passed（必须是 700，不许「≥0」）
npm run build         # 成功；dist/patina.html 存在
grep -o 'quiet-' dist/assets/patina-*.css | wc -l    # 与阶段 0 基线相等（不减少）→ Tailwind 扫描根正确

# 门禁
npm run check:size    # OK，且 "vendored 子树另有 61 个超限文件"（口径不变，数字不变）
npm run check:layers  # OK，8 条规则
npm run check:vendored # "改 6 / 增 0 / 删 0"（6 = 上面登记的六处；其余 440 文件哈希必须一字不差）
npm run check:contract # OK — 80(+117)
grep -rn 'src/patina' src scripts patina.html vite.config.ts eslint.config.js | wc -l   # 期望 0
```

> `check:vendored` 在这一批的作用被放大了：**它就是「446 个文件只搬不改」的证明器**。若它报的 `改` 数量超过 6，说明有人在搬的同时顺手改了别的文件——这正是这批唯一需要防的事。

**回滚**

```bash
git revert --no-edit <T01 sha>   # 全部是 git mv + 9 个文件 / 12 行的小编辑，revert 干净
```

---

### T02 后端去子树

**动什么**

```bash
git mv src-tauri/src/patina/domain    src-tauri/src/models/insight
git mv src-tauri/src/patina/platform  src-tauri/src/infra/insight
mkdir -p src-tauri/src/services/insight && touch src-tauri/src/services/insight/mod.rs
git mv src-tauri/src/patina/data      src-tauri/src/services/insight/data
git mv src-tauri/src/patina/engine    src-tauri/src/services/insight/engine
git mv src-tauri/src/patina/app       src-tauri/src/app/insight
git mv src-tauri/src/patina/commands  src-tauri/src/commands/insight
```

`src-tauri/src/patina/mod.rs` 删除；`flush_coverage` 搬进 **`src-tauri/src/platform/coverage.rs`**（新文件，与 `platform/log.rs` 并列；§5.2.1⑦ 有完整理由）；新增 `services/insight/mod.rs`。

**6 条前缀改写 + 1 条特例**（对 `src-tauri/src/**/*.rs` 单遍正则，禁止二次匹配）：

| 旧 | 新 | 次数（实测） |
|---|---|---|
| `crate::patina::data` | `crate::services::insight::data` | 471 |
| `crate::patina::domain` | `crate::models::insight` | 369 |
| `crate::patina::platform` | `crate::infra::insight` | 143 |
| `crate::patina::commands` | `crate::commands::insight` | 134 |
| `crate::patina::engine` | `crate::services::insight::engine` | 100 |
| `crate::patina::app` | `crate::app::insight` | 81 |
| `crate::patina::flush_coverage` | `crate::platform::coverage::flush_coverage` | 2 |
| **合计** | | **1,300（233 个文件，其中 229 在子树内、4 个宿主文件）** |

> 七行相加是 **1,300**，不是 1,301。全量改写数 = 1,300（本表单遍正则）+ **2**（两处花括号分组导入
> 手工改，见 §5.2.1⑤）= **1,302**。原始出现 1,303 = 1,302 + 1 处在 `patina/mod.rs` 文档注释里
> （该文件删除，不计入改写）。

单遍实现要点：用一次 `re.sub(r'crate::patina::(data|domain|platform|commands|engine|app|flush_coverage)', ...)` 带回调，**不要**写 7 条顺序 sed（`...::data` → `...::insight::data` 会被后续规则再次命中）。

宿主 4 个文件里的引用也随之改写：`app/patina_bridge.rs`、`app/tray.rs`、`commands/window_cmd.rs`、`ipc_commands.rs`。

**两类正则吃不到、必须单独处理的引用**（漏了直接编不过，实测清单）：

| 类别 | 数量 | 位置与做法 |
|---|---|---|
| **裸 `patina::` 前缀**（不带 `crate::`，靠 crate 根的 `mod patina` 解析） | **6**（5 处 `patina::app::bootstrap::*` + 1 处 `patina::platform::windows::native_probe::run_if_requested`） | 全在 `src-tauri/src/lib.rs`。删掉 `mod patina;` 后它们会全部 E0433，必须同批改成 `crate::app::insight::…` / `crate::infra::insight::…` |
| **17 个模块改名后的模块引用**（`settings.rs` → `settings_cmd.rs` 等） | **118**（`ipc_commands.rs` 117 + `commands/insight/import_cmd.rs` 1） | `ipc_commands.rs` 是 `generate_handler!` 的 117 条命令路径；`import_cmd.rs:1` 引用 `settings_cmd::ClassificationSettingMutationDto`。改名不同步 = 命令注册表静默失效（编译期才炸） |
| **`use crate::app::insight as app;` 的别名** | **2** | `app/insight/tool_notifications.rs`、`commands/insight/import_cmd.rs`。**必须保留 `as app`**：文件内是 `app::scheduled_backup::…` 的写法，去掉别名会全部失效。花括号形式（`use crate::{app::insight as app, services::insight::data::import};`）同样要带别名 |

**`#[cfg(desktop)]` 与 lint 属性**（6 处）：

| 文件 | 加什么 |
|---|---|
| `src-tauri/src/lib.rs` | 只删 `#[cfg(desktop)] mod patina;`；**不加** `flush_coverage`（该函数在 `platform/coverage.rs`） |
| `src-tauri/src/platform/coverage.rs` | 新建：`#[cfg(feature = "patina_coverage")] pub(crate) fn flush_coverage()`（三重门控见 §5.2.1⑦） |
| `src-tauri/src/app/mod.rs` | `#[cfg(desktop)] #[allow(dead_code)] pub mod insight;` |
| `src-tauri/src/commands/mod.rs` | 同上 |
| `src-tauri/src/infra/mod.rs` | 同上 |
| `src-tauri/src/models/mod.rs` | 同上 |
| `src-tauri/src/services/mod.rs` | 同上 + `services/insight/mod.rs` 里声明 `pub mod data; pub mod engine;` |

**17 个命令模块改名**（N2）+ `commands/insight/mod.rs` 19 行 `pub mod` 同步。

**门禁脚本同批改**：`check-layers.mjs` / `check-size.mjs` 的 `VENDORED` → `['src-tauri/src/app/insight/','src-tauri/src/commands/insight/','src-tauri/src/infra/insight/','src-tauri/src/models/insight/','src-tauri/src/services/insight/']`；`check-contract.mjs`：

```js
// 宿主：排除 insight 命名空间（正则锚定，避免把 crate::commands::insight::x::y 的 x 当成模块名）
const rustCommands = () => new Set(
  [...read('src-tauri/src/ipc_commands.rs').matchAll(/crate::commands::(?!insight::)(\w+)::(\w+)/g)]
    .map(m => m[2]));
// Patina（现 insight）：多一层
const patinaCommands = () => new Set(
  [...read('src-tauri/src/ipc_commands.rs').matchAll(/crate::commands::insight::(\w+)::(\w+)/g)]
    .map(m => m[2]));
```

`check-vendored-diff.mjs` 的 `ROOTS` → 上述 5 个前缀；baseline / allowlist 路径按 §2.2 的表重写（含 17 个命令模块的改名）。

**判据命令与期望输出**

```bash
cargo check                                            # 0 error
cargo clippy --all-targets -- -D warnings               # 0 warning
cargo fmt --check                                       # 干净
cargo test --lib                                        # 1684 passed / 1 failed(reg.exe 环境) / 9 ignored
npm run check:contract                                  # OK — Rust 80（+Patina 117）/ IpcApi 80 / ipc.ts 80 / mock 80
npm run check:vendored                                  # 改 N / 增 0 / 删 0（N = 主动编辑的文件数，逐条登记）
grep -rn 'crate::patina' src-tauri/src | wc -l           # 期望 0
ls src-tauri/src/patina 2>/dev/null                     # 期望不存在
```

> `cargo test --lib` 的 1 failed 是 `patina::platform::storage_control::tests::registry_access_denial_*`，本机安全策略拦 `reg.exe`，属环境性失败（基线已记录）。**它是判定「本次迁移是否引入回归」的唯一噪声**：任何新增失败都必须是真失败。

**回滚**：`git revert --no-edit <T02 sha>`。注意 rev 时若同时改了 `ipc_commands.rs`，revert 会一并回滚（同批，无半成品）。

---

### 5.2.1 T02 逐条执行清单（可直接分派，无需再推导）

> 本节是 T02 的**可执行版**：每一个改名、每一行 `mod`、每一条正则、每一个自证命令都在这里。工程师拿到即可开工，不需要回头读 §2.2 的论证。
> 前置：见 §5 阶段 0.1（并发约束）、0.2（基线登记）。**开工前先 `git diff src-tauri/src/lib.rs` 审一遍**。

#### ① 17 个命令模块改名对照表（旧 → 新）

目录：`src-tauri/src/patina/commands/*.rs` → `src-tauri/src/commands/insight/*.rs`（`mod.rs` 单独见 item ③）。

| # | 旧文件 | 新文件 | 命令数 |
|---|---|---|---|
| 1 | `activity_read_model.rs` | `activity_read_model_cmd.rs` | 3 |
| 2 | `backup.rs` | `backup_cmd.rs` | 15 |
| 3 | `diagnostics.rs` | `diagnostics_cmd.rs` | 1 |
| 4 | `export.rs` | `export_cmd.rs` | 5 |
| 5 | `import.rs` | `import_cmd.rs` | 7 |
| 6 | `mini_window.rs` | `mini_window_cmd.rs` | 6 |
| 7 | `persistence.rs` | `persistence_cmd.rs` | 12 |
| 8 | `persistence_read.rs` | `persistence_read_cmd.rs` | 8 |
| 9 | `settings.rs` | `settings_cmd.rs` | 7 |
| 10 | `storage.rs` | `storage_cmd.rs` | 12 |
| 11 | `tool_notifications.rs` | `tool_notifications_cmd.rs` | 4 |
| 12 | `tools.rs` | `tools_cmd.rs` | 20 |
| 13 | `tracking.rs` | `tracking_cmd.rs` | 4 |
| 14 | `update.rs` | `update_cmd.rs` | 4 |
| 15 | `web_activity.rs` | `web_activity_cmd.rs` | 1 |
| 16 | `web_activity_analysis.rs` | `web_activity_analysis_cmd.rs` | 1 |
| 17 | `window.rs` | `window_cmd.rs` | 7 |
| | **合计** | | **117** |

**判定规则**：`grep -c '#\[tauri::command\]'` > 0 的文件才改名。上表 117 个命令必须与改名前一字不差（`check:contract` 的「Patina 117」是自检判据）。

**⚠ 2 处与宿主同名模块（靠目录消歧，无需额外处理，但要在 review 时认得出）**：

| 新文件 | 与谁同名 | 完整路径 |
|---|---|---|
| `commands/insight/settings_cmd.rs` | 宿主 `commands/settings_cmd.rs` | `crate::commands::insight::settings_cmd` vs `crate::commands::settings_cmd` |
| `commands/insight/window_cmd.rs` | 宿主 `commands/window_cmd.rs` | `crate::commands::insight::window_cmd` vs `crate::commands::window_cmd` |

已核实：全仓**没有** `use crate::commands::*;` 之类的 glob 导入（`git grep 'use crate::commands::\*'` → 0），所以不存在歧义。

#### ② 4 个**故意不改名**的文件及理由

| 文件 | 新路径 | 命令数 | 不改名的理由 |
|---|---|---|---|
| `mod.rs` | `commands/insight/mod.rs` | 0 | 模块声明文件；改名就破坏「目录 → `mod.rs`」的约定 |
| `error.rs` | `commands/insight/error.rs` | 0 | 内容是 `CommandErrorDto` + `CommandError` 的映射（DTO），不是命令模块。**若加 `_cmd` 后缀，N2 的规则本身就自相矛盾** |
| `window_guard.rs` | `commands/insight/window_guard.rs` | 0 | 内容是 `require_main_window()` 前置守卫，被 **4 个**命令模块 `use super::window_guard::…` 调用（实测 5 处：`mini_window` 1 / `settings` 1 / `tool_notifications` 2 / `window` 1） |
| `tools_mod_tests.rs` | `commands/insight/tools_mod_tests.rs` | 0 | 它是 `tools_cmd.rs` 拆出来的测试模块。**文件名被父模块的 `#[path = "tools_mod_tests.rs"]` 显式钉死**（`tools.rs:286`），改了名要连带改 `#[path]`，零收益 |

> 校验总数：`ls src-tauri/src/patina/commands/*.rs | wc -l` = **21** = 17 改名 + 4 不改名。改完 `ls src-tauri/src/commands/insight/*.rs | wc -l` 也必须是 **21**。

#### ③ 6 处 `mod` 声明的增删（逐行列清）

**(a) `src-tauri/src/lib.rs`** —— 删 3 行、加 0 行：

```rust
// 删除这三行（当前 lib.rs:31-35 那一块）
/// Patina 子系统（vendored，MIT）：自动使用追踪 / 历史 / 分析 / 分类映射 / 工具。
/// 它有自己的 `app` / `commands` / `platform` 子树，与宿主的同名模块互不可见。
///
/// 桌面独占：上游依赖 WebView2 / Win32（`webview2-com` / `windows`），Android 编不进来。
/// 移动端保持原样——Patina 本来就没有移动版。
#[cfg(desktop)]
mod patina;
```

> `lib.rs` 里**不再出现任何 `insight`**：6 个落点各自在所属层的 `mod.rs` 里声明。这是刻意的——`lib.rs` 是「仅装配」文件，不该知道某个子系统横跨 5 层。

**(b) `src-tauri/src/app/mod.rs`** —— 末尾追加 3 行：

```rust
/* 分析窗（原 Patina 子系统）的装配层：bootstrap / 托盘 / 状态 / 主窗与迷你窗 / 追踪运行时。
   桌面独占（上游依赖 WebView2 / Win32）。`allow(dead_code)` 覆盖整棵子树——上游是独立应用，
   部分入口在融合后被宿主接管，实现留在原地以便吸收上游补丁。 */
#[cfg(desktop)]
#[allow(dead_code)]
pub mod insight;
```

**(c) `src-tauri/src/commands/mod.rs`** —— 末尾追加（注意放在 `window_cmd` 之后，避免插在 `#[cfg(mobile)] #[path]` 块中间）：

```rust
/* 分析窗的命令面（117 条，桌面独占；与宿主 80 条共用 `ipc_commands.rs` 的一张表）。 */
#[cfg(desktop)]
#[allow(dead_code)]
pub mod insight;
```

**(d) `src-tauri/src/models/mod.rs`** —— 末尾追加：

```rust
/* 分析窗的领域类型（原 patina/domain，出边 0 的纯叶子）。 */
#[cfg(desktop)]
#[allow(dead_code)]
pub mod insight;
```

**(e) `src-tauri/src/infra/mod.rs`** —— 末尾追加（该文件末尾全是 `#[cfg(desktop)] pub mod …`，追加在最后一行之后）：

```rust
/* 分析窗的平台适配（原 patina/platform：路径 / 凭据 / WebDAV / 存储控制 / Win32）。 */
#[cfg(desktop)]
#[allow(dead_code)]
pub mod insight;
```

**(f) `src-tauri/src/services/mod.rs`** —— 末尾追加：

```rust
/* 分析窗的服务层（原 patina/data + patina/engine：自带 sqlx 池的完整持久化栈 + 调度器）。
   二者互相引用（16 / 32 次），必须同层；详见本文 §1.2。 */
#[cfg(desktop)]
#[allow(dead_code)]
pub mod insight;
```

**(g) 新建 `src-tauri/src/services/insight/mod.rs`**（全案唯一新建文件）：

```rust
//! 分析窗的服务层：`data`（持久化）与 `engine`（调度 / 运行时）。
//! 二者互相依赖（data → engine 16 次、engine → data 32 次），因此同放一层，
//! 不拆进 `repositories/` 与 `jobs/`（那会造出跨层环，见 docs/refactor/patina-structural-merge.md §1.2）。

pub mod data;
pub mod engine;
```

**(h) 删除 `src-tauri/src/patina/mod.rs`** —— 它的三个作用分别转交：
- 6 条 `pub mod` → item ③ 的 (b)~(f)；
- `#![allow(dead_code)]` → 5 处 `#[allow(dead_code)]`（挂 `pub mod insight;` 上，模块级 lint 属性覆盖整棵子树）；
- `flush_coverage()` → item ⑥。

> **为什么每处都加 `#[allow(dead_code)]`**：它替换的是原来 `patina/mod.rs` 的 `#![allow(dead_code)]`。作用域等价（模块级 allow 覆盖子树），但宿主代码的死码仍然由 clippy 严判 —— 这条只覆盖 `insight` 子树，与原来「只覆盖 `src/patina/`」口径一致。

#### ④ `super::` 的层级影响：**实测 0 处需要 +1**，附判据脚本

这是 T02 最容易被想当然的一环。结论先给：**`data` / `engine` 从「顶层」变成 `services::insight::` 的子模块，但没有任何一处 `super::` 因此改变含义。** 原因不是运气，而是判据：

> `super` 每多一层，就把模块路径末尾去掉一段。只有当 `super` 的层数 **≥ 该文件在层内深度 + 1** 时，才会越过层根（原来指向 `crate::patina`，现在指向 `crate::services::insight`）—— 只有这种才需要改写。
> 例：`data/app_settings_service.rs` 的模块是 `data::app_settings_service`（层内深度 1），`super::` 指向 `data` ✓ 不变；要越过层根得写 `super::super::`，实测没有。

**实测（脚本见下）**：`super` 出现 **847 次**（`k=1` 742 处、`k=2` 105 处），**越过层根的 0 处**。所以该项**零工作量**，但必须有这条断言，否则「凭印象认为没问题」和「已验证没问题」在 review 时长得一样。

```python
# 判据脚本：在仓库根执行。输出「会越过层根的」必须为 0
import os, re
def strip(s):
    s = re.sub(r'/\*[\s\S]*?\*/', '', s)
    return re.sub(r'^\s*//.*$', '', s, flags=re.M)
esc = []; dist = {}; total = 0
for dp, dn, fn in os.walk('src-tauri/src/patina'):
    for f in fn:
        if not f.endswith('.rs'): continue
        p = os.path.join(dp, f).replace('\\', '/')
        rel = os.path.relpath(dp, 'src-tauri/src/patina').replace('\\', '/')
        segs = [] if rel == '.' else rel.split('/')
        stem = f[:-3]
        mod = segs + ([] if stem == 'mod' else [stem])   # 该文件的模块路径（层内）
        depth = len(mod) - 1                              # 层之下的段数
        txt = strip(open(p, encoding='utf-8', errors='ignore').read())
        for m in re.finditer(r'\bsuper\b((?:::\s*super\b)*)', txt):
            k = 1 + m.group(1).count('super')
            total += 1; dist[k] = dist.get(k, 0) + 1
            if k >= depth + 1: esc.append((p, '::'.join(mod), k, depth))
print('super 总数', total, '层数分布', dict(sorted(dist.items())))
print('越过层根（需改写）', len(esc))
for e in esc[:20]: print('  ✗', e)
```

**迁移后重跑（换成新根，断言仍为 0）**：把上面 `os.walk('src-tauri/src/patina')` 依次替换为
`src-tauri/src/models/insight`、`src-tauri/src/infra/insight`、`src-tauri/src/services/insight/data`、
`src-tauri/src/services/insight/engine`、`src-tauri/src/app/insight`、`src-tauri/src/commands/insight`
（注意：`data`/`engine` 的新根是 `services/insight/data`，此时「层根」= `data` 本身，语义与迁移前一致）。
**权威判据仍然是 `cargo check`**（编译器能精确判定每个 `super::` 指向的模块是否存在）；脚本的作用是**在编译前给出早期信号**，并让「0 处」这个结论可复现。

#### ⑤ 1,303 处 `crate::patina::*` 的改写脚本

**先看三个必须知道的事实**（都是实测，不是假设）：

| 事实 | 数字 |
|---|---|
| `crate::patina::` 出现总数 | **1,303** |
| 其中普通前缀式（`crate::patina::data::x`） | 1,300 |
| 其中**花括号分组式**（正则吃不到，必须单独处理） | **2** |
| 其中在 `patina/mod.rs` 的文档注释里（该文件删除，无需处理） | 1 |

**2 处花括号分组导入（必须手工改，正则替换会静默漏掉）**：

```rust
// src-tauri/src/patina/app/tool_notifications.rs:3
use crate::patina::{data::tool_notification_store as store, engine::tools};
// →
use crate::{services::insight::data::tool_notification_store as store, services::insight::engine::tools};

// src-tauri/src/patina/commands/import.rs:6
use crate::patina::{app, data::import};
// →
use crate::{app::insight, services::insight::data::import};
```

**改写映射表（长前缀在前，本表已按此排序）**：

| 序 | 旧 | 新 | 期望次数 |
|---|---|---|---|
| 1 | `crate::patina::flush_coverage` | `crate::platform::coverage::flush_coverage` | 2 |
| 2 | `crate::patina::data` | `crate::services::insight::data` | 471 |
| 3 | `crate::patina::domain` | `crate::models::insight` | 369 |
| 4 | `crate::patina::platform` | `crate::infra::insight` | 143 |
| 5 | `crate::patina::commands` | `crate::commands::insight` | 134 |
| 6 | `crate::patina::engine` | `crate::services::insight::engine` | 100 |
| 7 | `crate::patina::app` | `crate::app::insight` | 81 |
| | **合计** | | **1,300**（+2 花括号 +1 注释 = 1,303） |

> **顺序为什么重要**：`flush_coverage` 必须排第一（它是 `crate::patina::f…`，不会被 `data` 等前缀命中，但和它们同属「`crate::patina::` + 一个段」，若先写一条泛化的 `crate::patina::` → 会连 `{` 一起吃掉）。其余 6 条互不为前缀，但**必须单遍替换**——写成 6 条顺序 `sed -i` 就会二次命中：第 2 条产出 `crate::services::insight::data`，第 6 条再把里面的 `engine`… 不，危险在于 `crate::patina::data` → `crate::services::insight::data` 之后，**第 6 条若有泛化前缀会再次命中**。用一次带回调的 `re.sub` 是唯一安全写法。

**执行（Python，单遍，幂等可重跑）**：

```python
# 仓库根执行；先干跑看 diff，确认后加 --write
import io, os, re, sys
WRITE = '--write' in sys.argv
MAP = [                                    # 长前缀在前
    ('crate::patina::flush_coverage', 'crate::platform::coverage::flush_coverage'),
    ('crate::patina::data',           'crate::services::insight::data'),
    ('crate::patina::domain',         'crate::models::insight'),
    ('crate::patina::platform',       'crate::infra::insight'),
    ('crate::patina::commands',       'crate::commands::insight'),
    ('crate::patina::engine',         'crate::services::insight::engine'),
    ('crate::patina::app',            'crate::app::insight'),
]
PAT = re.compile(r'crate::patina::(flush_coverage|data|domain|platform|commands|engine|app)\b')
NEW = {a.split('::')[-1]: b for a, b in MAP}
hits = 0; files = 0
for dp, dn, fn in os.walk('src-tauri/src'):
    for f in fn:
        if not f.endswith('.rs'): continue
        p = os.path.join(dp, f)
        src = open(p, encoding='utf-8').read()
        def sub(m):
            global hits
            hits += 1
            return NEW[m.group(1)]
        out = PAT.sub(sub, src)
        if out != src:
            files += 1
            if WRITE: open(p, 'w', encoding='utf-8', newline='').write(out)
print(f'{"已写" if WRITE else "干跑"}：{hits} 处 / {files} 个文件')
# 期望：干跑与实跑都是 1300 处（另有 2 处花括号 + 1 处注释不在本脚本范围）
```

> `\b` 是必需的：没有它，`crate::patina::datafoo` 会被误命中（虽然当前不存在，但 `data` 后面紧跟 `::` 时 `\b` 不生效也无害，属于防御性写法）。
> **`newline=''`** 是必需的：仓库有 `.gitattributes`，Windows 下用默认换行写会整体翻转 CRLF，让 `check:vendored` 的 757 个哈希全变（看起来像「改了 757 个文件」）。**这是本仓最容易踩的一个坑**，脚本里已带。

**三层自证（缺一不可）**：

```bash
# 1) 一处不剩
git grep -c 'crate::patina' -- src-tauri/src          # 期望：无输出（grep 无匹配时退出码 1）
git grep -o 'crate::patina' -- src-tauri/src | wc -l  # 期望：0

# 2) 新前缀的条数与映射表逐一吻合
for p in services::insight::data models::insight infra::insight commands::insight \
         services::insight::engine app::insight platform::coverage; do
  printf "%-32s %s\n" "$p" "$(git grep -o "crate::$p" -- src-tauri/src | wc -l)"
done
# 期望依次：471 / 369 / 143 / 134 / 100 / 81 / 2

# 3) 六个新根在文件系统里都存在，且 shell 能列出内容
for d in models/insight infra/insight services/insight/data services/insight/engine \
         app/insight commands/insight; do
  printf "%-32s %s 个文件\n" "$d" "$(find src-tauri/src/$d -type f | wc -l)"
done
# 期望：37 / 56 / 137 / 39 / 29 / 21
```

> 第 3 条替代「新路径在文件系统里都存在」的解析器：**`cargo check` 本身就是最精确的解析器**（未解析的 use 会报 E0432/E0433），而上面 6 个目录的文件计数能立刻抓出「`git mv` 少搬了一层」这类结构性错误（比如 `data` 搬成了 `services/insight/data/data`）。两者一起用，不需要另写一个 Rust 路径解析器（写不准，`crate::a::b` 的 `b` 可能是函数而非模块，静态判断会有假阳性）。

#### ⑥ `check-contract.mjs` 的正则怎么改

现状（两个函数，第 55–67 行）：

```js
function rustCommands() {
  const src = read('src-tauri/src/ipc_commands.rs');
  return new Set([...src.matchAll(/crate::commands::\w+::(\w+)/g)].map((m) => m[1]));
}
function patinaCommands() {
  const src = read('src-tauri/src/ipc_commands.rs');
  return new Set([...src.matchAll(/crate::patina::commands::\w+::(\w+)/g)].map((m) => m[1]));
}
```

**为什么必须改**：`crate::commands::insight::settings_cmd::cmd_x` 会被 `\w+::(\w+)` 捕获成 `insight` + …，即把 `settings_cmd` 当命令名；宿主集合从 80 变成 80+117 个垃圾项，而 `cargo check` 全绿 —— **纯契约层的静默失效**。

改后：

```js
/* 宿主命令：`crate::commands::<模块>::<函数>`，模块名不得是 insight 命名空间。
   负向断言 (?!insight::) 是必需的 —— 少了它，三层路径会把模块名当命令名捕获。 */
function rustCommands() {
  const src = read('src-tauri/src/ipc_commands.rs');
  return new Set([...src.matchAll(/crate::commands::(?!insight::)(\w+)::(\w+)/g)].map((m) => m[2]));
}

/* 分析窗命令：多一层嵌套，单独解析。计数必须恒为 117（归一不改变命令面）。 */
function patinaCommands() {
  const src = read('src-tauri/src/ipc_commands.rs');
  return new Set([...src.matchAll(/crate::commands::insight::(\w+)::(\w+)/g)].map((m) => m[2]));
}
```

**⚠ 最容易被忽略的一行**：正则多了一个捕获组，取值下标必须从 `m[1]` 改成 **`m[2]`**。忘了改的话，宿主集合会变成 80 个模块名（`item_cmd`、`timer_cmd`…），`check:contract` 会报「Rust 注册了、前端没调用」一片红 —— 好在是**红**，不是静默。

**⚠ 第三处要改：`emitSites()` 里的 `isVendored`。**

上面两处命令正则只是命令面的一半；同一文件里 `emitSites()` 还留着一条**路径豁免**：

```js
const VENDORED_RS = ['src-tauri/src/app/insight/', /* … 5 个 insight 根 */];
const isVendored = (rel) => VENDORED_RS.some((p) => rel.replace(/\\/g, '/').startsWith(p));
…
if (!isVendored(rel)) literals.push(`${rel}: ${arg}`);
```

不改它，那 8 处（原文写 8；按 `\s*` 允许换行的正则是 **12 处**，另加 2 处 `emit_to`）上游字面量 emit
会立刻被判「硬编码事件名」→ `npm run check` 红。但**这条豁免不是 T02 撤的**：T02 只把前缀换成 5 个
`insight/` 新根，让门禁继续绿；撤掉它是 T03（改用事件常量）之后 T04 的事（§4.5）。
T03 另加了一个 `insightRustEvents()` 值映射（读 `models/insight/events.rs`），只为让「emit 点」计数
不因常量化从 17 掉成 11 —— 它不是豁免，不给字面量开口子。

**验证（改完立刻跑）**：

```bash
npm run check:contract
# 期望摘要一字不差：
# [contract] OK — 命令：Rust 80（+Patina 117）/ IpcApi 80 / ipc.ts 80 / mock 80；
#                    错误码：Rust 17 / 前端 17；事件：后端 11 / 前端 11 / emit 点 17

# 交叉验证三个数（应分别 = 80 / 117 / 197）
grep -cP '^ *crate::commands::(?!insight::)' src-tauri/src/ipc_commands.rs   # 80
grep -c 'crate::commands::insight::' src-tauri/src/ipc_commands.rs           # 117
grep -c 'crate::commands::' src-tauri/src/ipc_commands.rs                    # 197
```

> 注意：`check-contract` 里 `aclCommands()` 只比对 **宿主** 命令与 `permissions/host-commands.toml`。insight 的 117 条不在那张 ACL 里（它们在 `permissions/window-commands.toml`，按窗口 label 授权），所以**本批不需要动任何 `.toml` / `capabilities/*.json`** —— 已核实这两个文件的路径与内容都与 `crate::patina` 无关。

#### ⑦ `flush_coverage` 搬到哪儿 + `Cargo.toml` 要不要改（核实结论）

**现状**（实测）：

| 位置 | 内容 |
|---|---|
| `src-tauri/src/patina/mod.rs:34-42` | `#[cfg(feature = "patina_coverage")] pub(crate) fn flush_coverage()`，内含 `unsafe extern "C" { fn __llvm_profile_write_file() -> i32; }` + 一句 `eprintln!` |
| `src-tauri/src/patina/app/bootstrap.rs:199-200` | `#[cfg(feature = "patina_coverage")] { crate::patina::flush_coverage(); }` |
| `src-tauri/src/patina/commands/diagnostics.rs:31-32` | 同上 |
| `src-tauri/Cargo.toml:189` | `patina_coverage = []`（注释写明「只声明不启用；不声明会得到 `unexpected cfg` 警告」，因 clippy `-D warnings`） |

**结论：搬到新文件 `src-tauri/src/platform/coverage.rs`，`Cargo.toml` 不改。**

理由（逐条）：
1. **不放 `lib.rs`**：`lib.rs` 首行文档写的是「仅装配…无业务」，把一个 FFI 覆盖率检查点塞进去破坏这个约定；且 `lib.rs` 已有 224 行，虽然加 15 行不触 300 行上限，但方向是错的。
2. **不放 `app/insight/`**：它的两个调用点虽然都在 insight 里，但它是**crate 级调试钩子**（依赖 `__llvm_profile_write_file` 这个 C 符号），不属于分析窗业务。
3. **放 `platform/`**：`platform/log.rs` 是同性质的构建/诊断叶子（90 行、零依赖方向问题），二者并列最自然；`platform` 是叶子层，`flush_coverage` 不 import 任何 crate 内模块，**L4（infra 禁 services）等全部天然满足**。
4. **`Cargo.toml` 不改**：`patina_coverage` 只是开关名，与源码路径无关；`patina_local_build` 还被 `app/insight/runtime.rs` 的 3 处 `cfg` 使用（随文件搬走，无需改）。改名成 `insight_coverage` 需要同步 Cargo.toml + 3 处 cfg + 覆盖率工具链文档，收益为零，且会丢掉与上游 feature 名的对应关系。已登记为 §8 非目标。

**新文件内容（`src-tauri/src/platform/coverage.rs`）**：

```rust
//! 覆盖率检查点（仅专用 coverage 编译器 wrapper 打开 `patina_coverage` feature）。
//!
//! 上游 Patina 把它写在 `lib.rs` 的 crate root；本 crate 的 root 是 Timing 的 `lib.rs`，
//! 归一后落在 `platform` 叶子层（与 `platform/log.rs` 并列：同属构建/诊断钩子，
//! 且不 import 任何 crate 内模块，不引入依赖方向）。
//!
//! 与 `Cargo.toml` 的 `patina_coverage = []` 配对：不声明该 feature 会得到
//! `unexpected cfg` 警告，本项目 clippy 是 `-D warnings`，所以 feature 只声明不启用。

#[cfg(feature = "patina_coverage")]
pub(crate) fn flush_coverage() {
    unsafe extern "C" {
        fn __llvm_profile_write_file() -> i32;
    }
    if unsafe { __llvm_profile_write_file() } != 0 {
        // L6：全域禁 eprintln!（Release 的 GUI 进程里无处可见）。归一后必须走宿主日志。
        crate::log_error!("native coverage checkpoint failed");
    }
}
```

配套改动（3 处，一行一个）：

| 文件 | 改动 |
|---|---|
| `src-tauri/src/platform/mod.rs` | 追加 `#[cfg(feature = "patina_coverage")] pub mod coverage;` |
| `src-tauri/src/app/insight/bootstrap.rs:200` | `crate::patina::flush_coverage();` → `crate::platform::coverage::flush_coverage();`（由 item ⑤ 的映射表第 1 条自动完成） |
| `src-tauri/src/commands/insight/diagnostics_cmd.rs:32` | 同上 |

> 注意 `flush_coverage` 里的 `eprintln!` **不会**被 item ⑤ 的脚本处理（那是路径改写）。它是 L6 的 154 处之一，归属 T03。**但如果 T02 只搬到 `platform/coverage.rs` 而不改这一句，`check:layers` 的 L6 会在 T02 就红** —— 因为 `platform/` 从来不在 vendored 豁免列表里。
> **处置**：在 T02 里顺手把这一句改成 `crate::log_error!`（**唯一的 1 处**），其余 153 处留给 T03。这样 T02 提交时 `check:layers` 仍绿。

#### ⑧ T02 开工前的 pre-flight（5 条，逐条打勾）

```bash
# 1. 并发前提：对方会话的 tests/md 重构不能被卷进来
git status --porcelain | grep -c 'src-tauri/src/tests/'   # 记录数字，T02 提交时不得变化
git diff src-tauri/src/lib.rs                              # 必须为空；非空 → 先 rebase

# 2. 基线已存（§5 阶段 0.2）
grep -c 'passed' /tmp/merge-baseline.txt                   # ≥2（npm test + cargo test 两份）

# 3. 移动前记录 320 个文件的哈希（用于证明「只搬不改」）
git ls-tree -r HEAD --name-only src-tauri/src/patina | wc -l   # 320

# 4. 改名前的模块清单（改完必须逐条对上）
ls src-tauri/src/patina/commands/*.rs | wc -l              # 21

# 5. 环境干净
git stash list                                               # 不含本次迁移的未提交内容
```

T02 提交后回头核对的 4 个数：**`21`（insight 命令文件）→ `117`（命令条数）→ `1302`（实际改写数 = 1300 单遍正则 + 2 处花括号；原始出现 1303 另含 1 处随 `patina/mod.rs` 删除的注释）→ `0`（改完 `crate::patina` 残留）**。这四个数对不上，就是哪一步漏了。

---

### T03 代码归一化（让代码先合规，再收紧门禁）

顺序是刻意的：**先改代码，后撤豁免**。反过来会让 `npm run check` 在批次之间长时间红着，失去 bisect 能力。

**动什么**：§4.1 的 154 处日志、§4.2 的 `windowApi.ts` + 2 个 import、§4.4 的 3 处 lint、§4.5 的 `app/insight/events.rs` + `platform/runtime/insightEvents.ts` + 11 处字面量。

**判据**

```bash
grep -rnE '\beprintln!\(' src-tauri/src --include=*.rs | wc -l            # 0
grep -rc 'log_info!\|log_warn!\|log_error!' src-tauri/src/services/insight --include=*.rs | awk -F: '{s+=$2}END{print s}'   # ≈154
grep -rl '@tauri-apps/api/window\|@tauri-apps/api/webviewWindow' src     # 只有 src/lib/windowApi.ts
grep -rnE '\.emit\(\s*"' src-tauri/src --include=*.rs | wc -l            # 0
npm run lint                                                              # 0（此时 override 仍覆盖子树，故必须 0）
npm test                                                                  # 700
cargo test --lib                                                          # 1684 / 1env / 9
```

**回滚**：`git revert --no-edit <T03 sha>`。

---

### T04 门禁重锚（撤掉全部 4 套路径豁免）

**动什么**

| 文件 | 改动 |
|---|---|
| `scripts/check-layers.mjs` | 删 `VENDORED` 与 `isVendored`；L3 白名单改 `src/lib/windowApi.ts` 并加 `webviewWindow`；L1/L2 扫描前缀扩围（§4.6）；新增 **L9 双窗隔离**（含哨兵：两条路径集合必须非空，防绿着空转） |
| `scripts/check-size.mjs` | 删 `VENDORED`；`size-allowlist.json` 加 `maxLines` 棘轮；加 `--freeze` |
| `scripts/check-contract.mjs` | 删 `isVendored` 字面量豁免；加 insight 双通道（§4.5） |
| `eslint.config.js` | override 缩到 `['src/shared/i18n/generated/**']`，只关 `no-sparse-arrays` |
| `scripts/size-allowlist.json` | 152 条（脚本生成） |
| `AGENTS.md` | 层序表补 `insight`、双窗边界一行、`src/app/` 命名说明 |

**判据（这是全案的主判据）**

```bash
npm run check
# 期望：typecheck 0 / contract OK 80(+117) / size OK（白名单 152 条）/ vendored OK
#      / version OK / layers OK（9 条规则）/ brand OK / lint 0
grep -rn 'VENDORED\|isVendored' scripts/*.mjs | wc -l     # 0
grep -rn 'src/patina\|src-tauri/src/patina' scripts/ eslint.config.js | wc -l   # 0
```

**L9 反向自检（必做，否则门禁可能是空转）**：
```bash
# 临时在 src/components/ 里加一行 import 指向 src/features/ → 必须变红；然后撤回
```
**回滚**：`git revert --no-edit <T04 sha>`（此时 T01–T03 的代码已经合规，revert 后旧门禁重新放行，不会红）。

---

### T05 账本改造与文档收尾

**动什么**

- `check-vendored-diff.mjs`：`--upstream` 加 `UPSTREAM_MAP`（§6.2）；`normalize()` 里 `crate::patina::` → `crate::` 改成 6 条反向映射；baseline 的 `source.ref` 更新为 T02 的 sha 并加 `pathMapping` 说明段；allowlist 的 `owner` 变必填（缺则红）。
- `AGENTS.md` / `README.md` / `THIRD-PARTY-NOTICES.md`：把「vendored 子树」叙述改成「已归一，保留上游对账账本」；写清运行时标识（窗口 label `patina` / `patina.html` / 数据目录）为何保留。
- `docs/refactor/patina-structural-merge.md`（本文）标注为「已执行」。

**判据**

```bash
npm run check                                                    # 全绿
node scripts/check-vendored-diff.mjs --upstream <patina-main 解压目录>
# 期望：能正常出报告，前端/后端「同 N · 实质差异 M」与迁移前一致（M 不应变大）
```

**回滚**：`git revert --no-edit <T05 sha>`。

---

### 依赖图

```mermaid
graph LR
  P0[阶段0: 清工作区] --> T01[T01 前端去前缀]
  P0 --> T02[T02 后端去子树]
  T01 --> T03[T03 代码归一化]
  T02 --> T03
  T03 --> T04[T04 门禁重锚]
  T04 --> T05[T05 账本与文档]
```

T01 与 T02 触及的文件集合**完全不相交**（`src/**` vs `src-tauri/src/**`，交集只有 `scripts/*.mjs` 的常量与两个 JSON，但那两处是 T01/T02 各自改自己那一半的前缀）。若两人并行，`scripts/check-layers.mjs` 的 `VENDORED` 会有一次文本冲突——**建议串行提交，或把 `VENDORED` 改成从 `scripts/vendored-roots.json` 读取**（一处文件、两个数组、零冲突）。后者更省事，列为可选优化。

---

## 6. vendored 机制的终局

### 6.1 判决：不退役，改造并保留

三个文件要分开判——它们其实管着两件不同的事：

| 文件/机制 | 管什么 | 判决 | 理由 |
|---|---|---|---|
| `check-layers` 的 `VENDORED`、`check-size` 的 `VENDORED`、`eslint` 的子树 override、`check-contract` 的 `isVendored` | **规则豁免**（「这些代码我们不管」） | **全部撤销** | 这是本次迁移的目的本身。归一后没有「我们不管」的代码。 |
| `check-vendored-diff.mjs` + `vendored-baseline.json` + `vendored-allowlist.json` | **改动登记账本**（「改它要登记理由」） | **改造并保留，且继续留在 `npm run check` 里** | 归一不等于不吸收上游。Patina 上游仍在维护，`--upstream` 对账是唯一能把「上游补丁」和「我们的分叉」分开的工具。实测当前账本 757 个文件（FE 437 / BE 320），白名单 14 条（5 改 + 9 增），`--upstream` 归一后仍有 17 个 Rust + 4 个前端真分叉。这些信息在归一后一条都不会消失。 |

**判据上的区别**：豁免 = 门禁不看你；账本 = 门禁盯着你但允许你说「我改了，理由是 X」。后者是资产，前者是债。

### 6.2 `--upstream` 的路径映射怎么写

上游目录结构（`patina-main/`）：

```
src/{app,features,platform,shared,styles}          ← 前端
src-tauri/src/{app,commands,data,domain,engine,platform}  ← 后端
```

归一后的本地结构（§2）。所以 `reportUpstream()` 的 `pairs` 从 2 条变成 **2 + 6 + 1 = 9 条映射**：

```js
/* 上游相对路径 → 本地绝对路径。全部是「前缀 + 尾部原样」，无逐文件特例。 */
const UPSTREAM_MAP = [
  // 前端：4 个域目录是纯前缀剥离（styles 特殊，进 app/styles）
  { up: 'src/app',        loc: 'src/app',
    // 例外：App.tsx / main.tsx / App.css 由上游的 src/ 根移到 src/app/，styles 移到 src/app/styles
    extra: [
      { up: 'src/App.tsx',  loc: 'src/app/App.tsx' },
      { up: 'src/main.tsx', loc: 'src/app/main.tsx' },
      { up: 'src/App.css',  loc: 'src/app/App.css' },
      { up: 'src/styles',   loc: 'src/app/styles' },
    ] },
  { up: 'src/features', loc: 'src/features' },
  { up: 'src/platform', loc: 'src/platform' },
  { up: 'src/shared',   loc: 'src/shared' },
  // 后端：6 条前缀映射
  { up: 'src-tauri/src/domain',   loc: 'src-tauri/src/models/insight' },
  { up: 'src-tauri/src/platform', loc: 'src-tauri/src/infra/insight' },
  { up: 'src-tauri/src/data',     loc: 'src-tauri/src/services/insight/data' },
  { up: 'src-tauri/src/engine',   loc: 'src-tauri/src/services/insight/engine' },
  { up: 'src-tauri/src/app',      loc: 'src-tauri/src/app/insight' },
  { up: 'src-tauri/src/commands', loc: 'src-tauri/src/commands/insight' },
];
```

`normalize()` 的文本归一从 1 条变 7 条（同样单遍回调，避免二次命中）：

```js
const TEXT_MAP = [
  [/crate::services::insight::data::/g,    'crate::data::'],
  [/crate::models::insight::/g,            'crate::domain::'],
  [/crate::infra::insight::/g,             'crate::platform::'],
  [/crate::commands::insight::/g,          'crate::commands::'],
  [/crate::services::insight::engine::/g,  'crate::engine::'],
  [/crate::app::insight::/g,               'crate::app::'],
];
// 仍需保留：① 截断到 `#[cfg(test)]` 之前（35 个 *_mod_tests.rs 拆分）
//          ② 命令模块的 `_cmd` 后缀归一：`settings_cmd` ↔ 上游 `settings`
```

第 ② 条是新增的归一负担：N2 给 17 个模块加了 `_cmd` 后缀，`--upstream` 若不做后缀归一，会把这 17 个文件全报成「实质差异」。**这是 N2 的隐性成本，必须在 `normalize()` 里补一条 `_cmd` 剥离**（`/(^|[^a-z])settings_cmd/g → $1settings`，共 17 个词表）。

> 如果不想背这个成本，N2 可以取消（`commands/insight/settings.rs` 已经够消歧）。**我的建议仍是保留 N2**：`_cmd` 后缀是宿主读目录时的第一信息（「这个文件是命令模块」），17 个词的归一表是一次性成本。

---

## 7. 风险清单（最可能出事的三处 + 早期信号）

### R1（最高）Tailwind `source("./")` 扫描根静默失效

| 项 | 内容 |
|---|---|
| 事实 | `src/patina/App.css` 第 1 行：`@import "tailwindcss" source("./");`。Tailwind v4 用它决定**去哪扫 `className` 生成工具类**。`App.css` 一旦搬到 `src/app/` 而 `source("./")` 不变，扫描根就变成 `src/app/`——`features/`（220 文件）、`shared/`（94）里的类全部不生成。 |
| 为什么最危险 | **`npm run typecheck` / `lint` / `test` / `build` 全绿**。构建成功、CSS 文件产出、类名缺失只是视觉塌陷。`check:size` 也不会红。这是全案唯一「所有门禁都抓不到」的失效模式。 |
| 早期信号（哪个命令先红） | **没有任何命令会先红。** 只能靠主动断言：`npm run build` 后执行<br>`grep -o 'quiet-' dist/assets/patina-*.css \| wc -l` ≥ 1，及<br>`grep -c 'grid-cols-\|text-\[var(--' dist/assets/patina-*.css` 与迁移前的基线对比（**迁移前必须先跑一次存基线**）。 |
| 处置 | ① T01 同批把 `source("./")` 改 `source("../")`；② T01 验收加一条「构建产物类名数不减少」的硬比对；③ 可选：改成显式多根 `source("../app") source("../features") source("../shared")`，把扫描面钉死在分析窗三处，避免 `src/` 全量扫描把宿主的类也生成进来（体积膨胀，不影响正确性）。 |

### R2 契约脚本把 insight 命令误算进宿主的 80 条

| 项 | 内容 |
|---|---|
| 事实 | `check-contract.mjs` 的 `rustCommands()` 正则是 `/crate::commands::\w+::(\w+)/g`。归一后命令表里出现 `crate::commands::insight::settings_cmd::cmd_x`，该正则会把 `settings_cmd` 当成命令名捕获进来 → 宿主命令集合从 80 变成 80+117 个垃圾项。 |
| 为什么危险 | 它**不是编译错误**，`cargo check` / `cargo test` 全绿。而且失败信息是「Rust 注册了、前端没调用」这一栏冒出一百多个不存在的名字，很容易被误判成「迁移把命令表搞坏了」。 |
| 早期信号 | `npm run check:contract` 摘要行第一个数字：`命令：Rust 80（+Patina 117）` → 变成 `Rust 197（+Patina 0）` 或类似。这条摘要就在输出的第一行，**T02 提交前必看**。 |
| 处置 | T02 同批改正则（负向断言 `(?!insight::)` + 独立的 insight 解析器）。变更后**校验三数不变**：80 / 117 / 17 个错误码。 |

### R3 `#[path]` 模块单元被按文件拆散

| 项 | 内容 |
|---|---|
| 事实 | Patina 内 **34 个「同名 `.rs` + 同名目录」模块**、**90 处 `#[path]`**、**56 个 `*_tests.rs`**。`#[path = "xxx_mod_tests.rs"]` 是**相对父模块所在目录**的路径。只要「主文件 / 同名子目录 / 测试文件」被分到不同目标目录，`#[path]` 立刻指空。 |
| 为什么危险 | 这类路径大多在 `#[cfg(test)]` 里 → `cargo check` **看不见**，只有 `cargo test --lib` 才炸。如果只跑 `cargo check` 就提交，问题会推迟到 CI 才暴露，且报错信息是「file not found for module」，指向上游写法，容易误判成上游代码有问题。 |
| 早期信号 | `cargo test --lib` 编译阶段报 `error: couldn't read .../xxx_mod_tests.rs`。另一条更早的信号：`git status` 里出现**任何 `D`（删除）+ `??`（新增）**而不是 `R`（重命名）——那说明某次移动被 git 判成了「删+建」，模块单元多半被拆了。 |
| 处置 | ① 全部按**整层 `git mv`**（本方案就是这么设计的：整层搬，不按文件挑），不动层内结构；② T02 提交前 `git diff --cached --stat -M` 确认全部识别为 `rename`（`R`）而非 `D`+`A`；③ 验收必须包含 `cargo test --lib`，不能只看 `cargo check`。 |

### 次要风险（登记但不排前三）

| 风险 | 信号 | 处置 |
|---|---|---|
| 相对路径手改漏项（**已实测发生过一次**：3 处资产 import 的 `../` 少减 1） | §1.1.1 的解析器报 `解析失败 >0`；`tsc` **不会**报（`.png`/`.css` 走 Vite 资产解析） | 每批 T01 必跑解析器，期望 0；11 行手改表在 §1.1.1，逐行核对 |
| 并发会话（另一会话正在收 `tests/md_*/` → `tests/md/`，53 个暂存重命名） | `git status` 里出现不属于本批的 `R`/`M`/`??`；`lib.rs` 出现非本方改动 | 独立 `git worktree`（§5 阶段 0.1）；`src-tauri/src/tests/**` 一字节不动；改 `lib.rs` 前审 diff |
| `ipc.ts` 卡 300 行 + `check-contract` 用内联正则解析其 `call('...')` | 若为归一去动它 → `check:contract` 报「Rust 注册了、前端没调用」一片红 | **本方案不动 `ipc.ts` 一个字符**（300 行原样）。若将来要拆，先把 `check-contract` 的解析改成扫目录。 |
| `src-tauri/src/app/bootstrap.rs` 正好 300 行 | `check:size` 报 301 行 | 本方案不往该文件加任何一行；`mod insight;` 加在 `app/mod.rs`（56 行）而不是 `bootstrap.rs`。 |
| `src/components` 下出现字符串 `invoke(` 或 `ipc.`（**包括注释里**）判 L1 红 | `check:layers` L1 | T04 扩围 L1 到 `features/**/components` 后，写 insight 组件时**注释里也不能出现 `invoke(`/`ipc.`**，需在 AGENTS.md 写明。 |
| 源码级测试死路径 | `npm test` 静默变绿/红 | 7 个 `readFileSync` 测试里只有 1 个在分析窗内（`src/app/hooks/useThemeWiring.source.test.ts`，读 `../../features/settings/components/Settings.tsx`）。实测搬迁后该相对路径**仍然成立**（`src/app/hooks/` → `../../features/…` = `src/features/…`）。T01 后必须单独跑它并确认「断言的是新路径下真实存在的文件」——建议给它加一句 `expect(source.length).toBeGreaterThan(0)` 之类的最小存在性断言（当前 `readFileSync` 若读不到会直接抛，还算安全）。 |
| 移动端构建 | `cargo check --target aarch64-linux-android` 可能因 NDK 缺失无法本机验证 | 6 处 `mod insight;` 全部 `#[cfg(desktop)]`；用 `grep -rn 'insight' src-tauri/src --include=*.rs \| grep -v '/insight/'` 检查所有外部引用是否都在 `#[cfg(desktop)]` 或 `#[cfg(feature="patina_coverage")]` 内。CI 的 android 构建是最终判据。 |

---

## 8. 非目标（明确不做，避免评审时反复讨论）

| 项 | 为什么不做 |
|---|---|
| 窗口 label `"patina"` 改名 | 它是**运行时契约**：20 处 Rust 字符串 + `capabilities/patina.json`（`"windows": ["patina","mini"]`）+ `permissions/patina-host-bridge.toml` / `patina-host-theme.toml` + `src/services/ipc.ts` 的 ACL 注释。改名收益是「名字好听」，风险是「窗口开了但所有 IPC 被 ACL 静默拒掉」。**源码结构 ≠ 运行时标识**，本轮只归一前者。 |
| `patina.html` 改名 | 同上（URL 路径契约，4 处 Rust `WebviewUrl::App("patina.html")` + `vite.config.ts` input 键）。 |
| 数据目录 `data_root()/patina` 改名 | 那是**已有的用户数据**（`src-tauri/src/app/patina_bridge.rs:18`）。改名 = 数据迁移，与结构轻重无关。 |
| Cargo feature `patina_coverage` / `patina_local_build` 改名 | 只影响覆盖率工具链，收益为零。 |
| `src/services/ipc.ts` 拆分 | 300 行卡死 + `check-contract` 内联正则解析它。与本案无关，不要顺手做。 |
| 拆 152 个超限文件 | 见 §4.3，与「保留上游对账」直接冲突。只有宿主已改过的 2 个（`History.tsx` 1,206 / `Settings.tsx` 364）列入 P1 后续。 |
| `src-tauri/src/jobs/insight/` 独立 | `data ↔ engine` 环未破，强行拆会造出 `repositories ↔ jobs` 跨层环。登记为将来候选。 |
| 引入 `@/` 路径别名 | 实测**当前不存在任何别名**：`tsconfig.json` 无 `paths`，`vite.config.ts` 无 `resolve.alias`。题面里那 38 处「`@` 开头」全是 `@tauri-apps/*` 的 scoped 包名（`core` 23 / `event` 11 / `app` 1 / `window` 1 / `webviewWindow` 1 / `plugin-opener` 1），**没有一处是路径别名**。在 446 文件的搬迁里引入别名 = 给每次 bisect 再加一个变量。留作后续 ADR。 |

---

## 9. 附录：实测方法与全部数字

| 编号 | 指标 | 命令 | 实测值 |
|---|---|---|---|
| A1 | Patina 前端规模 | `find src/patina -type f \| wc -l`；行数用 Python 累加 `\n` | **446 文件 / 69,828 行**（app 53/4,668；features 220/37,495；platform 54/6,069；shared 94/12,616；styles 21/8,908）+ 根 4 文件 |
| A1' | 宿主前端规模 | `find src -type f -not -path 'src/patina/*'` | **363 文件 / 47,216 行** |
| A2 | 前端按语义分层 | 路径段含 `components`/`hooks`/`services`/`lib`/`types` 计数 | components 122 / services 104 / hooks 53 / lib 14 / types 10 / 其他 124 |
| A3 | 前端 import 形态（Patina） | 正则扫 `from`/`import(`/`@import`（**先剔注释**，否则文档里的 `from './x'` 会变假阳性） | 相对 **1,642**（1,621 TS/TSX + 21 CSS `@import`）/ bare 包 **201** / `@` 开头 **38**（其中 `@/` 别名 **0**）。整仓 `src/` 相对引用 **2,889** |
| A3' | 模拟搬迁后的相对引用解析 | §1.1.1 的解析器（文件集含 `src` + `src-tauri/icons` + 根 `tests`，扩展名补全 `.ts/.tsx/.css/.json/.png/.svg/index.*`） | 手改前失败 **11 处**（= §1.1.1 表）；按表改完失败 **0 处**。**这是「算得对」的机械证明**
| A4 | 跨窗引用 | 路径解析后判前缀 | Patina→宿主 **3**（`src-tauri/icons/*.png`，**搬迁后 `../` 需各减 1**）；宿主→Patina **0** |
| A5 | 窗口 API 使用点 | `grep -rn '@tauri-apps/api/window' src --include=*.ts --include=*.tsx` | 共 6 行 / 2 文件：`src/lib/window.ts` 3 行代码 + 2 行注释；**Patina 侧 1 行**（`windowControlGateway.ts:3`）。`webviewWindow` 全仓 **1 行**，同在 Patina 该文件（`:2`） |
| A6 | 分析窗传输层 | `grep -rlE '\bipc\.\|invoke\(' src/patina` | **11 文件 / 28 行**，全部在 `platform/**/*Gateway.ts`；`components/` 与 `hooks/` 命中 **0** |
| A7 | 前端 store 触碰传输层 | 同上，路径含 `store` | **0** |
| A8 | 分析窗测试 | `find src/patina -name '*.test.ts*'` | **3**（全是宿主后加的）；宿主 **84** |
| B1 | Patina 后端规模 | 同 A1 | **320 文件 / 94,568 行**（data 137/48,017；platform 56/15,267；engine 39/13,322；domain 37/8,521；app 29/7,261；commands 21/2,138） |
| B1' | 宿主后端规模 | 同上，排除 patina | **324 文件 / 48,040 行** |
| B2 | Rust 层依赖矩阵 | 正则提 `crate::patina::<layer>`，按源层聚合 | domain 出边 **0**；platform→domain 15；data→domain 138 / engine 16 / platform 34；engine→data 32 / domain 109 / platform 24；app→data 39 / domain 63 / engine 35 / platform 40；commands→app 26 / data 39 / domain 24 / engine 22 / platform 9 |
| B3 | `sqlite_pool` 的上行依赖 | `grep -rhn 'crate::patina::' data/sqlite_pool*` | `repositories::mini_window::load` ×2、`activity_read_model::maintain_once` ×2、`schema*`、`sqlite_error` |
| B4 | 命令层直接用 repositories | `grep -rn 'crate::patina::data::repositories' patina/commands` | **3 文件**（`mini_window.rs` `persistence_read.rs` `settings.rs`） |
| B5 | `crate::patina::*` 引用 | `git grep -o 'crate::patina::[a-z_]+'` | **原始 1,303 次 / 233 文件；实际改写 1,302 次**（1300 正则 + 2 花括号；另 1 处随 `mod.rs` 删除） |
| B6 | `eprintln!` | `grep -rnE '\beprintln!\(' src-tauri/src/patina` | **154**（app 86 / data 24 / platform 20 / engine 20 / domain 3 / mod.rs 1）；多行宏 26；带 `[tag]` 140；关键词粗判 error 114 / info 36 / warn 4 |
| B7 | `#[path]` / 模块单元 / 测试文件 | `grep -rn '#\[path'`、目录并存检测 | patina 内 **90 处 `#[path]`**（全仓 101）；**34 个 file+dir 模块**；**56 个 `*_tests.rs`** |
| B8 | `.emit("字面量")` | `grep -rnoE '\.emit\(\s*"'` | Patina **8** / 宿主 **0**；4 个事件名，其中 `power-lifecycle-changed` 前端监听 0 |
| B9 | `#[tauri::command]` | `grep -c` 逐文件 | **117** 条 / **17** 个模块（另 4 个文件 0 条：`mod.rs` `error.rs` `window_guard.rs` `tools_mod_tests.rs`） |
| G1 | 门禁现状 | `npm run check:layers/check:size/check:vendored/check:contract/lint/typecheck` | layers OK（8 规则 / 1,358 文件）；size OK（1,432 文件 + **152** 个 vendored 超限，最大 1,936）；vendored OK（基线 7bc7bd7 / **757** 文件 / 改 5 增 9 删 0 / 白名单 14）；contract OK（Rust **80** + Patina **117** / IpcApi 80 / ipc.ts 80 / mock 80；错误码 17/17；事件 11/11/17）；lint 0；typecheck 0 |
| G2 | eslint 撤 override 的成本 | §4.4 的 Node API 片段 | **834** = `no-sparse-arrays` 831（单文件 `shared/i18n/generated/resources.ts`）+ `prefer-const` 2 + `no-control-regex` 1 |
| G3 | size 超限细分 | Python 逐文件数行 | FE **61**（css 8 / ts-tsx 53）、BE **91**（其中 `*_tests.rs` 21）；≥600 行 **53**、300–599 **99**；宿主侧 **0** |
| T1 | 前端测试基线 | `npm test` | **87 files / 700 passed / 14.16s** |
| T2 | 后端测试基线 | `cargo test --lib` | **1684 passed / 1 failed / 9 ignored**；失败项 `patina::platform::storage_control::tests::registry_access_denial_preserves_old_configuration_and_never_uses_defaults`（`reg.exe` 被本机安全策略拦，环境性） |
| T3 | 工作区状态 | `git status --porcelain` | **脏**：`README.md` 修改 + 一批 `src-tauri/src/tests/md_*.rs` 重命名未提交 → 必须在阶段 0 处理 |
| S1 | 引用路径的脚本清单 | `grep -rln 'src/patina\\|src-tauri/src/patina' scripts/` | `check-contract.mjs`(3) `check-layers.mjs`(3) `check-size.mjs`(2) `check-vendored-diff.mjs`(4) `vendored-allowlist.json`(15) `vendored-baseline.json`(760)；另有 `patina-gen-ipc.py` `patina-merge-ipc.py` `patina-restore-split.py`（一次性工具，T05 处理或归档） |

---

## 10. 给执行者的四条硬提醒

1. **前端的「相对路径算对」靠跑脚本，不靠眼看。** 1,631 处靠结构成立、**11 处必须手改**（§1.1.1 的表）。改完必须跑 §1.1.1 的解析器并看到 `解析失败 0 处`——`tsc` 对 `.png`/`.css` 资产导入是放行的，抓不到那 3 处层级错误（这是本案实测踩到的第一个真坑）。
2. **不要按文件挑，整层 `git mv`。** 34 个 file+dir 模块 + 90 处 `#[path]` + 56 个测试文件，任何一次「只搬这个 .rs」都会断（R3）。
3. **每批提交前跑的是 `npm run check` + `cargo test --lib`，不是 `cargo check`。** `#[path]` 与 3 个源码级测试的断裂都只在测试目标里可见（R3）。
4. **迁移前先存两份构建基线**：`dist/assets/patina-*.css` 的工具类计数（R1），以及 `npm run check` 六条门禁的完整输出。没有基线就无法证明「搬迁没改变任何行为」，只能证明「命令退出码是 0」。
5. **本迁移在独立 `git worktree` 里做**（§5 阶段 0.1）：另一个会话正在同一工作区重构 `src-tauri/src/tests/`，不要 stash 别人的活；`src-tauri/src/tests/**` 一个字节都不动；改 `lib.rs` 前先审 diff。
