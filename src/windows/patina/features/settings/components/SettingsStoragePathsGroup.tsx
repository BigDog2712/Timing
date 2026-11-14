import { FolderOpen, FolderPen, RefreshCw, RotateCcw } from "lucide-react";
import { useLocaleText } from "../../../shared/i18n/index.ts";
import QuietActionRow from "../../../shared/components/QuietActionRow";
import QuietIconAction from "../../../shared/components/QuietIconAction";
import type { StorageSnapshot } from "../services/settingsRuntimeAdapterService.ts";
import { toEbwebviewCachePath } from "../services/storagePathDisplay.ts";
import { SettingsPreferenceGroup, SettingsPreferenceRow } from "./SettingsPreferenceLayout";

/**
 * 「存储」卡 · 本机目录（安装 / 缓存 / 数据三个目录各一行）。
 *
 * [本轮] 从自定义的目录行样式（`settings-storage-path-*` 那一族）统一到 `SettingsPreferenceRow`：
 * 行标题 = 目录名（体积读数作为标题旁的次级文字），右侧控件 = 原来那组图标键。
 * 三个目录各自成一行（原来是三列网格 `grid-template-columns: repeat(3, 1fr)`）——
 * 三列里路径与键都挤成半截，单行的可用宽度是它的三倍。
 *
 * 缓存/历史清理**不在**这一组：它们是"动作"而不是"目录"，本轮各自升成一行
 * （见 `SettingsDataCleanupGroup`，带 `hint` 说明影响面）。
 */
function formatDirectorySize(bytes: number): string {
  return `${Math.max(0, Math.round(bytes / 1048576))} MB`;
}

function StoragePathRow({
  title,
  meta,
  onOpen,
  onChangePath,
  onRestoreDefault,
  changeDisabled,
  restoreDisabled,
}: {
  title: string;
  meta?: string;
  onOpen: () => void;
  onChangePath?: () => void;
  onRestoreDefault?: () => void;
  changeDisabled?: boolean;
  restoreDisabled?: boolean;
}) {
  const UI_TEXT = useLocaleText();
  const storageText = UI_TEXT.settings.storage;
  return (
    <SettingsPreferenceRow
      title={(
        <>
          <span>{title}</span>
          {meta ? <span className="settings-preference-meta">{meta}</span> : null}
        </>
      )}
    >
      <span className="settings-preference-actions">
        <QuietIconAction
          icon={<FolderOpen size={14} />}
          title={storageText.openDirectoryAction}
          onClick={onOpen}
        />
        {onChangePath ? (
          <QuietIconAction
            icon={<FolderPen size={14} />}
            title={storageText.changePathAction}
            disabled={changeDisabled}
            onClick={onChangePath}
          />
        ) : null}
        {onRestoreDefault ? (
          <QuietIconAction
            icon={<RotateCcw size={14} />}
            title={storageText.restoreDefaultPathAction}
            disabled={restoreDisabled}
            onClick={onRestoreDefault}
          />
        ) : null}
      </span>
    </SettingsPreferenceRow>
  );
}

/** 快照还没回来时的同构占位行：键是**真的禁用**，位置不跳 */
function StoragePathPlaceholderRow({ title, actionTitles }: { title: string; actionTitles: string[] }) {
  return (
    <SettingsPreferenceRow
      title={(
        <>
          <span>{title}</span>
          <span className="settings-preference-meta settings-preference-meta-placeholder" aria-hidden="true" />
        </>
      )}
    >
      <span className="settings-preference-actions">
        {actionTitles.map((actionTitle) => (
          <QuietIconAction
            key={actionTitle}
            icon={<FolderOpen size={14} />}
            title={actionTitle}
            disabled
            showTooltip={false}
          />
        ))}
      </span>
    </SettingsPreferenceRow>
  );
}

export default function SettingsStoragePathsGroup({
  storageSnapshot,
  isStorageBusy,
  busy,
  onRefreshStorageSnapshot,
  onChooseDataDirectory,
  onChooseCacheDirectory,
  onRestoreDefaultDataDirectory,
  onRestoreDefaultCacheDirectory,
  onOpenStorageDirectory,
}: {
  storageSnapshot: StorageSnapshot | null;
  isStorageBusy: boolean;
  busy: boolean;
  onRefreshStorageSnapshot: () => Promise<void> | void;
  onChooseDataDirectory: () => Promise<void> | void;
  onChooseCacheDirectory: () => Promise<void> | void;
  onRestoreDefaultDataDirectory: () => Promise<void> | void;
  onRestoreDefaultCacheDirectory: () => Promise<void> | void;
  onOpenStorageDirectory: (path: string) => Promise<void> | void;
}) {
  const UI_TEXT = useLocaleText();
  const storageText = UI_TEXT.settings.storage;
  const webviewCache = storageSnapshot?.webviewCache;
  const webviewCachePath = webviewCache?.ebwebviewPath
    ?? (storageSnapshot ? toEbwebviewCachePath(storageSnapshot.paths.webviewRoot) : "");
  const isCustomDataRoot = Boolean(storageSnapshot?.paths.isCustomDataRoot);
  const isCustomWebviewRoot = Boolean(storageSnapshot?.paths.isCustomWebviewRoot);

  return (
    <SettingsPreferenceGroup
      /* [复核修复] 这个 class 是**样式挂点**，不是装饰：`settings.css` 里
         `.settings-local-paths-panel .qp-icon-action-neutral:hover/:active` 两条规则靠它命中，
         给三个目录行的图标键配 hover/按下态的背景与前景。拆分本文件时这一处丢了，
         结果那两条规则成了永不命中的孤岛 —— 症状不是报错，是"图标键 hover 没反应"。
         别删那两条选择器，也别把这个 class 摘掉（判据见
         `SettingsStoragePathCallbacks.test.tsx` 的 spc05）。 */
      className="settings-local-paths-panel"
      title={storageText.storageDirectoryTitle}
      headerAside={(
        <QuietIconAction
          icon={<RefreshCw size={14} className={isStorageBusy ? "animate-spin" : undefined} />}
          title={storageText.storageSnapshotRefreshAction}
          busy={isStorageBusy}
          disabled={busy}
          onClick={() => void onRefreshStorageSnapshot()}
        />
      )}
    >
      <QuietActionRow className="settings-preference-list">
        {storageSnapshot ? (
          <>
            <StoragePathRow
              title={storageText.installDirectoryLabel}
              meta={formatDirectorySize(storageSnapshot.sizes.installDirSizeBytes)}
              onOpen={() => void onOpenStorageDirectory(storageSnapshot.paths.installDir)}
            />
            <StoragePathRow
              title={storageText.webviewCacheDirectoryLabel}
              meta={formatDirectorySize(webviewCache?.totalSizeBytes ?? 0)}
              onChangePath={!isCustomWebviewRoot ? () => void onChooseCacheDirectory() : undefined}
              onRestoreDefault={isCustomWebviewRoot ? () => void onRestoreDefaultCacheDirectory() : undefined}
              changeDisabled={busy}
              restoreDisabled={busy}
              onOpen={() => void onOpenStorageDirectory(webviewCachePath)}
            />
            <StoragePathRow
              title={storageText.dataDirectoryLabel}
              meta={formatDirectorySize(storageSnapshot.sizes.dataSizeBytes)}
              onChangePath={!isCustomDataRoot ? () => void onChooseDataDirectory() : undefined}
              onRestoreDefault={isCustomDataRoot ? () => void onRestoreDefaultDataDirectory() : undefined}
              changeDisabled={busy}
              restoreDisabled={busy}
              onOpen={() => void onOpenStorageDirectory(storageSnapshot.paths.dataRoot)}
            />
          </>
        ) : (
          <>
            <StoragePathPlaceholderRow
              title={storageText.installDirectoryLabel}
              actionTitles={[storageText.openDirectoryAction]}
            />
            <StoragePathPlaceholderRow
              title={storageText.webviewCacheDirectoryLabel}
              actionTitles={[storageText.openDirectoryAction, storageText.changePathAction]}
            />
            <StoragePathPlaceholderRow
              title={storageText.dataDirectoryLabel}
              actionTitles={[storageText.openDirectoryAction, storageText.changePathAction]}
            />
          </>
        )}
      </QuietActionRow>
    </SettingsPreferenceGroup>
  );
}
