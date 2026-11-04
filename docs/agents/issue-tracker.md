# Issue tracker: GitHub

本仓库的 issue 与 spec 都住在 GitHub Issues（仓库 `BigDog2712/Timing_Rust`，取自 `git remote -v` 的 `origin`）。所有操作走 `gh` CLI；在 clone 内执行时 `gh` 会自动推断仓库。

面板场景优先用 `deck_` 系列工具（`deck_issue_create` / `deck_issue_list` / `deck_issue_get` / `deck_issue_patch` / `deck_map_snapshot` / `deck_map_link` / `deck_issue_report`），它们的读写与下面这些 `gh` 命令是同一批 issue。

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`。多行正文用 heredoc。
- **Read an issue**: `gh issue view <number> --comments`，用 `jq` 过滤评论，并一并取到 labels。
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，按需加 `--label` / `--state` 过滤。
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

标签词表见 `docs/agents/triage-labels.md`：triage 五角色 + `wayfinder:*` 票型标签。打标签严格按技能规则来，不额外强制任何标签。

## Pull requests as a triage surface

**PRs as a request surface: no.**（若本仓库以后把外部 PR 当作需求入口，改成 `yes`，`/triage` 会读这一行。）

置为 `yes` 时，PR 走与 issue 相同的标签与状态，命令换成 `gh pr` 对应项：

- **Read a PR**: `gh pr view <number> --comments`，diff 用 `gh pr diff <number>`。
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`，只留 `authorAssociation` 为 `CONTRIBUTOR` / `FIRST_TIME_CONTRIBUTOR` / `NONE` 的（丢掉 `OWNER` / `MEMBER` / `COLLABORATOR`）。
- **Comment / label / close**: `gh pr comment`、`gh pr edit --add-label` / `--remove-label`、`gh pr close`。

GitHub 的 issue 与 PR 共用一个编号空间，裸 `#42` 可能是任一种：先 `gh pr view 42`，失败再回退 `gh issue view 42`。

## When a skill says "publish to the issue tracker"

建一张 GitHub issue。

## When a skill says "fetch the relevant ticket"

执行 `gh issue view <number> --comments`。

## Wayfinding operations

`/wayfinder` 用。**map** 是一张带 `wayfinder:map` 标签的 issue，**ticket** 是它的子 issue（GitHub sub-issues 原生父子关系）。

- **Map**: 一张 issue，标签 `wayfinder:map`，正文放 Destination / Notes / Decisions so far / Fog。`gh issue create --label wayfinder:map`。
- **Child ticket**: 用 sub-issues 端点挂到 map 下（`gh api`）。子 issue 打 `wayfinder:<type>` 标签，type ∈ `research` / `prototype` / `grilling` / `task`。认领后 assign 给动手的人。
- **Blocking**: 用 GitHub 原生 issue dependencies（UI 可见，是正本）：`gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`，其中 `<blocker-db-id>` 是阻塞方的数字 database id（`gh api repos/<owner>/<repo>/issues/<n> --jq .id`），不是 `#number`，也不是 `node_id`。开放阻塞数看 `issue_dependencies_summary.blocked_by`。用不了 dependencies 时，回退成子 issue 正文顶部的 `Blocked by: #<n>, #<n>` 行。所有阻塞方都关闭即解锁。
- **Frontier query**: 列出 map 的开放子 issue，剔掉仍有开放阻塞的（`issue_dependencies_summary.blocked_by > 0`，或 `Blocked by` 行里还有未关的）和已有 assignee 的；map 顺序里第一个胜出。
- **Claim**: `gh issue edit <n> --add-assignee @me`，这是本会话的第一次写。
- **Resolve**: `gh issue comment <n> --body "<answer>"` → `gh issue close <n>` → 往 map 的 Decisions-so-far 追加一条上下文指针（结论 + 链接）。
