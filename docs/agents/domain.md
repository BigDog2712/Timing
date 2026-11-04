# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

本仓库为 **single-context** 布局：一个仓库共用一份根目录的 `CONTEXT.md`，架构决定放 `docs/adr/`。（不存在 `CONTEXT-MAP.md`，也不存在各子项目的 `CONTEXT.md`。）

## Before exploring, read these

- **`CONTEXT.md`** at the repo root：本仓库的通用语言与领域词汇。
- **`docs/adr/`**：读与你要动的区域相关的 ADR（架构决定）。

这些文件现在都还没有，也**不要在初始化阶段提前创建**。它们由 `/domain-modeling` 技能（经 `/grill-with-docs` 与 `/improve-codebase-architecture` 触达）在第一次真正写下词条或决定时惰性建立。文件不存在时**静默继续**：不报缺、不建议现在就建。

## File structure

```
/
├── CONTEXT.md
├── docs/
│   ├── adr/
│   │   ├── 0001-<decision>.md
│   │   └── 0002-<decision>.md
│   └── agents/
│       ├── issue-tracker.md
│       ├── triage-labels.md
│       └── domain.md
└── src/
```

## Use the glossary's vocabulary

当你的输出要命名一个领域概念（issue 标题、重构提案、假设、测试名），用 `CONTEXT.md` 里定义的词，不要漂移到它明确回避的同义词。

需要的概念还没进词条，是一种信号：要么你在发明项目不用的语言（重新考虑），要么真有缺口（记下来交给 `/domain-modeling`）。

## Flag ADR conflicts

如果你的输出与已有 ADR 冲突，明确摆出来，而不是悄悄覆盖：

> _与 ADR-0007（<标题>）冲突，但值得重开，因为……_
