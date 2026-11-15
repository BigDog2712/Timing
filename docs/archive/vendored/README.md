# 归档：vendored 上游对账账本（2026-11-15 下线）

这两个文件曾在 0.12.0–0.12.2 期间承担「Patina 上游对账」职责，已于 2026-11-15 从
`scripts/` 删除，此处保留副本**仅作历史证据**，不参与任何构建或门禁。

## 为什么留副本

`Active/Timing/for-forg/49-审计-Patina同源度与上游反哺-20261115.md` 里给出了两个数字：

| 数字 | 含义 |
|---|---|
| **994** | `vendored-baseline.json` 固化的基线文件数（归一态逐文件哈希，前端锚 `7bc7bd7`、后端锚 `9a7772f`） |
| **301** | `vendored-allowlist.json` 记录的偏离条目数（`path` + `change` + `reason` + `owner`） |

301 / 994 = **30.3%**，即「基线文件里已有三成被本项目改动过」。这个比例是判断
「Patina 部分还剩多少是上游原样」的量化依据之一，所以数字要可查、不能只剩结论。

## 为什么删

项目自 0.12.2 起转入**完全自主维护**，不再与上游做逐文件对账：
代码已按层并入宿主、命名已统一去品牌化，继续维护一份「上游坐标系」的账本只会增加
每次提交的登记成本，而不再产生同步收益。

## MIT 归属义务不依赖这两个文件

归属由仓根 `THIRD-PARTY-NOTICES.md` 承担 —— 版权声明、许可全文、"不得暗示原作者背书"。
这是许可证要求的全部。对账工具是**工程实践**，不是法律义务，删掉它不影响合规。

## 内容形态

两个文件都是 JSON：

- `vendored-baseline.json`：`{ source, roots, files: { <相对路径>: <blob sha> }, _reanchor }`
- `vendored-allowlist.json`：`{ entries: [{ path, change, reason, owner }], ... }`

`change` 是相对**基线提交**算的（`added` / `modified`），同一 path 只允许一条。
