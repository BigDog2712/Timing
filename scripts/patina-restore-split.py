"""从上游恢复被误拆的 35 个主文件，并重放此前对 patina 做的全部改名规则。

背景：第一版拆分脚本假设 `#[cfg(test)] mod tests` 在文件末尾，而上游有 39 个文件
把它放在中间（后面还有正式代码），结果正式代码被一起抽进测试文件 → 编译失败。
这里回滚：主文件按上游重置，逐条重放改名，再交给「花括号配对」版的拆分脚本。
"""

import io
import os
import re
import shutil

UPSTREAM = r"D:/302-IDM/patina-main/patina-main/src-tauri/src"
TARGET = r"D:/101-Workshop/261109-Timing/src-tauri/src/patina"

MAIN_FILES = [
    "commands/tools.rs",
    "data/activity_read_model/hourly.rs",
    "data/activity_read_model/mod.rs",
    "data/backup/import_data.rs",
    "data/backup/snapshot.rs",
    "data/classification_deletion.rs",
    "data/classification_service.rs",
    "data/export/mod.rs",
    "data/repositories/anonymous_activity.rs",
    "data/repositories/icon_cache.rs",
    "data/repositories/import_batches.rs",
    "data/repositories/session_title_samples.rs",
    "data/repositories/tools/pomodoro_tasks.rs",
    "data/repositories/tools.rs",
    "data/repositories/tracker_settings.rs",
    "data/repositories/web_links.rs",
    "data/sqlite_pool.rs",
    "data/tools_store.rs",
    "domain/mini_window/geometry.rs",
    "domain/mini_window.rs",
    "domain/reminder_schedule.rs",
    "domain/settings.rs",
    "domain/tracking/contracts.rs",
    "domain/web_activity.rs",
    "domain/web_links.rs",
    "engine/tracking/continuity.rs",
    "engine/tracking/runtime/window_polling.rs",
    "engine/tracking/runtime.rs",
    "engine/tracking/runtime_snapshot.rs",
    "engine/tracking/session_timeout.rs",
    "platform/runtime_diagnostics.rs",
    "platform/windows/app_metadata.rs",
    "platform/windows/icon.rs",
    "platform/windows/media.rs",
    "platform/windows/window_activation.rs",
]


def replay(text: str) -> str:
    """按融合时的顺序重放改名。顺序无关，但每条只跑一次。"""
    text = re.sub(r"\breqwest::", "reqwest012::", text)
    text = text.replace("crate::", "crate::patina::")
    lines = [
        line if "TRAY_ID" in line else line.replace('"main"', '"patina"')
        for line in text.split("\n")
    ]
    text = "\n".join(lines)
    text = text.replace('WebviewUrl::App("index.html"', 'WebviewUrl::App("patina.html"')
    text = text.replace('include_bytes!("../../icons/', 'include_bytes!("../../../icons/')
    text = text.replace("#[cfg(patina_coverage)]", '#[cfg(feature = "patina_coverage")]')
    text = text.replace(
        "#[cfg(patina_local_build)]", '#[cfg(feature = "patina_local_build")]'
    )
    text = text.replace("not(patina_local_build)", 'not(feature = "patina_local_build")')
    return text


restored = 0
for rel in MAIN_FILES:
    src = os.path.join(UPSTREAM, rel)
    dst = os.path.join(TARGET, rel)
    if not os.path.isfile(src):
        print(f"缺失上游文件: {rel}")
        continue
    shutil.copyfile(src, dst)
    with io.open(dst, encoding="utf-8") as fh:
        text = fh.read()
    with io.open(dst, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(replay(text))
    restored += 1

removed = 0
for root, _dirs, names in os.walk(TARGET):
    for name in names:
        if name.endswith("_mod_tests.rs"):
            os.remove(os.path.join(root, name))
            removed += 1

print(f"恢复主文件 {restored} 个，删除误抽的测试文件 {removed} 个")
