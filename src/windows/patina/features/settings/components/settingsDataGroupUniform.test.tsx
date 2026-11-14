/**
 * [本轮] 「数据与同步」整组的两条判据：**旧的行排法彻底下线** + **每个可操作项都在偏好行里**。
 * -----------------------------------------------------------------------------
 * 为什么值得单开一份：这一轮改的全是**行排法**（自定义的 flex 行 → `SettingsPreferenceRow`），
 * 业务行为一行都没动 —— 所以任何行为测试都不会因为这次改动变红，也就等于没有约束。
 * 能咬住它的只有两件事：
 *   ① 旧的自定义行类名不许再出现在渲染路径上（改回去 = 又变成两种行摆在同一页里，
 *      用户看到的就是「数据管理这块 UI 太差」）；
 *   ② 每个可操作项（`button`）的祖先里必须有 `.settings-preference-row`
 *      —— 「换成同一套」这句话的可验证形态就是这个。
 *
 * 断言分两层，各补一个盲区：
 *   · **源码级**（拆文件后的七个文件）：类名字面量与「有没有用偏好行」都钉住；
 *     它挡的是「某个文件被整体重写回旧结构」。
 *   · **渲染级**（真挂出来数 DOM）：挡的是源码看着对、实际结构不对（比如偏好行外面又套了
 *     一层裸 flex 行，或者按钮被挪到行外）。
 *
 * 变异自证（本轮真做过）：把 `SettingsDataCleanupGroup` 的第一行换回
 * `<div className="settings-data-action-row">` → 本文件 3 条红（旧类名 ×1、行容器 ×1、
 * 渲染期不该有旧类节点 ×1）；还原后全绿。
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from "node:fs";
// @ts-expect-error 同上：仅测试进程用得到 node:path。
import { dirname, join } from "node:path";
// @ts-expect-error 同上：仅测试进程用得到 node:url。
import { fileURLToPath } from "node:url";
import { LocaleProvider } from "../../../shared/i18n/LocaleContext.tsx";
import { resolveLocaleActivation } from "../../../shared/i18n/runtime.ts";
import SettingsDataExportGroup from "./SettingsDataExportGroup";
import SettingsDataCleanupGroup from "./SettingsDataCleanupGroup";

/* 本文件在 `src/windows/patina/features/settings/components/`：六级上去是仓库根。
   ⚠ 不用 `new URL(<字面量>, import.meta.url)`：vite 会把字面量形态静态重写成 dev-server URL。 */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..", "..");

function read(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

/** 去掉 CSS 注释：下线说明里正当地写着这些类名，拿注释当证据会让用例变成「删注释就红」。 */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** 「数据与同步」整组在拆分后的全部产物（外壳 + 四个子组 + 对话框层 + 远端面板）。 */
const DATA_GROUP_DIR = "src/windows/patina/features/settings/components";
const DATA_GROUP_FILES = [
  "SettingsDataSafetyPanel.tsx",
  "SettingsDataExportGroup.tsx",
  "SettingsDataBackupGroup.tsx",
  "SettingsStoragePathsGroup.tsx",
  "SettingsDataCleanupGroup.tsx",
  "SettingsDataSafetyDialogs.tsx",
  "SettingsRemoteBackupPanel.tsx",
] as const;

/** 这一轮下线的两个自定义行类（只在 `settings.css` 的下线注释里出现，代码里必须为零）。 */
const RETIRED_ROW_CLASSES = ["settings-data-action-row", "settings-storage-path-row"] as const;

describe("① 旧行排法彻底下线（源码 + CSS）", () => {
  for (const file of DATA_GROUP_FILES) {
    for (const retired of RETIRED_ROW_CLASSES) {
      it(`g01_${file}_no_longer_uses_${retired}`, () => {
        const source = read(`${DATA_GROUP_DIR}/${file}`);
        expect(source, `${file} 又用回旧行类 ${retired}`).not.toContain(retired);
      });
    }
  }

  it("g02_settings_css_no_longer_defines_the_retired_row_classes", () => {
    /* 真正的判据是**选择器**而不是「出现过」：`settings.css` 里保留了下线说明注释，
       注释里写着这两个类名（那是文档，不是样式）。去注释后必须一个都不剩 ——
       连 `.settings-data-action-row` 前缀命中都不许有。 */
    const css = stripCssComments(read("src/windows/patina/shell/styles/features/settings.css"));
    for (const retired of RETIRED_ROW_CLASSES) {
      expect(css, `${retired} 的规则应当整批删掉`).not.toContain(retired);
    }
    expect(css).not.toContain("settings-data-actions-grid");
    expect(css).not.toContain("settings-data-actions-list");
    expect(css).not.toContain("settings-storage-path-list");
    expect(css).not.toContain("settings-storage-path-heading");
    expect(css).not.toContain("settings-storage-path-actions");
  });

  it("g03_settings_css_keeps_the_pieces_the_new_rows_need", () => {
    /* 删旧行不等于删干净：新的三行依赖下面这几个零件，少一个就是「路径读数和图标挤在一起」 */
    const css = stripCssComments(read("src/windows/patina/shell/styles/features/settings.css"));
    expect(css).toContain(".settings-preference-meta");
    expect(css).toContain(".settings-preference-meta-placeholder");
    expect(css).toContain(".settings-preference-actions");
    /* 分隔线仍由偏好行给（不是每个子组自己画） */
    expect(css).toMatch(/\.settings-preference-list\s*>\s*\.settings-preference-row\s*\+\s*\.settings-preference-row/);
  });
});

describe("② 每个可操作项都排在偏好行里（源码）", () => {
  /** 每个子组：必须 import 偏好行、必须用 `settings-preference-list` 容器、必须真有行。 */
  const GROUPS = [
    { file: "SettingsDataExportGroup.tsx", rows: 2 },
    { file: "SettingsDataBackupGroup.tsx", rows: 2 },
    { file: "SettingsDataCleanupGroup.tsx", rows: 2 },
    { file: "SettingsStoragePathsGroup.tsx", rows: 2 },
    { file: "SettingsRemoteBackupPanel.tsx", rows: 1 },
  ] as const;

  for (const { file, rows } of GROUPS) {
    it(`g04_${file}_rows_are_preference_rows`, () => {
      const source = read(`${DATA_GROUP_DIR}/${file}`);
      expect(source).toContain('from "./SettingsPreferenceLayout"');
      expect(source).toContain("SettingsPreferenceRow");
      /* 行数只许多不许少：少一行就是某个动作掉到行外去了（多出来的是占位行，允许） */
      expect(source.match(/<SettingsPreferenceRow\b/g)?.length ?? 0).toBeGreaterThanOrEqual(rows);
    });
  }

  it("g05_every_group_puts_its_rows_in_the_shared_divider_list", () => {
    /* 行距与分隔线由 `.settings-preference-list > .settings-preference-row + .settings-preference-row`
       给；不进这个容器，四个子组就会各画一条粗细不一的边。 */
    /* `SettingsRemoteBackupPanel` 是**一行**：它把行插进父组的 `settings-preference-list`
       （见 `SettingsDataBackupGroup`），所以它自己不该再画一个容器 —— 否则行距与分隔线
       会在中间断一次。剩下四个子组各拥有自己的容器。 */
    for (const { file } of GROUPS.filter((group) => group.file !== "SettingsRemoteBackupPanel.tsx")) {
      const source = read(`${DATA_GROUP_DIR}/${file}`);
      expect(source, `${file} 的偏好行没有进 settings-preference-list`).toContain(
        'className="settings-preference-list"',
      );
    }
    expect(read(`${DATA_GROUP_DIR}/SettingsRemoteBackupPanel.tsx`)).not.toContain(
      'className="settings-preference-list"',
    );
    expect(read(`${DATA_GROUP_DIR}/SettingsDataBackupGroup.tsx`)).toContain(
      "<SettingsRemoteBackupPanel",
    );
  });

  it("g06_the_shell_only_composes_and_keeps_the_busy_aggregate", () => {
    /* 外壳文件只做组合：它自己不再排行（出现 `<SettingsPreferenceRow` 就说明有行没搬走），
       而且 `busy` 的七项口径一项都不许少（少一项 = 长任务并行时按钮可点）。 */
    const shell = read(`${DATA_GROUP_DIR}/SettingsDataSafetyPanel.tsx`);
    expect(shell).not.toContain("<SettingsPreferenceRow");
    for (const flag of [
      "isExportingBackup",
      "isRestoringBackup",
      "isStorageBusy",
      "remoteBackup.isUploading",
      "remoteBackup.isListing",
      "remoteBackup.isDownloading",
      "isImportBusy",
    ]) {
      expect(shell, `busy 口径少了 ${flag}`).toContain(flag);
    }
  });
});

describe("③ 「同步与备份」卡的卡片外壳与宿主变量桥", () => {
  it("g07_host_sync_panel_uses_the_same_card_shell", () => {
    const panel = read(`${DATA_GROUP_DIR}/host/HostSyncPanel.tsx`);
    /* 同页另外四组都是 `qp-panel` + `SettingsPanelHeader`；这一组原来直接用宿主页签的
       `.data` + `.data__head`，连标题都是页签名。 */
    expect(panel).toContain('className="qp-panel p-5 md:p-6 settings-host-sync"');
    expect(panel).toContain("<SettingsPanelHeader");
    /* 判据落在 **JSX 属性**上：文件头注释里正当地写着「原来用的是 `.data__head`」这段历史 */
    expect(panel).not.toContain('<header className="data__head"');
    expect(panel).not.toContain('className="data__title"');
    expect(panel).toContain('className="settings-host-sync-blocks"');
  });

  it("g08_the_host_token_bridge_maps_the_tokens_those_blocks_actually_use", () => {
    /* 六块面板的样式只引用宿主语义变量；分析窗只产 `--qp-*`，不桥接就是一片落空。
       断言「被引用的每一个变量都在桥里」：漏一个 = 那一处又变回裸样式。 */
    const hostCss = [
      "settings-data.css",
      "settings-data-slim.css",
      "settings-sync.css",
      "settings-sync-interval.css",
      "settings-sync-cloud.css",
    ]
      .map((file) => stripCssComments(read(`src/windows/patina/shell/styles/features/host/${file}`)))
      .join("\n");
    /* 这些不归这次桥接管：`--font-mono` 由 `tokens.css` 的 `@theme` 直接给，
       `--*` 空名与 `--qp-*` 是 patina 自己的。 */
    const infra = new Set(["--font-mono"]);
    const used = new Set(
      [...hostCss.matchAll(/var\((--[a-z0-9-]+)/g)]
        .map((match) => match[1])
        .filter((name) => !name.startsWith("--qp-") && !infra.has(name)),
    );
    const bridge = read("src/windows/patina/shell/styles/features/host/settings-bits.css")
      .slice(read("src/windows/patina/shell/styles/features/host/settings-bits.css").indexOf(".settings-host-sync {"));
    expect(used.size).toBeGreaterThan(10);
    for (const name of used) {
      expect(bridge, `桥里没有 ${name}，这块面板会退回裸样式`).toContain(`${name}:`);
    }
    /* 桥是**作用域**的，不是 `:root`：不许顺手改到别处还留着同名变量的面板 */
    expect(bridge).toContain(".settings-host-sync-blocks");
  });
});

describe("④ 渲染级：行是真的（不是源码看着像）", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await resolveLocaleActivation("zh-CN", () => true);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });

  function mount(element: ReactElement): void {
    act(() => root.render(createElement(LocaleProvider, { locale: "zh-CN", children: element })));
  }

  it("g09_export_group_renders_every_button_inside_a_preference_row", () => {
    const calls: string[] = [];
    mount(createElement(SettingsDataExportGroup, {
      busy: false,
      onOpenDataExport: () => calls.push("export"),
      onOpenDataImport: () => calls.push("import"),
    }));
    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".settings-preference-control button"),
    );
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button.closest(".settings-preference-row"), "按钮掉到偏好行外面了").not.toBeNull();
      expect(button.closest(".settings-preference-control"), "按钮没落在行的右侧控件区").not.toBeNull();
    }
    /* 两个动作各在自己的行里（不是两行并成一行） */
    const rows = new Set(buttons.map((button) => button.closest(".settings-preference-row")));
    expect(rows.size).toBe(2);
    /* 旧类名的节点一个都不许有 */
    expect(container.querySelector(".settings-data-action-row, .settings-storage-path-row")).toBeNull();
    /* 回调仍然各接各的（换行排法不改行为） */
    buttons[0].click();
    buttons[1].click();
    expect(calls).toEqual(["export", "import"]);
  });

  it("g10_cleanup_group_keeps_the_danger_button_and_its_disabled_state", () => {
    const opened: string[] = [];
    mount(createElement(SettingsDataCleanupGroup, {
      busy: false,
      isCleaning: false,
      onOpenCacheClear: () => opened.push("cache"),
      onOpenHistoryCleanup: () => opened.push("history"),
    }));
    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".settings-preference-control button"),
    );
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button.closest(".settings-preference-row")).not.toBeNull();
    }
    /* 「清理历史记录」是危险动作：它的按钮仍带 danger（换排法不许把语义换掉） */
    expect(buttons[1].className).toContain("danger");
    buttons[0].click();
    buttons[1].click();
    expect(opened).toEqual(["cache", "history"]);

    /* busy 时两颗都禁用（原来是行上的禁用态，一行都不许松） */
    act(() => root.unmount());
    root = createRoot(container);
    mount(createElement(SettingsDataCleanupGroup, {
      busy: true,
      isCleaning: false,
      onOpenCacheClear: () => undefined,
      onOpenHistoryCleanup: () => undefined,
    }));
    for (const button of Array.from(
      container.querySelectorAll<HTMLButtonElement>(".settings-preference-control button"),
    )) {
      expect(button.disabled).toBe(true);
    }
  });
});
