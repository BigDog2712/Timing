# v1 阶段文档（归档）

本目录保存 Timing v1 阶段的规格、架构、设计与 QA 文档。**它们已被 v0.2.0 起的现行文档取代**，此处仅作历史留存与决策追溯，不作为实现依据。

实现或评审时请读现行文档：

| 归档文档（本目录） | 现行替代 |
|---|---|
| `Spec-v1.md` | `docs/Spec-V0.2.0.md` |
| `phase1/PRD-v1.md` | `docs/phase1/PRD-V0.2.0.md` |
| `phase1/ARCHITECTURE-v1.md` | `docs/phase1/ARCHITECTURE-V0.2.0.md` |
| `phase1/UIUX-v1.md` | `docs/design/DESIGN-V0.2.0.md` + `docs/design/pages-V0.2.0/` |
| `design/DESIGN.md` | `docs/design/DESIGN-V0.2.0.md` |
| `design/pages/*.md` | `docs/design/pages-V0.2.0/*.md` |
| `design/design-tokens.css` / `design-tokens.json` | `docs/design/design-tokens-V0.2.0.css` / `.json`（实现侧 `src/styles/design-tokens.css`） |
| `phase2/schema.sql` | `docs/phase2/schema-V0.2.0.sql`（实现侧 `src-tauri/src/migrations/`） |
| `phase4/QA-REPORT.md` | `docs/phase4/QA-REPORT-V0.2.0-BATCH1.md` |

归档规则：仅在追溯历史决定（例如「为什么当初这样定」）时引用；新写的代码注释、测试断言、Spec 引用都不得指向本目录。
