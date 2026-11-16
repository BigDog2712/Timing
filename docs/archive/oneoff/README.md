# 一次性脚本归档（去 Patina 化 T04-5）

这四个脚本是 T02「结构归一」期间写完就用掉的**一次性工具**，不是可复用基础设施。
2026-11-16 从 `scripts/oneoff/` 移到这里，只为让 `scripts/` 只剩还在用的东西。

| 文件 | 当时干什么 |
|---|---|
| `patina-gen-ipc.py` | 从上游 Patina 源码生成 IPC 命令清单（T02 清点用） |
| `patina-merge-ipc.py` | 把上游命令清单与我们自己的合并，产出迁移对照表 |
| `patina-restore-split.py` | 拆分过程中失误时把整树回滚到快照 |
| `patina-split-tests.py` | 把内联测试批量拆成独立文件（`SPLIT_LIST` / `SPLIT_ROOT` 环境变量指定范围） |

**别再运行它们**：路径是当时 `src/patina/**` 的坐标，结构归一之后已经不成立。
留着只为「当时到底怎么干的」有据可查。
