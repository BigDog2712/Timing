/**
 * Timing — 移动端设置页（Tab ④）
 * -----------------------------------------------------------------------------
 * 只做移动布局壳，内容**复用**桌面页签组件（DESIGN-ANDROID-V1 §2.2 / T12）：
 *   外观 = ThemePicker（主题 + 四色 + 高亮 + 不透明度）
 *   插件 = PluginsTab（桌面多一个「打开目录」，手机没有文件管理器可跳，故关掉）
 *   通用 = GeneralTab（桌面有「开机自启」，Android 无等价语义，故关掉）
 *
 * **同步页签 [V0.12.0] 回来了**：桌面的落点是路径字符串，手机是 SAF 目录授权，两者
 * 不同构——但合并规则完全同一份（Rust）。手机上由原生侧把当天文件镜像进沙箱，
 * Rust 照旧在真实路径上跑，跑完再写回 vault。于是这一页只需要「选目录 + 开关 + 同步」，
 * 不需要根目录输入框。详见 `SyncPane.tsx` 与 `services/md_sync/mirror.rs`。
 *
 * 「通知权限」「悬浮条」是手机独有的两行：Android 13+ 的运行时授权只能由前端在用户
 * 点击里申请；悬浮条的「显示在其他应用上层」只能跳系统设置页手动打开。
 */
import { useCallback, useEffect, useState } from 'react';
import { GeneralTab } from '../settings/GeneralTab';
import { PluginsTab } from '../settings/PluginsTab';
import { ThemePicker } from '../settings/ThemePicker';
import { SyncPane } from './SyncPane';
import { ensureNotifyPermission, notifyPermissionText } from '../../services/mobileNotify';
import { useMobileUiStore } from '../../stores/mobileUiStore';
import { mobileNative } from '../../services/mobileNative';
import { errorText } from '../../services/ipc';
import type { OverlayStatus } from '../../types/domain';

type TabId = 'look' | 'sync' | 'plugins' | 'gen';

const TABS: readonly { id: TabId; label: string }[] = [
  { id: 'look', label: '外观' },
  { id: 'sync', label: '同步' },
  { id: 'plugins', label: '插件' },
  { id: 'gen', label: '通用' },
];

/** 通知权限行：显示当前状态 + 一个显式申请按钮（拒绝过之后系统不会再自动弹） */
function NotifyRow() {
  const issue = useMobileUiStore((s) => s.notifyIssue);
  const [text, setText] = useState(() => notifyPermissionText());
  return (
    <div className="setting-row m-notify">
      <span className="setting-row__label">通知权限</span>
      <span className="m-notify__state" data-denied={issue ? 'true' : 'false'}>
        {text}
      </span>
      <button
        type="button"
        className="m-btn m-btn--small"
        onClick={() => {
          /* force：用户可能已经去系统设置里放开了，必须重新向系统查，而不是读缓存 */
          void ensureNotifyPermission(true).then(() => setText(notifyPermissionText()));
        }}
      >
        申请
      </button>
    </div>
  );
}

/**
 * 悬浮条开关。
 *
 * 开启时若缺「显示在其他应用上层」权限，原生侧会拉起系统授权页；用户回来后
 * `TimingNativePlugin.onResume` 会把服务真正起来，这里再点一次就是查询新状态。
 */
function OverlayRow() {
  const [status, setStatus] = useState<OverlayStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const refresh = useCallback(async () => {
    try {
      setStatus(await mobileNative.overlayStatus());
    } catch (err) {
      setStatus(null);
      setNote(errorText(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const text = !status ? '—' : status.enabled ? (status.permitted ? '已开启' : '待系统授权') : '已关闭';

  return (
    <>
      <div className="setting-row m-notify">
        <span className="setting-row__label">悬浮条</span>
        <span className="m-notify__state">{text}</span>
        <button
          type="button"
          className="m-btn m-btn--small"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setNote('');
            void mobileNative
              .setOverlay(!status?.enabled)
              .then((next) => {
                setStatus(next);
                if (next.enabled && !next.permitted) {
                  setNote('到系统设置里打开「显示在其他应用上层」，返回后即生效。');
                }
              })
              .catch((err) => setNote(errorText(err)))
              .finally(() => setBusy(false));
          }}
        >
          {status?.enabled ? '关闭' : '开启'}
        </button>
      </div>
      <p className="m-hint">
        {note || '浮在别的应用上显示当前计时，点一下回到 Timing；暂停、切换仍在主界面。'}
      </p>
    </>
  );
}

export function SettingsPage() {
  const [tab, setTab] = useState<TabId>('look');

  return (
    <div className="m-settings">
      <div className="m-seg" role="tablist" aria-label="设置分类">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className="m-seg__item"
            data-on={tab === item.id ? 'true' : 'false'}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="m-settings__body">
        {tab === 'look' && <ThemePicker />}
        {tab === 'sync' && <SyncPane />}
        {tab === 'plugins' && <PluginsTab showOpenDir={false} />}
        {tab === 'gen' && (
          <>
            <GeneralTab showAutostart={false} />
            <div className="setting-group">
              <OverlayRow />
              <NotifyRow />
              <p className="m-hint">通知被拒绝时，到点提醒只在应用内提示，不会发系统通知。</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
