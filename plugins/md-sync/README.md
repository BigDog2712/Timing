# md-sync · Markdown 同步

TickBar 的第一个真实插件。它把 SQLite 里的**计时记录**和**便利贴**同步到 Markdown，
也把你在 Markdown 里改的内容写回 SQLite——两边都是真数据，不是导出快照。

插件本身只声明「数据落到哪」（`plugin.json` 的 `contributes.mdSync`），读写、冲突判定、
建事项、软删除全部由宿主的 `services::md_sync` 执行。宿主不运行插件代码。

## 安装

- **开发运行**（`npm run tauri dev`）：仓库里的 `plugins/md-sync` 会被 dev 扫描根直接读到，
  设置 → 插件 里应出现「Markdown 同步」。
- **发布版**：把整个 `md-sync` 文件夹复制到 `%APPDATA%\com.tickbar.app\plugins\md-sync`，
  再到 设置 → 插件 点「重新加载」。宿主不会自动往用户目录塞文件。

  ```powershell
  Copy-Item -Recurse -Force plugins\md-sync "$env:APPDATA\com.tickbar.app\plugins\"
  ```

## 默认落点

默认指向 Obsidian 日记库：

| 数据 | 文件 | 标题 |
|---|---|---|
| 事项计时 | `{date}.md`（如 `2026-10-20.md`） | `#### 事项计时` |
| 便利贴 | `{date}.md` | `#### 便利贴` |

根目录用 `%USERPROFILE%\OneDrive\应用\remotely-save\Elio\1-MemeX\Diary`。
换库时在 **设置 → 同步** 里改根目录、文件模板或标题即可；保存后立即同步。

## 计时格式（Planner 兼容）

写进日记的内容长这样，和 Obsidian Planner 的既有格式一致：

````markdown
- [ ] timing优化
  ```yaml
  planner:
    log:
      - start: 2026-10-14 00:30:51
        end: 2026-10-14 01:07:41
  ```
````

- 一个事项一组；同名事项的多段计时合并在同一组；
- 解析只认 `- [ ]` / `- [x]` 清单项和 `start:` / `end:`，区块里的其他文字会被忽略；
- 手工新增一组、改起止时间、删掉整组，都会在 2 秒内写回数据库。

## 便利贴格式

```markdown
| 更新时间 | 事项 | 内容 |
|---|---|---|
| 2026-10-20 09:30:00 | 生活 | 买牛奶 <!-- tb-note:3 --> |
```

- 行尾 `<!-- tb-note:ID -->` 是宿主的稳定标识，**不要手动改数字**；
- 便利贴是全局对象：即使落点是每天一个文件，今天日记里也会列出当前所有未删除便利贴；
- 没有标记的行 = 新建便利贴；标记消失 = 删除该便利贴；
- 正文里的 `|` 用 `\|`，换行用 `<br>`；
- 「事项」留空或写 `—` = 独立便利贴。

## 冲突规则

每次同步以「上次写出的区块内容」为基线：

- 只有 SQL 变了 → 写 Markdown；
- 只有 Markdown 变了 → 写 SQL；
- 两边都变了 → 比文件 mtime 与记录 `updated_at`，最后写入者胜。

标题不存在或文件不存在时**不导入**，只按 SQL 补写——避免改标题时误删数据。

## 关闭 / 卸载

- 设置 → 同步 → 关掉「启用 Markdown 同步」：停止读写，配置保留；
- 删除本插件目录：同步停止，`settings` 里的配置仍保留，重装后继续用。
