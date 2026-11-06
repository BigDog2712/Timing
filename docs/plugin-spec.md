# Timing 插件规格（v3 · V0.11.5）

> 状态：**v1 / v2 已实装；v3 已定义，运行时未实现**（逐项状态见 §10.1 的状态列）。
> 适用 Timing `0.11.5` 及以后；v1 / v2 插件继续有效。
> **V0.3.9 起** `quickTimers` 不再注入摸鱼菜单（菜单改为应用内置条目，见 §4 顶部与 ADR-026）。
> **V0.4.0（apiVersion 2）** 新增 `mdSync` 贡献点：插件声明 Markdown 落点，宿主执行双向同步
> （ADR-033）。首个 v2 插件是仓库内 `plugins/md-sync`。
> **当前未发布版本** `mdSync` 新增第三种落点 `todos`（待办事项），并把「哪些数据属于哪一天」
> 写成了明确口径（见 §5「落点格式」与「同步语义」）。种类扩展**不升 `apiVersion`**：它不改变
> `bindings` 的 schema，不声明 `todos` 的插件完全不受影响。
> **V0.11.5（apiVersion 3）** 两件事，一件落地一件只落接口：
> 1. **`mdSync` 下架**，Markdown 同步整个搬进内核（默认落点写在 `models/md_sync_config.rs`），
>    仓库内 `plugins/md-sync` 已删除。老插件里写了 `contributes.mdSync` → **忽略并警告**，不拒载（§10.8）。
> 2. **新增 §10「插件 API v3」**：权限模型、`api.commands` / `api.events` / `api.ui` / `api.desktopPet`
>    接口形状、生命周期、`entry: script` 语义预留。**本轮不实现运行时**——现在写 v3 插件得到的是
>    「清单被识别」，不是「代码被跑起来」，边界写在 §10.0。
> 本文是插件作者与宿主实现之间的唯一契约；与代码冲突时以本文为准，并请提 issue。

---

## 1. 一句话模型

**插件 = 一个文件夹 + 一个启动头 `plugin.json`。**

Timing 只**读**这个文件，不执行插件里的任何代码。所以插件不会崩溃、不会拖慢启动、
不可能拿到你的数据——它只能"声明"自己贡献什么，由宿主去落实。

这条边界是刻意划的：v1 的目标是让"我想把摸鱼 25 分钟改成 40 分钟"这种需求，
靠改一个数字就能完成，而不是先装一个运行时。v2 的 `mdSync` 同样只声明落点，
文件读写与冲突判定全部在宿主 Rust 侧完成——插件依旧拿不到数据库或任意文件权限。

> **[v3] 上一段仍然成立：本机不执行插件代码。** 但 v3 的**目标形态**变了——插件将拿到
> 与宿主同等的权限（不做沙箱、不逐条授权），`entry: script` 预留给这条路。因此 v3 起
> `plugin.json` 里的 `permissions` 是**声明性**的（写给人看），不是约束性的（§10.3）；
> 真正限制插件的是「运行时还没实现」这一事实，不是权限表。

---

## 2. 目录布局

```
<插件目录>/
└── moyu-kit/              ← 一个插件 = 一个文件夹（文件夹名随意，不参与识别）
    ├── plugin.json        ← 启动头（必需，文件名固定）
    └── README.md          ← 说明（可选，宿主不读）
```

宿主扫描三个位置，**同 id 先到先得**：

| 优先级 | 来源标记 | 路径 | 说明 |
|---|---|---|---|
| 1 | `dev` | `<仓库根>/plugins` | 仅 `cargo` 调试构建生效 |
| 2 | `exe` | `<Timing.exe 所在目录>/plugins` | 随安装包分发，通常是只读的 |
| 3 | `user` | `%APPDATA%\com.timing.app\plugins` | **你该往这里放插件** |

用户目录不存在时，会在启动后首次读插件列表时自动创建；**它只是一个空目录，宿主不会
预先放任何文件**（V0.3.4 起不再播种示例——插件要你自己放进去，见 ADR-023）。
设置 → 插件 → **打开目录** 可直接跳转（页签名 V0.3.4 起由「扩展」改为「插件」）。

以 `.` 开头的文件夹会被静默跳过（放旧版本备份用，不报错）。

---

## 3. 启动头字段全表

文件名必须是 `plugin.json`，UTF-8 编码（允许 BOM），体积 ≤ 64 KB。

| 字段 | 类型 | 必需 | 默认 | 约束 |
|---|---|---|---|---|
| `id` | string | ✅ | — | 1~48 字符，仅小写字母 / 数字 / `-` / `_`。全局唯一 |
| `name` | string | ✅ | — | 显示名，非空 |
| `version` | string | ✅ | — | 显示用，非空（建议 `1.0.0`） |
| `apiVersion` | number | ✅ | — | `1` / `2` / `3`。`2` 才能声明 `mdSync`（v3 起该贡献点下架）；`4` 及以上拒载，而不是猜语义 |
| `description` | string | ❌ | `""` | 一行说明，显示在设置页 |
| `entry` | string | ❌ | `"manifest"` | 启动方式。宿主目前只接受 `"manifest"` |
| `enabled` | boolean | ❌ | `true` | `false` = 留在盘上但不生效 |
| `contributes` | object | ❌ | `{}` | 贡献点集合，见 §4 |
| `permissions` | string[] | ❌ | `[]` | **[v3] 声明性**能力清单（不是限制），见 §10.3。本机不校验（⬜） |
| `engines` | object | ❌ | `{}` | **[v3]** 兼容声明 `{ "timing": "<semver range>" }`，见 §10.2。本机不校验（⬜） |
| `author` / `homepage` | string | ❌ | `""` | **[v3]** 展示用；`homepage` 必须是 http(s) 链接 |

> **[v3] 上表只列 v3 无争议的增量字段。** 完整字段全表（含类型、必需性、默认值、约束、
> 校验失败文案、本机实现状态）在 **§10.2**，那一份才是 v3 的权威口径。

`entry` 的取值含义：

| 值 | 含义 | 宿主行为 |
|---|---|---|
| `manifest` | 宿主按声明执行，不跑代码 | ✅ 支持 |
| `script` | **[v3]** 跑插件脚本（`<插件目录>/main.js`，语义见 §10.7） | ❌ 仍拒载，提示"entry=script 尚未实现运行时，当前宿主只执行 manifest" |

> 为什么不假装支持 `script`：拒载会明确告诉你"这条路还没通"，
> 而假装支持会让你对着一个"加载成功但什么也没发生"的插件排查半天。
> v3 把 `script` 的目录约定、模块形态、运行时形态**先定下来**（§10.7），
> 但宿主仍然拒载——文档定义接口，不等于代码能跑。

---

## 4. 贡献点 `quickTimers`

> **[V0.3.9] 当前不驱动摸鱼菜单。** 用户口径：常用摸鱼是**应用内置功能，不是插件**
> （见 ADR-026）。摸鱼菜单现在只读 `Settings.moyuPresets`（可在菜单里增删改 + 排序）；
> 本贡献点仍会被宿主解析、也会在 设置 → 插件 的「贡献项」里展示，但不再注入菜单。
> 字段与校验规则保持有效，后续若要接回，需要先定义「内置 vs 插件」的展示边界。

v1 贡献点（v2 继续支持）：声明若干「事项名 + 分钟数」的快捷计时（当前不注入菜单，见上方说明）。

```json
"contributes": {
  "quickTimers": [
    { "item": "上厕所", "minutes": 10 },
    { "item": "摸鱼",   "minutes": 25 },
    { "item": "吃饭",   "minutes": 60 }
  ]
}
```

| 字段 | 类型 | 约束 |
|---|---|---|
| `item` | string | 不能为空。菜单显示名 = 事项名 |
| `minutes` | number | 整数，`1 ~ 1440` |

单插件最多 **12 条**。

### 点下去会发生什么

> 以下行为描述的是「贡献点接回菜单后」的语义；V0.3.9 起菜单不消费 `quickTimers`，
> 这段留作接回时的实现依据。

1. 按 `item` 精确匹配（去首尾空格）现有事项；**没有就自动新建一条同名事项**。
2. 开始一个该时长的倒计时会话，计时记在这个事项名下。
3. 如果当前已有会话（计时中或暂停中）：先**结束并保存**当前这段（撤销条仍可用），
   再开始新的。

### 同名覆盖

多个插件声明同一个 `item` 时，**后加载的赢**（`内置预设 < dev < exe < user`，
同来源内按 id 字典序），位置保持首次出现的那一行。所以"把摸鱼改成 40 分钟"只需要：

```json
{ "id": "my-moyu", "name": "我的摸鱼", "version": "1.0.0", "apiVersion": 1,
  "contributes": { "quickTimers": [ { "item": "摸鱼", "minutes": 40 } ] } }
```

---

## 5. 贡献点 `mdSync`（v2 起 · **v3 下架**）

> **[v3] 本节已作废，仅作 v2 历史规格保留。**
> - apiVersion 3 起 `contributes.mdSync` **不再被采用**：宿主忽略它，并在 设置 → 插件 该行
>   给出黄字警告，插件其余部分照常生效（不拒载，理由见 §10.8）。
> - Markdown 同步整个搬进内核：默认落点写在 `models/md_sync_config.rs`，用户覆盖值仍在
>   `settings` KV `plugin.md-sync.config`（键名不改，理由见 §5 末尾「配置键」）。
> - 仓库内 `plugins/md-sync` 已删除；`quickTimers` 不受影响，v1/v2 插件继续有效。
> - 下面这些字段约束**只在 v2 宿主上成立**，v3 宿主不再校验它们。

声明「应用数据 → Markdown 落点」的映射。宿主按下表把计时记录 / 便利贴 / 待办事项写进
指定标题下，并在文件被改动时把差异写回 SQL；插件本身不接触文件。

```json
{
  "apiVersion": 2,
  "contributes": {
    "mdSync": {
      "bindings": [
        {
          "kind": "timers",
          "enabled": true,
          "root": "%USERPROFILE%\\OneDrive\\应用\\remotely-save\\Elio\\1-MemeX\\Diary",
          "file": "{date}.md",
          "heading": "#### 事项计时"
        },
        {
          "kind": "notes",
          "enabled": true,
          "root": "%USERPROFILE%\\OneDrive\\应用\\remotely-save\\Elio\\1-MemeX\\Diary",
          "file": "{date}.md",
          "heading": "#### 便利贴"
        },
        {
          "kind": "todos",
          "enabled": true,
          "root": "%USERPROFILE%\\OneDrive\\应用\\remotely-save\\Elio\\1-MemeX\\Diary",
          "file": "{date}.md",
          "heading": "#### 待办事项"
        }
      ]
    }
  }
}
```

| 字段 | 类型 | 必需 | 约束 |
|---|---|---|---|
| `kind` | string | ✅ | `"timers"`（事项计时）/ `"notes"`（便利贴）/ `"todos"`（待办事项）。**每个 kind 最多一个落点** |
| `enabled` | boolean | ❌ | 默认 `true`；`false` 只保留配置，不读写 |
| `root` | string | ✅ | 根目录，1~512 字符。支持 `%VAR%` 与开头的 `~`；展开后必须仍是绝对路径（否则整轮跳过该落点） |
| `file` | string | ✅ | 相对文件模板，1~260 字符。禁止绝对路径与 `..`。支持 `{date}` / `{yyyy}` / `{MM}` / `{dd}` |
| `heading` | string | ✅ | 目标标题行（`#`~`######` + 空格 + 标题文字），1~120 字符。例如 `#### 事项计时` |

`bindings` 最多 8 条，但同一 `kind` 只能一条（设置页按 kind 找状态）。没有
`contributes.mdSync` 的插件不受影响；写了 `mdSync` 但 `apiVersion: 1` 会被拒载。

**升级行为**：保存过的配置以用户为准（总开关、根目录、文件模板、标题，以及主动
`enabled: false` 的落点都不会被插件默认值覆盖），但保存值里**完全没有的 kind** 会用
插件默认值补齐。所以插件新增一种落点后，老用户不必删配置重来——它会在下一轮同步时
自动出现。这条是必需的：设置页没有「添加落点」入口。

> **[v3] 这段语义原样保留，只是默认值的来源从「插件」换成「内核」。** 判据不变：
> 合并只按 `kind` 匹配，**不看 `enabled`**——用户主动禁用的落点仍在保存值里（禁用只写
> `enabled: false`、不删条目），所以不会被默认值"复活"。内置默认值固定三档
> （`timers` / `notes` / `todos`），见 §5 末尾「配置键」。

### 落点格式

计时区块沿用 Obsidian Planner 的 YAML log（与用户往日日记一致）：

````markdown
#### 事项计时

- [ ] 写方案
  ```yaml
  planner:
    log:
      - start: 2026-10-20 09:00:00
        end: 2026-10-20 09:30:00
        duration: 30m
  ```
````

**正在计时**的记录也会出现在区块里，用「开始时刻 → 当前时刻」表示，并多一行
`ongoing: true`（合法 YAML，Planner 忽略未知键）：

````markdown
- [ ] 写方案
  ```yaml
  planner:
    log:
      - start: 2026-10-20 09:00:00
        end: 2026-10-20 09:30:00
        duration: 30m
      - start: 2026-10-20 10:15:00
        end: 2026-10-20 10:21:00
        duration: 6m
        ongoing: true
  ```
````

`ongoing: true` 是**宿主写出的实时段标记**（当前未发布版本起）。这段的 `end` 只是
「渲染那一刻」的近似值（对齐到整分钟），不是数据库事实，所以：

- **宿主自己写出的那一段**（基线里有、或它正是库里当前计时的会话）导入时一律忽略——
  你改它的 `end` 不会写回数据库；真正停止后由同一段的已保存记录接管，不重复出现。
- **不是宿主写出的** `ongoing: true`（例如你自己复制/手写一行、或给老段落补了这个键）
  会被当成普通数据：时间照常入库，**不会因为标记而丢掉任何记录**。

暂停中的会话用「已计到的位置」（开始时刻 + 累计时长）作为 `end`，冻结不动。会话开始
不足 1 分钟时先不上屏（否则只能写「未来时刻」或零长度段），最长延迟 59 秒。

#### 墙钟跨度 ≠ 真实时长（`duration:`）

`start` / `end` 是**墙钟时刻**，`duration:` 是这段**真正计到的时长**（数据库
`accumulated_sec`）。两者会分叉：应用关闭、电脑休眠期间 Timing 不累计（崩溃恢复明确
「不补算停机间隙」）。所以下面这段的墙钟跨度是 5 小时 22 分，实际只计到 46 分钟：

````markdown
- [ ] 测试2
  ```yaml
  planner:
    log:
      - start: 2026-10-20 09:18:33
        end: 2026-10-20 14:40:48
        duration: 46m06s
  ```
````

**读这段时以 `duration` 为准。** 它按 `1h34m20s` / `46m06s` / `45s` 的形态书写，
不足 1 分钟写 `45s`；解析也认纯数字（按秒）和大小写混写。

`duration` 是**派生展示值**，不是数据源：

- Planner 会忽略这一行（未知键），它的时间线视图仍按 `start`/`end` 画；
- 你改它**不会**影响任何记录——宿主导入时一律先剥掉再比对；改这一行不触发任何写入；
- 落库的累计仍由 `(start, end)` 反推（既有语义），所以改 `end` 才是改时长；
- 下一轮同步会按数据库的真实值把它重写回去。
- 实时段的 `duration` 与 `end` 同粒度（对齐到整分钟），同样只导出不导入。

便利贴区块是三列表格，行尾隐藏 id：

```markdown
#### 便利贴

| 更新时间 | 事项 | 内容 |
|---|---|---|
| 2026-10-20 09:30:00 | 生活 | 买牛奶 <!-- tb-note:3 --> |
```

#### 待办事项

待办区块是清单项，行尾隐藏 id（Obsidian 预览视图里不显示）。`· 计划 <时间>` 是**计划
时间的唯一事实来源**，改它就等于改数据库里的 `planned_at`：

```markdown
#### 待办事项

- [ ] 写季度总结 · 计划 2026-10-21 09:00 <!-- tb-todo:12 -->
- [ ] 整理下载目录 <!-- tb-todo:15 -->
- [ ] 交周报 · 逾期 2026-10-18 14:00 <!-- tb-todo:9 -->
```

三种后缀的含义：

| 写法 | 含义 |
|---|---|
| `· 计划 <时间>` | `planned_at` 在**今天之后** |
| `· 逾期 <时间>` | `planned_at` 早于今天 0 点，还没做 |
| 无后缀 | 未排期（`planned_at IS NULL`） |

时间是 `YYYY-MM-DD HH:MM`。手写时可以省年份（`10-21` 或 `10-21 09:00`），按当前年份补；
补出来比今天早半年以上会当成明年。解析不出来时（比如写 `· 计划 下周`）整段当标题，
不会被误剥。

**区块里只有「未完成、且计划时间不在今天」的待办**：今天要执行的事属于当天日程，
你应该在计时区块里体现它的结果；已完成的待办勾完就从这里退场。

**两条容易被当成 bug 的行为，先说清**：

- 你把某条待办的计划时间改成**今天**（或者它自己走到了今天），它就从这个区块里消失——
  不是被删了，是口径决定的「今天的事不在这儿」。库里的记录没动。
- 判断「今天」用的是**本机时区**的 00:00–24:00，文件里不带时区。跨时区旅行时，
  同一个 `planned_at` 可能在你落地后落进或落出今天；日记跟着本机时区走。

带 `<!-- tb-todo:N -->` 的行按 id 对上数据库里那条；没有 id 的行是你在 Obsidian 里新写的，
导入时新建待办。**这个区块从不删数据**——它是过滤视图，「文件里没有」可能只是计划时间
落进了今天，或刚被勾完。要删待办请回 Timing 的待办窗口。

### 同步语义（宿主实现）

- 轮询间隔约 2 秒；只替换目标标题下的区块，标题前后的日记正文不动。
- 文件被改 → 解析后写回 SQL；SQL 被改 → 下一轮写入文件。**进行中**的计时也会写进区块
  （「开始时刻 → 当前时刻」），但它的 `end` 只精确到整分钟：秒级刷新会让每 2 秒重写
  整篇日记（Obsidian 不停重载、OneDrive 反复上传），整分钟后肉眼仍是实时、写盘只在
  真正变化时发生。会话开始不足 1 分钟时不上屏（避免写出未来时刻或零长度段），
  最长延迟 59 秒。
- `ongoing: true` 的判定见上一节：宿主写出的实时段只导出不导入（它的 `end` 是渲染近似值，
  写回库会改写真实时长）；用户手写的标记当普通数据照常入库，不会连带删掉记录。
- `duration:` 是**纯展示**的派生值：导入时先整段剥掉再比对，所以改它不触发任何写入；
  落库的 `accumulated_sec` 仍由 `(start, end)` 反推（既有语义）。导出时每段都会写，
  实时段按整分钟粒度，不会破坏「同一分钟内不写盘」。
- 两边同时改 → 按「文件 mtime vs 已保存记录最大 `updated_at`」最后写入者胜。运行中的
  记录不参与这个 `updated_at`（它每 15s 被落盘任务推进），否则冲突会永远判给数据库侧。
  **边界如实说明**：你「点停止」的那一刻会当场产生一条 `updated_at = now` 的已保存记录，
  所以「刚停止的 ≤2 秒内又改了文件」这一小段窗口里，最后写入者会被判成数据库侧、你刚写
  的内容会被一次导出覆盖（上限约一个轮询周期）。除此之外用户编辑都判给文件侧。
- 目标文件 / 标题不存在 → **只导出，不导入**（绝不把「空」当成用户删光数据）。
- 计时区块的对位：先按**开始时刻精确匹配**库里同事项的记录，没配上的再按顺序兜底
  （所以你改了某段的 `start` 也能更新到原来那条上，不会变成「新增一条 + 留下孤儿」）。
- 计时区块的删除是**三条件并列，缺一不可**：①该 `(事项, 开始时刻)` **在基线里出现过**；
  ②现在文件里**没有**这个开始时刻；③本轮它**没有被文件里的任何一段认领**
  （被认领说明这行刚按新值更新过，它的旧 `started_at` 已不代表现状）。
  删掉整组 = 该事项出现过的开始时刻全都没了；从没被宿主导出过的记录（例如刚停止、
  还没轮到下一轮导出）不会被文件侧删掉。
- 便利贴有 id 的行更新、无 id 的行新建、id 消失的行软删除。
- 便利贴按 **「当天相关」** 归日：只写当天创建、或当天改过的便利贴。昨天贴的便条不会跟到
  今天的日记里（它属于昨天那篇）。把 `file` 写成不带 `{date}` 的固定文件时，跨天会看到
  区块变成当天的内容——那是过滤结果，不是数据丢失（旧记录仍在库里）。
- 待办区块只写「**未完成** + **计划时间不在今天**」的待办；逾期的与未排期的照常列出。
  已完成的不列出，所以勾掉一条它下一轮就退场。
- 待办的导入规则三条：`- [x]` 回写 `done_at`；改标题或 `· 计划 <时间>` 回写 `title` /
  `planned_at`；没有 id 的行新建待办。**一行都不删**——这一节是过滤视图，「文件里没有」
  可能只是计划时间落进了今天。删待办请在 Timing 的待办窗口里做。
- 计时按 `started_at` 归日：昨天 23:00 开始、现在仍在跑的会话属于昨天的文件，今天的
  区块不会画它（已知限制，取舍见 `services/md_sync/export.rs` 模块注释）。

改完 `plugin.json` 后到 **设置 → 插件** 点「重新加载」，再到 **设置 → 同步** 确认落点并保存。

### 配置键（v3 起归内核）

| 项 | 结论 |
|---|---|
| 默认落点来源 | `src-tauri/src/models/md_sync_config.rs::default_bindings()`，三档固定：`timers` / `notes` / `todos` |
| 三档默认值 | `root` = `%APP_DIR%\md`（V0.11.6 起；落点是数据目录下的 `md\`，桌面版即 `<exe>\data\md`）；`file` = `{date}.md`；`heading` = `#### <kind.label()>`（即 `#### 事项计时` / `#### 便利贴` / `#### 待办事项`）；三档 `enabled` 均为 `true` |
| 总开关出厂值 | **`enabled: false`**（默认关）。判据：首次运行不发生任何文件 IO——`tick` 的第一道闸就是 `enabled`，不建目录、不写 md。插件时代默认开是因为"装了插件"本身是一次明确动作；内核化以后新装用户什么都没做，默认开等于替所有用户决定往 `文档` 里写文件 |
| 老用户 | 保存值里有 `enabled: true` → 保持开。只有**从没有保存值**的（新装 / 从没用过同步）才拿到 `false` |
| `settings` 键 | 仍是 `plugin.md-sync.config`，**不改名**。它带 `plugin` 前缀是 V0.4.0 的历史原因；改名收益是"好看"，代价是必须双读旧键做迁移，而漏掉一步就会把用户配好的 OneDrive 路径整体覆盖成内置默认值——用真实数据丢失风险换零收益，不做 |

---

## 6. 内置预设

摸鱼菜单自带三条预设，**它们是应用的内置功能，不是插件**：没有 `plugin.json`、
不在插件扫描范围内、不出现在设置 → 插件的插件列表里，也无目录可打开。

**[V0.3.9]** 它们现在是 `Settings.moyuPresets` 的**出厂值**（settings KV `moyu.presets`）：
在摸鱼菜单 →「管理常用摸鱼…」里可以改名 / 改时长 / 改正计时或倒计时 / 排序 / 删除，
也可以新增任意条目（上限 20 条）。老库没有这个键、或 JSON 损坏时才回落到下面三条；
**把条目删光是合法状态**，菜单会显示「还没有条目」而不是把三条塞回来（ADR-026）。

| item | minutes | mode |
|---|---|---|
| 上厕所 | 10 | countdown |
| 摸鱼 | 25 | countdown |
| 吃饭 | 60 | countdown |

---

## 7. 出错时你会看到什么

载入失败的插件**不会**从列表里消失，而是标红并在行内写明原因：

| 现象 | 提示 |
|---|---|
| 文件夹里没有 `plugin.json` | 缺少启动头 plugin.json |
| JSON 语法错 | 启动头 JSON 不合法：`<serde 原文>` |
| `id` 大写或含空格 | id 只能用小写字母、数字、- 和 _ |
| `apiVersion: 4` 或更高 | apiVersion 必须为 1..=3（本机宿主版本更低） |
| `entry: "script"` | entry=script 尚未实现运行时，当前宿主只执行 manifest |
| `minutes: 0` 或 `1500` | quickTimers.minutes 必须为 1..=1440 |
| `quickTimers` 超过 12 条 | quickTimers 最多 12 条 |
| 声明了 `contributes.mdSync` | contributes.mdSync 已在 apiVersion 3 下架：Markdown 同步已归内核，本段被忽略；同步请在「设置 → 同步」里配置 |

> 最后一行为警告，插件仍生效（其余各行为载入失败）。

> **[v3] 上面这张表少了三行 v2 时代的 `mdSync` 校验**（`file` 是绝对路径 / `heading` 没有
> `#` / 同一 `kind` 两个落点）：v3 起宿主**完全不校验** `contributes.mdSync`（§5 已下架），
> 所以这三种错误不会再出现。它们对应的拦截逻辑已随 `infra/plugin_fs.rs` 的 mdSync 分支一起删除。

改完文件后在 **设置 → 插件** 点「重新加载」，无需重启程序。

---

## 8. 完整示例

自己在插件目录里新建一个文件夹（示例里叫 `moyu-kit`，名字随意），把下面的内容存成
其中的 `plugin.json`，回到 设置 → 插件 点「重新加载」：

```json
{
  "id": "moyu-kit",
  "name": "摸鱼套装",
  "version": "1.0.0",
  "apiVersion": 1,
  "description": "三条最常用的短时倒计时：上厕所 / 摸鱼 / 吃饭。改 minutes 即可调整时长。",
  "entry": "manifest",
  "enabled": true,
  "contributes": {
    "quickTimers": [
      { "item": "上厕所", "minutes": 10 },
      { "item": "摸鱼", "minutes": 25 },
      { "item": "吃饭", "minutes": 60 }
    ]
  }
}
```

---

## 9. 边界（明确不做的事）

> **[v3] 本节描述的是 v1/v2 的边界。** 下面三行在 v3 里被**重新划线**（不再做沙箱、
> 允许插件 UI），v3 当前真实的「不做清单」在 **§10.9**——以那一节为准。

| 不做 | 原因 |
|---|---|
| 执行插件 JS / 脚本 | 需要沙箱与权限模型，v2 仍不做半成品 |
| 插件读写数据库 / 任意文件 | 数据访问一律走 `commands → services → repositories`（ADR-015）；文件只由宿主按声明落点读写 |
| 插件自定义 UI | 同上：先有稳定的贡献点，再谈 UI 扩展 |
| 插件热重载（文件监听） | 「重新加载」按钮已足够，且语义明确 |

加新贡献点必须同时升 `apiVersion`，并在本文件补一节。

---

## 10. 插件 API v3（V0.11.5 · 接口定义）

### 10.0 一句话：现在写 v3 插件会得到什么

> **v3 把插件从「声明式配置包」升级成「全权限代码包」。本轮只定义接口，不实现运行时。**
> 宿主已认得 `apiVersion: 3`、已下架 `mdSync`（§5），但**不加载、不执行**任何插件脚本。

| 你在 `plugin.json` 里写 | 现在（V0.11.5）会发生什么 |
|---|---|
| `apiVersion: 1` + `quickTimers` | 解析成功，展示在 设置 → 插件 的「贡献项」里，**仍不进摸鱼菜单**（ADR-026） |
| `apiVersion: 2` + `contributes.mdSync` | 忽略 + 黄字警告，插件仍生效（文案见 §10.8） |
| `apiVersion: 3` + `permissions` / `engines` / `author` / `homepage` | 清单被识别、插件列进列表；**这几个字段本轮既不校验也不展示**（⬜） |
| `entry: "script"` + `main.js` | **拒载**，红字提示「entry=script 尚未实现运行时」 |
| 任何 `api.*` / `api.desktopPet` 调用 | 不可能发生——没有运行时，代码根本没被执行 |
| `apiVersion: 4` | **拒载**（`apiVersion 必须为 1..=3`） |

### 10.1 状态列（唯一判据，别靠语气判断）

| 标记 | 含义 |
|---|---|
| ✅ | 本轮（V0.11.5）已在本机代码里生效 |
| ⬜ | 只在本文定义，本机**未实现**——写了不报错，也不会有任何效果 |

> **[v3] ⬜ 的一个前提：字段名与类型必须写对。** 写错（例如 `permissions` 写成字符串、
> `author` 写成数字）按「启动头 JSON 不合法」**拒载**，整个插件不生效；写对了则既不校验
> 也不展示。不加这条限定，⬜ 会被读成「字段可以乱写」，而实际是「写对了也没用」。

> 本轮真正标 ✅ 的 v3 项只有两处：**`apiVersion` 上限升到 3**、**`contributes.mdSync` 忽略 + 警告**。
> 其余（权限、engines、依赖、UI、桌宠、生命周期、脚本运行时）全部 ⬜。
> 这条写在前面，是为了让作者一眼看出「哪些承诺现在能兑现」。

### 10.2 启动头字段全表（apiVersion 3）

| 字段 | 类型 | 必需 | 默认 | 状态 | 约束 | 校验失败时的文案 |
|---|---|---|---|---|---|---|
| `id` | string | ✅ | — | ✅ | 1~48 字符，仅 `[a-z0-9_-]`；全局唯一（同 id 先到先得，`dev > exe > user`） | `id 只能用小写字母、数字、- 和 _` |
| `name` | string | ✅ | — | ✅ | 非空（无长度校验） | `name 不能为空` |
| `version` | string | ✅ | — | ✅ | 非空，建议 `1.0.0` | `version 不能为空` |
| `apiVersion` | number | ✅ | — | ✅ | `1` / `2` / `3` | `apiVersion 必须为 1..=3（本机宿主版本更低）` |
| `description` | string | ❌ | `""` | ✅ | 无长度校验，设置页只显示一行 | — |
| `author` | string | ❌ | `""` | ⬜ | ≤64 字符 | `author 最多 64 个字符` |
| `homepage` | string | ❌ | `""` | ⬜ | `http://` / `https://` 开头，≤256 字符 | `homepage 必须是 http(s) 链接` |
| `entry` | string | ❌ | `"manifest"` | ✅ | `manifest` / `script`；`script` 拒载（§10.7） | `entry=script 尚未实现运行时，当前宿主只执行 manifest` |
| `enabled` | boolean | ❌ | `true` | ✅ | `false` = 留在盘上但不生效 | — |
| `engines` | object | ❌ | `{}` | ⬜ | `{ "timing": "<semver range>" }`；不满足 → **拒载** | `engines.timing 要求 <range>，当前宿主 <ver> 不满足` |
| `permissions` | string[] | ❌ | `[]` | ⬜ | 见 §10.3；未知能力 → 警告，不拒载 | （警告）`permissions 里有未知能力：<name>` |
| `dependencies` | object | ❌ | `{}` | ⬜ | `{ "<plugin-id>": "<semver range>" }`；不满足 → **拒载** | `依赖 <id> 未被识别 / 版本 <v> 不满足 <range>` |
| `contributes` | object | ❌ | `{}` | ✅ | `quickTimers`（§4）保留；`mdSync`（§5）**已下架** → 忽略 + 警告 | — |

**未知字段的处置**：一律忽略，不报错。与 v1/v2 一致——向前兼容靠这条，不靠白名单。

`engines` / `dependencies` 失败为什么是**拒载**而不是警告：这两个字段是作者在说
「我需要 X 才能正确工作」。宿主拿低版本去解释它的清单，就是在**猜语义**——而「不认识就
拒载，不猜」是本文从 §3 起就定下的口径（见 §3 的 `entry` 说明）。声明性字段
（`permissions` / `author`）写错顶多显示不准，所以给警告。

### 10.3 权限模型：**声明性**，不是约束性

| 问题 | 结论 |
|---|---|
| `permissions` 是约束性还是声明性 | **纯声明性。宿主不据此拒绝任何调用** |
| 未知能力名 | 警告（`permissions 里有未知能力：<name>`），**不拒载** |
| 声明与实际调用不符 | 本轮不检测（⬜）；运行时落地后**必做**，口径见本节末尾 |
| 设置页展示 | 展示 `permissions` 的中文说明，**固定带一行灰字**：「声明，不是限制：插件与 Timing 同权限」 |

**为什么是声明性**（三条，每条可核）：

1. **约束性权限要求宿主在调用点上拦截。** 已拍板「插件即全权限、不做沙箱、不逐条授权」
   → 根本没有拦截点。此时把 `permissions` 写成约束性，等于给用户一个**假的安全感**：
   界面写着「此插件只能读取待办」，实际它什么都能干。这比不写更坏。
2. **声明性仍然有用**：它唯一的产出是**可见性**——设置 → 插件 里把 `permissions` 翻译成
   人话，用户在装之前能看到"它打算干什么"。这是 Obsidian 那套里「看得见」的部分，我们照搬；
   「拦得住」那部分我们不做，也不假装做。
3. **必须写清「声明 ≠ 限制」**：否则用户会把声明当沙箱，而一旦误装，损失是不可逆的
   （插件与宿主同权限，能读写数据库、能改设置、能开窗口）。

**能力名表**（`<域>.<动词>`，全小写，动词只有 `read` / `write` / `open` / `subscribe`）：

| 能力名 | 含义 | 对应 |
|---|---|---|
| `timer.read` | 读当前计时状态 | `api.commands.timer.getState` |
| `timer.write` | 开始 / 暂停 / 恢复 / 停止 / 切换 / 撤销 | `api.commands.timer` 其余方法 |
| `item.read` / `item.write` | 读 / 增改事项 | `api.commands.item` |
| `todo.read` / `todo.write` | 读 / 增改删待办 | `api.commands.todo` |
| `note.read` / `note.write` | 读 / 增改便利贴 | `api.commands.note` |
| `record.read` | 读历史记录与统计 | `api.commands.record` |
| `settings.read` / `settings.write` | 读 / 改设置 | `api.commands.settings` |
| `mdSync.read` / `mdSync.write` | 读配置 / 触发同步 | `api.commands.mdSync` |
| `window.open` | 打开宿主窗口 | `api.commands.window` |
| `theme.read` / `theme.write` | 读 / 改主题与强调色 | `api.commands.theme` |
| `ui.settingsCard` / `ui.panel` / `ui.menu` / `ui.tray` | 挂 UI（§10.4.3） | `api.ui` |
| `event.subscribe` | 订阅宿主事件（§10.4.2） | `api.events` |
| `desktopPet` | 创建 / 操纵桌宠（§10.4.4） | `api.desktopPet` |
| `notify` | 发系统通知 | `infra::notify` |

**「声明与实际调用是否相符」的检测口径**（⬜，运行时落地后必做）：

1. 宿主每次经 `api.*` 的调用记一条 `(pluginId, capability, at)` 到内存环形缓冲；
2. 在 `onDisable` / `onUnload` 时与 `permissions` 求差集；
3. 多用了的能力 → 设置页该插件行加一条警告「实际调用了未声明能力：`item.write`」，
   **不阻断、不追溯、不禁用**（插件即全权限，声明只是描述）；
4. 少用的不提示——声明多了不构成问题。

### 10.4 API 面（接口形状，全部 ⬜）

> **架构前提（最重要的一条）：插件 API 不是新通道。**
> 所有 `api.commands.*` 都是既有 67 条 IPC 命令（`generate_handler!`）的**白名单投影**。
> 插件不直连数据库、不直连 `repositories`；调用路径仍是
> `插件 → api → commands → services → repositories`（ADR-015 不破）。
> 因此 v3 **不新增命令、不新增事件、不新增错误码**，插件拿到的错误就是现有那 16 个码。

#### 10.4.1 `api.commands` — 按域分组（白名单）

**开放清单**（参数沿用对应命令的现有签名，见 `docs/phase2/IPC-CONTRACT-v2.md`）：

| 域 | 方法 | 映射命令 |
|---|---|---|
| `timer` | `getState` / `start` / `startCountdown` / `pause` / `resume` / `stop` / `discard` / `undoStop` / `switch` | `get_timer_state` / `start_timer` / `start_countdown` / `pause_timer` / `resume_timer` / `stop_timer` / `discard_timer` / `undo_stop` / `switch_item` |
| `item` | `list` / `create` / `update` / `archive` / `unarchive` | `list_items` / `create_item` / `update_item` / `archive_item` / `unarchive_item` |
| `todo` | `list` / `create` / `update` / `delete` / `toggle` / `start` | `todo_list` / `todo_create` / `todo_update` / `todo_delete` / `todo_toggle` / `todo_start` |
| `note` | `list` / `get` / `create` / `update` | `note_list` / `note_get` / `note_create` / `note_update` |
| `record` | `list` / `stats` | `list_records` / `stats_summary` |
| `settings` | `get` / `update` | `get_settings` / `update_settings` |
| `mdSync` | `get` / `save` / `run` / `open` | `md_sync_get` / `md_sync_save` / `md_sync_run` / `md_sync_open` |
| `window` | `openSettings` / `openTodos` / `openTimer` / `openNote` / `closeNote` | `open_settings_window` / `open_todos_window` / `open_timer_window` / `open_note_window` / `close_note_window` |
| `theme` | `get` / `set` / `accentGet` / `accentSet` | `theme_get` / `theme_set` / `accent_get` / `accent_set` |
| `reminder` | `set` / `clear` / `pending` | `reminder_set` / `reminder_clear` / `reminder_pending` |
| `dailyStatus` | `get` / `set` | `daily_status_get` / `daily_status_set` |

**未列出的命令一律不开放。** 四类明确不给，理由统一：**它们不是"能力"，是宿主对自己的处置权
或用户不可逆的数据**：

| 不开放 | 命令 | 理由 |
|---|---|---|
| 插件自指 | `plugin_list` / `plugin_open_dir` | 插件能列/能处置自己，故障表现是「插件把自己弄没了」，用户无法归因到具体插件 |
| 一次性数据迁移 | `get_migration_info` / `open_legacy_dir` | 动的是用户数据目录；误调一次就可能搬走或暴露整个库 |
| 宿主生命周期与主条可见性 | `quit_app` / `set_autostart` / `show_window` / `hide_window` / `toggle_window` / `save_window_position` / `main_window_rect` / `main_work_area` | 主条是宿主唯一的常驻界面，被藏起来后用户只能杀进程；应用自退 / 开机项被改，用户看到的是「Timing 自己出问题」 |
| 不可逆删除与历史改写 | `delete_item` / `delete_record` / `update_record` / `note_delete` | 都没有撤销入口；这是**数据不可逆**问题，不是权限问题。需要时按名字单独评审开放（在此表加一行 + 升 `apiVersion`） |

#### 10.4.2 `api.events` — 订阅（11 个全开放）

允许订阅**全部**宿主事件（订阅是只读的，`emit` 侧仍在宿主）：

| 事件名 | 载荷 | 触发时机 |
|---|---|---|
| `timer:state-changed` | `TimerState` | 计时状态迁移（含托盘重建） |
| `theme-changed` | 主题 + 四色 | 主题 / 强调色变更 |
| `countdown-finished` | `CountdownFinished` | 倒计时到点 |
| `reminder-fired` | `Reminder` | 提醒命中 |
| `todo-nudge` | `TodoNudge` | 待办两级提醒（T-15 / T-5） |
| `note-window-opened` | `{ noteId }` | 便利贴窗口创建 / 显示 |
| `note-window-closed` | `{ noteId }` | 便利贴窗口销毁 |
| `app:open-new-note` | — | 托盘「便利贴…」要求新建 |
| `app:open-new-item` | — | 托盘「新建事项…」要求内联命名 |
| `tray:highlight` | — | 托盘图标双击（主条闪一下） |
| `md-sync:changed` | `MdSyncReport` | 内核同步把文件改动写回 SQL 后 |

**插件能自定义全局事件吗？不能。** 判据可核：事件名是**全局广播**名字空间，而
`scripts/check-contract.mjs` 要求「后端 `app/events.rs` 常量 ↔ 前端 `IPC_EVENTS` ↔ 真实 `emit` 点」
三方一致，且**每个前端声明都必须有 emit 来源**（死常量直接红）。插件自定义的事件名永远
没有 emit 点——要么让门禁变红，要么被迫开 `EVENT_ALLOWLIST` 白名单，而白名单一旦出现，
这条保护就等于失效。插件需要的"回调"走 `api.ui` 的 `onUiEvent` 与 Promise 返回值，不新增全局事件名。

#### 10.4.3 `api.ui` — 四个挂载点：宿主渲染声明，不是 HTML

| 挂载点 | 声明方式 | 宿主渲染位置 | 谁能看到 |
|---|---|---|---|
| 设置页卡片 | `ui.settingsCard` | 设置 → 插件 → 该插件行下方的「面板」区 | 打开设置窗口的人 |
| 独立面板 | `ui.panel` | 设置 → 插件 →「打开面板」弹出的宿主窗口（label `plugin-{id}`） | 同上 |
| 主条菜单项 | `ui.menu` | 主条右键菜单，排在内置条目之后，分组标题 = 插件 `name` | 所有人 |
| 托盘项 | `ui.tray` | 托盘菜单的「插件」子菜单；**最多 5 项**，超出的按 id 字典序丢弃并记警告 | 所有人 |

**渲染口径**（本节的核心约束）：

| 规则 | 结论 |
|---|---|
| 插件给什么 | **声明式节点树**（下表 `UiNode`）。不给 HTML、不给 CSS、不给 React 组件 |
| 为什么 | 主仓是手写 CSS + `var(--*)` 设计令牌，**禁裸 hex / rgb**（AGENTS.md 硬约束）。插件若给 HTML/CSS：① 打破令牌规则且**门禁拦不住**（`check:size` / `check:layers` 只扫 `src/`）② 引入 XSS（WebView 里插件 HTML 与宿主同源）③ 深浅主题切换立刻失效 |
| 宿主怎么渲染 | 逐个 `type` 映射到 `src/components/ui/*` 已有组件（`Switch` / `btn` / `num-field`），视觉全部来自设计令牌 |
| 插件能定制什么 | 只有 `tone`（`default` / `muted` / `warn`）与 `variant`（`primary` / `ghost`）两个**语义枚举**。没有颜色、没有像素、没有类名 |
| 深浅主题 | 自动跟随 `data-theme`，插件既不需要也不能感知 |
| 状态存放 | 宿主**不保存**插件 UI 状态。每次渲染由插件现算，重启后重新渲染 |

`UiNode` 形状：

| `type` | 必需字段 | 可选字段 | 渲染为 |
|---|---|---|---|
| `text` | `text` | `tone` | 一行正文 |
| `row` | `label`、`value` | — | 「标签 … 值」一行（值右对齐） |
| `switch` | `id`、`label`、`checked` | — | `Switch` |
| `number` | `id`、`label`、`value` | `min`、`max`、`unit` | `num-field` |
| `textField` | `id`、`label`、`value` | `placeholder` | 单行输入 |
| `button` | `id`、`label` | `variant` | 按钮 |
| `divider` | — | — | 分隔线 |
| `list` | `items: UiNode[]` | — | 纵向排列 |

交互回传：用户改控件 → 宿主调用插件的 `onUiEvent(nodeId, value)`（§10.6），插件返回新的节点树。

#### 10.4.4 `api.desktopPet` — 桌宠（只定义形状，**未实现**）

| 方法 | 参数 | 返回 | 约束 |
|---|---|---|---|
| `create` | `{ id: string; size?: number; sprite?: string }` | `Promise<PetHandle>` | `sprite` 是**插件目录内的相对路径**（png / svg），宿主读文件并渲染；`size` 单位 DIP，32~256，缺省 96 |
| `move` | `(handle, { x: number; y: number })` | `Promise<void>` | 逻辑坐标（DIP），相对主屏左上角 |
| `say` | `(handle, { text: string; durationMs?: number })` | `Promise<void>` | 气泡；`text` ≤120 字符，`durationMs` 500~10000，缺省 3000 |
| `setState` | `(handle, { state: 'idle' \| 'busy' \| 'alert' })` | `Promise<void>` | 三个状态由宿主决定动画，插件**不能**自定义动画 |
| `remove` | `(handle)` | `Promise<void>` | 插件卸载时宿主自动兜底调用 |

- `PetHandle` 是不透明字符串，跨插件不可复用。
- 同一时刻最多 **3 只**桌宠。
- 桌宠窗口透明、置顶、不可聚焦、不进任务栏（与主条的 `infra::window` 同一套口径）。
- **未实现期间不新增错误码**：没有运行时，这些调用不可能发生。运行时落地后若确需新码，
  走契约评审（union / `errorText()` / 契约文档 §2 三处同步）。

### 10.5 生命周期（⬜）

| 钩子 | 触发时机 | 次数 | 顺序保证 |
|---|---|---|---|
| `onLoad` | 清单校验通过且 `enabled: true` 后；进程启动一轮、每次「重新加载」一轮 | 每次加载 1 次 | 全局按来源优先级（`dev → exe → user`）+ id 字典序，**串行**（一次只跑一个插件） |
| `onEnable` | ①`enabled` 由 `false → true`（下一轮重新加载生效）；②首次加载时紧跟在同一插件的 `onLoad` 之后 | 每次启用 1 次 | 一定在 `onLoad` 之后 |
| `onDisable` | `enabled` 由 `true → false` | 每次禁用 1 次 | 卸载前的最后一步 |
| `onUnload` | 进程退出 / 「重新加载」之前 | 每次卸载 1 次 | **逆序**（后加载的先卸载）；只要 `onLoad` 成功过就调，不论当前是否 `enabled` |

| 保障项 | 结论 |
|---|---|
| 超时 | 每个钩子 **5 000 ms**。超时 = 记日志 + 继续下一个，**不阻断启动** |
| `onLoad` 失败 | 插件标 `failed`：`api.*` 全部 reject、`onEnable` 不触发、设置页该行显示原因。**清单仍列在列表里**（不静默消失） |
| `onEnable` 失败 | 视为 `failed`，同一条口径 |
| `onDisable` / `onUnload` 失败 | 只记日志。退出路径上不能因为插件卡住用户 |
| 重入 | 钩子执行期间宿主拒绝同一插件的 `api.*` 调用（返回「插件正在加载」），防止 `onLoad` 里自我调用递归 |
| 并发 | **全局串行**。插件共享同一个 WebView 与同一个 DB 连接池，并发加载只会让「卡住时是谁卡的」无法归因 |

### 10.6 生命周期与 UI 的回调面（⬜）

插件脚本 `main.js` 的 ESM 默认导出：

```js
export default {
  onLoad(api) {},        // 建立 api 引用，注册 ui 声明
  onEnable(api) {},      // 开始干活
  onDisable(api) {},     // 停手，释放资源
  onUnload(api) {},      // 兜底清理
  onUiEvent(nodeId, value) { return [] } // 返回新的 UiNode[]
};
```

### 10.7 `entry: script` 的语义预留（⬜，本机仍拒载）

| 项 | 结论 |
|---|---|
| 目录约定 | `<插件目录>/main.js`（固定名，不可配置） |
| 运行时形态 | WebView 内的**独立 `Web Worker`**，不是主线程、不共享 `window` |
| 为什么是 Worker | 插件死循环不能锁死主条。同页脚本一旦 `while (true)`，整个界面就冻住，用户只能杀进程 |
| 通信 | 与宿主只经 `api` 对象（`postMessage`），插件拿不到 `window`、`document`、Tauri 的 `invoke` |
| 模块形态 | ESM，`export default { onLoad, onEnable, onDisable, onUnload, onUiEvent }` |
| 现在写会怎样 | **拒载**，`entry=script 尚未实现运行时，当前宿主只执行 manifest` |

> 为什么定成 Worker 而不是"反正没实现，随便写"：目录约定与运行时形态决定了 API 的**同步/异步**
> 底色（Worker 里只能异步）。现在定错，将来所有插件的 `api.*` 调用签名都要改一遍。

### 10.8 兼容策略

| 插件 `apiVersion` | v3 宿主行为 | 状态 |
|---|---|---|
| `1` | 正常载入。`quickTimers` 解析并展示（**仍不**注入摸鱼菜单，ADR-026） | ✅ |
| `2` | 正常载入。`contributes.mdSync` → **忽略 + 警告**；其余按 v2 语义 | ✅ |
| `3` | 正常载入。`permissions` / `engines` / `dependencies` / `author` / `homepage` 本轮不校验（§10.1）；`entry: script` 仍拒载 | 部分 ✅ |
| `4` 及以上 | **拒载**：`apiVersion 必须为 1..=3（本机宿主版本更低）` | ✅ |

**`contributes.mdSync` 为什么是「忽略并警告」而不是「拒载」**（四条，每条可核）：

1. mdSync 的同步逻辑**本来就在宿主**（`services/md_sync`），插件里那几行只是默认落点的**数据**。
   数据作废不会让插件的其它部分（`quickTimers`）出问题。
2. 拒载的代价是**整个插件失效**。为一个已经作废的贡献点惩罚插件的全部功能，惩罚大于过错。
3. 但必须**可见**：设置 → 插件 该行显示黄字警告，插件仍标为生效。
4. 与「宁缺毋滥」不冲突：那条规则针对的是**宿主必须解释其语义才能运行**的字段
   （`entry` / `apiVersion`）。`mdSync` 现在不需要解释——宿主有能力、也有正当理由直接忽略它。

设置页文案（与 §7 表格同一句，两处逐字一致）：
「contributes.mdSync 已在 apiVersion 3 下架：Markdown 同步已归内核，本段被忽略；同步请在「设置 → 同步」里配置」

### 10.9 明确不做的事（本轮 · 现时边界）

> 这一节取代 §9 在 v3 语境下的含义。

| 不做 | 结论 | 原因 |
|---|---|---|
| 加载 / 执行插件脚本 | ❌ 本轮不实现（`entry: script` 拒载） | 运行时涉及 Worker 隔离、API 注入、崩溃回收，是一次独立迭代 |
| 沙箱 / 逐条授权 | ❌ **永不做** | 主人拍板「插件即全权限」：装了就是自己人。做半套沙箱只会让用户以为有隔离 |
| `permissions` 参与准入 | ❌ 不做 | §10.3：声明性。约束性权限没有拦截点 = 假安全感 |
| 插件自定义全局事件 | ❌ 不做 | §10.4.2：事件名三方一致是机械门禁，白名单化等于关掉保护 |
| 插件给 HTML / CSS | ❌ 不做 | §10.4.3：令牌规则 + XSS + 主题失效 |
| 插件读写数据库 / 任意文件 | ❌ 不做 | 数据访问一律走 `commands → services → repositories`（ADR-015） |
| 插件市场 / 远程安装 / 自动更新 | ❌ 不做 | 无签名、无升级通道时上线市场等于分发任意代码 |
| 桌宠实现 | ❌ 本轮只定义形状 | §10.4.4 |
| 插件热重载（文件监听） | ❌ 不做 | 「重新加载」按钮已足够，且语义明确 |
