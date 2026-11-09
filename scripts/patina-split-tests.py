"""把 Rust 文件里的 `#[cfg(test)] mod tests { ... }` 抽到独立文件（修正版）。

上一版假设测试块在文件末尾，而本仓库有 39 个文件把它放在中间（后面还有正式代码），
导致正式代码被误抽。本版用「顶层闭合花括号」定位块尾：

- `mod tests {` 在文件顶层（缩进 0），它的闭合 `}` 也在缩进 0；
- 不能用花括号计数——测试里大量 `format!("{}")` 会干扰计数。

抽出后主文件 = 块前 + `#[cfg(test)] #[path] mod tests;` + 块后，
`super::` 语义不变（`mod tests` 仍是原模块的子模块）。
"""

import io
import os
import re

LIST = r"C:/Users/49801/AppData/Roaming/WorkDaddy/client-tmp/workbuddy-cn/split_ok.txt"
ROOT = r"D:/101-Workshop/261109-Timing/src-tauri"

files = [line.strip() for line in io.open(LIST, encoding="utf-8") if line.strip()]
os.chdir(ROOT)

ok, skip = 0, []
for rel in files:
    with io.open(rel, encoding="utf-8") as fh:
        lines = fh.read().split("\n")

    # 定位「`#[cfg(test)]` + `mod tests {`」这一对
    head_at = brace_at = None
    for i, line in enumerate(lines):
        if line.strip() != "#[cfg(test)]":
            continue
        k = i + 1
        while k < len(lines) and lines[k].strip() == "":
            k += 1
        if k < len(lines) and re.match(r"^mod tests\s*\{\s*$", lines[k]):
            head_at, brace_at = i, k
            break
    if head_at is None:
        skip.append((rel, "没有顶层内联的 `mod tests {`"))
        continue

    # 顶层 `}` 收尾
    end = None
    for i in range(brace_at + 1, len(lines)):
        if lines[i].rstrip() == "}":
            end = i
            break
    if end is None:
        skip.append((rel, "找不到测试块的顶层闭合 `}`"))
        continue

    body = lines[brace_at + 1 : end]
    # 去掉一层 4 空格缩进
    dedented = [line[4:] if line.startswith("    ") else line for line in body]
    while dedented and dedented[0].strip() == "":
        dedented.pop(0)
    while dedented and dedented[-1].strip() == "":
        dedented.pop()

    stem = os.path.splitext(os.path.basename(rel))[0]
    target = os.path.join(os.path.dirname(rel), f"{stem}_mod_tests.rs")
    if os.path.exists(target):
        skip.append((rel, f"目标已存在 {os.path.basename(target)}"))
        continue

    header = [
        f"//! `{os.path.basename(rel)}` 的测试（从原文件抽出，仅为守住单文件 ≤300 行）。",
        "//!",
        "//! `mod tests` 仍声明在原模块内（`#[path]` 指向本文件），`super::` 语义不变。",
        "",
    ]
    with io.open(target, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(header + dedented) + "\n")

    kept = lines[:head_at]
    while kept and kept[-1].strip() == "":
        kept.pop()
    kept += ["", "#[cfg(test)]", f'#[path = "{stem}_mod_tests.rs"]', "mod tests;"]
    rest = lines[end + 1 :]
    while rest and rest[0].strip() == "":
        rest.pop(0)
    if rest:
        kept += ["", ""] + rest
    elif kept and kept[-1] != "":
        kept.append("")

    with io.open(rel, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(kept))
    ok += 1

print(f"拆分 {ok} / {len(files)}")
for rel, why in skip:
    print(f"  SKIP {rel}: {why}")
