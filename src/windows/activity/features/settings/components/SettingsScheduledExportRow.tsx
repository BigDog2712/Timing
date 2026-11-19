/**
 * Timing — 设置 · 「定时导出」这一行（[B5d]）
 * -----------------------------------------------------------------------------
 * 为什么搬：这一行原来藏在**导出动作的弹窗**里，路径是
 *   设置 → 数据安全卡 → 「数据导出」按钮 → 导出弹窗 → 头部 `CalendarClock` 图标 → 定时导出弹窗
 * 四级深度只是表象，真正的问题是**层级错位**：定时导出是一条**长期设置**（每天/每周自动
 * 跑、跑什么格式、落到哪个目录），却被收进了一次性动作（导一份数据）的弹窗里。用户不会
 * 想到"要配定时导出，先去点一次导出"。
 *
 * 现在它和数据导出/导入/完整数据包同组（`SettingsDataExportGroup`），一个行、一个按钮、
 * 直接开配置弹窗 —— 与「导出」「导入」「完整数据包」三行同一形状，同组内不再有第四种入口。
 *
 * 只管**入口**：配置表单全部还在 `SettingsScheduledExportDialog.tsx` 里，本组件只做
 * 懒加载（`import()`，弹窗不进首屏包）+ 取一次快照 + 挂载。搬的是"从哪儿打开"，
 * 不是"打开之后是什么" —— 所以这份文件里没有任何一条导出规则。
 *
 * 默认格式与字段集：**取已保存的导出偏好**（`readExportFormat` / `readExportFields`），
 * 不再从导出弹窗当场选的那份（还没确认的临时选择）继承。这是语义澄清不是降级：
 * 定时任务是后台跑的，它的默认值只应该来自持久化的偏好，不该依赖用户上一次在弹窗里
 * 随手点过什么。每次打开都重算，所以偏好改过之后下次打开就是新值。
 *
 * 文案：**不新增 i18n key**（`contract.ts` 零行余量）。行标题复用
 * `UI_TEXT.export.scheduledTitle`（「定时导出」，与弹窗标题逐字一致），hint 留空
 * —— 一个词说不清的东西写在弹窗里，不塞进 tooltip。按钮沿用 `配置`（`webDavConfigure`
 * 这个键名是历史包袱，值本身是通用词，已记进 B6 的 i18n 技术债，等 contract 有余量再正名）。
 */
import { useCallback, useRef, useState } from "react";

import QuietButton from "../../../shared/components/QuietButton";
import { useLocaleText } from "../../../shared/i18n/index.ts";
import {
  SETTINGS_DATA_EXPORT_DEFAULT_FIELDS_BY_FORMAT,
  isSettingsDataExportField,
  type SettingsDataExportFieldKey,
} from "../services/settingsDataExportFields.ts";
import {
  readExportFields,
  readExportFormat,
} from "../services/settingsDataExportPreferences.ts";
import type { ExportFormat } from "../services/settingsDataExportRange.ts";
import type { ScheduledExportSnapshot } from "../services/scheduledExportService.ts";
import { SettingsPreferenceRow } from "./SettingsPreferenceLayout";

type ScheduledExportDialogComponent = typeof import("./SettingsScheduledExportDialog.tsx")["default"];

/**
 * 「当前导出偏好」= 定时任务该用的默认格式 + 该格式下已保存的字段集。
 * 导出一次算一遍（打开时），不在渲染期算 —— 它会读 localStorage，渲染期读会
 * 让这行在每次父级重渲染时都碰一遍存储。
 */
function readCurrentExportPreference(): {
  format: ExportFormat;
  fields: SettingsDataExportFieldKey[];
} {
  const format = readExportFormat();
  const fields = readExportFields(format, SETTINGS_DATA_EXPORT_DEFAULT_FIELDS_BY_FORMAT[format])
    .filter(isSettingsDataExportField);
  return { format, fields };
}

export default function SettingsScheduledExportRow({ disabled = false }: { disabled?: boolean }) {
  const UI_TEXT = useLocaleText();
  const [opening, setOpening] = useState(false);
  /** 弹窗组件（懒加载拿到之前是 `null`）；快照同理，两者同时就绪才挂载 */
  const [Dialog, setDialog] = useState<ScheduledExportDialogComponent | null>(null);
  const [snapshot, setSnapshot] = useState<ScheduledExportSnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [fields, setFields] = useState<SettingsDataExportFieldKey[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  /** 关闭后把焦点还回触发按钮（弹窗是 portal，焦点不会自己回来） */
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const handleOpen = useCallback(async () => {
    if (opening) return;
    setOpening(true);
    setLoadFailed(false);
    try {
      const preference = readCurrentExportPreference();
      const dialogModule = await import("./SettingsScheduledExportDialog.tsx");
      const nextSnapshot = await dialogModule.loadScheduledExportSnapshot();
      setFormat(preference.format);
      setFields(preference.fields);
      setDialog(() => dialogModule.default);
      setSnapshot(nextSnapshot);
      setOpen(true);
    } catch (error) {
      /* 读快照失败只影响这一行：留在原地报错，不打断整页（导出是只读动作）
         —— 与「导出完整数据包」那一行同一处理方式。 */
      console.error("scheduled export snapshot load failed", error);
      setLoadFailed(true);
    } finally {
      setOpening(false);
    }
  }, [opening]);

  const closeDialog = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => {
      triggerRef.current?.focus();
    });
  }, []);

  return (
    <>
      <SettingsPreferenceRow title={UI_TEXT.export.scheduledTitle}>
        <QuietButton
          ref={triggerRef}
          size="compact"
          busy={opening}
          disabled={disabled || opening}
          onClick={() => { void handleOpen(); }}
        >
          {UI_TEXT.settings.webDavConfigure}
        </QuietButton>
      </SettingsPreferenceRow>
      {loadFailed ? (
        <p className="at-text-caption text-[var(--at-danger)]" role="alert">
          {UI_TEXT.settings.loadFailed}
        </p>
      ) : null}
      {snapshot && Dialog ? (
        <Dialog
          open={open}
          initialSnapshot={snapshot}
          currentFormat={format}
          currentFields={fields}
          onClose={closeDialog}
        />
      ) : null}
    </>
  );
}
