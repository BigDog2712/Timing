# Triage Labels

技能用五个规范化的 triage 角色说话。本文件把角色映射到本仓库 issue tracker 里实际使用的标签字符串。

| 技能里的角色 | 本仓库的标签 | 含义 |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | 维护者需要评估这张 issue（尚未诊断） |
| `needs-info` | `needs-info` | 等报告人补充信息 |
| `ready-for-agent` | `ready-for-agent` | 已完整描述，可以直接交给 AFK agent 实现 |
| `ready-for-human` | `ready-for-human` | 需要人来实现 |
| `wontfix` | `wontfix` | 不打算处理 |

五个角色都沿用默认名字，不做改名。技能提到某个角色时（例如「打上可交给 agent 的 triage 标签」），用上表右列对应的字符串。

## 票型标签（非 triage 角色）

`/wayfinder` 另有一套票型标签，与 triage 角色互不替代：

| 标签 | 含义 |
| --- | --- |
| `wayfinder:map` | 地图票（承载 Destination / Notes / Decisions so far / Fog） |
| `wayfinder:research` | 研究票 |
| `wayfinder:prototype` | 原型票 |
| `wayfinder:grilling` | 待决策 / 待讨论票 |
| `wayfinder:task` | 任务票 |

另外，GitHub 默认集里的 `bug` 也在用：新增 BUG 单必带 `bug`，未诊断时同时带 `needs-triage`。

打标签严格按技能规则来，不额外强制任何标签。
