/**
 * TickBar — 移动端设置页（Tab ④）
 * -----------------------------------------------------------------------------
 * 只做移动布局壳，内容**复用**三个桌面页签组件（DESIGN-ANDROID-V1 §2.2 / T12）：
 *   外观 = ThemePicker（主题 + 四色 + 高亮 + 不透明度）
 *   插件 = PluginsTab（桌面多一个「打开目录」，手机没有文件管理器可跳，故关掉）
 *   通用 = GeneralTab（桌面有「开机自启」，Android 无等价语义，故关掉）
 *
 * **同步页签整个不出现**：md-sync 本轮不做（§1.4），落点需要 SAF 持久 URI，
 * 与桌面的「路径字符串」模型不同构（PRD Q2）。留一个点不动的页签会让人以为坏了。
 *
 * 「通知权限」是手机独有的一行：Android 13+ 的运行时授权只能由前端在用户点击里申请，
 * 所以它既要在第一次倒计时时自动申请，也要在这里留一个手动入口（用户可能拒过之后想改）。
 */
import { useState } from 'react';
import { GeneralTab } from '../settings/GeneralTab';
import { PluginsTab } from '../settings/PluginsTab';
import { ThemePicker } from '../settings/ThemePicker';
import { ensureNotifyPermission, notifyPermissionText } from '../../services/mobileNotify';
import { useMobileUiStore } from '../../stores/mobileUiStore';

type TabId = 'look' | 'plugins' | 'gen';

const TABS: readonly { id: TabId; label: string }[] = [
  { id: 'look', label: '外观' },
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
          void ensureNotifyPermission().then(() => setText(notifyPermissionText()));
        }}
      >
        申请
      </button>
    </div>
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
        {tab === 'plugins' && <PluginsTab showOpenDir={false} showPanels={false} />}
        {tab === 'gen' && (
          <>
            <GeneralTab showAutostart={false} />
            <div className="setting-group">
              <NotifyRow />
              <p className="m-hint">被拒绝时到点提醒只在应用内提示，不会发系统通知。</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
