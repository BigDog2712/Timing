/**
 * Timing — 药丸快捷新建的附加项 QuickAddExtras（0.13.x 主人口径）
 * -----------------------------------------------------------------------------
 * 「悬浮窗快捷添加事项时，应可绑定标签，支持 AI 自动填标签，支持绑定应用」。
 * 名称仍在条上的内联输入框里输；这里挂在常用事项框的**框底**，只在新建流程
 * （`openCommonItemsNew`，`inlineEdit.itemId === null`）出现：
 *   - 标签：复用 `PanelTagField`（回车 / 逗号确认、datalist 候选、AI 按名称建议）；
 *   - 应用：最近 8 个前台应用（`useRecentAppsStore`，来自追踪引擎广播），点一下即选中，
 *     再点取消；不新增任何选择器或 IPC；
 *   - 「开始」：与条上回车同一出口（`usePillInlineEdit`），标签 / 应用在创建后落到
 *     `item_tags` / `item_app`。
 *
 * 为什么不把这三样塞进条里：条是固定高度的单行控件，浮出来的框本来就在条下方，
 * 焦点离开输入框时 InlineNameEntry 会先看焦点是否落在菜单内再决定要不要取消。
 */
import { useEffect, useState } from 'react';

import { usePillInlineEdit } from '../../hooks/usePillInlineEdit';
import { useQuickAddStore } from '../../stores/quickAddStore';
import { useRecentAppsStore } from '../../stores/recentApps';
import { loadTagOptions, PanelTagField } from '../panel/PanelTagField';
import '../../styles/quick-add.css';

export function QuickAddExtras() {
  const name = useQuickAddStore((s) => s.name);
  const tags = useQuickAddStore((s) => s.tags);
  const appKey = useQuickAddStore((s) => s.appKey);
  const appLabel = useQuickAddStore((s) => s.appLabel);
  const setTags = useQuickAddStore((s) => s.setTags);
  const setApp = useQuickAddStore((s) => s.setApp);
  const recentApps = useRecentAppsStore((s) => s.apps);
  const submit = usePillInlineEdit();
  const [options, setOptions] = useState<string[]>([]);
  const [hint, setHint] = useState('');

  /* 候选只是 datalist / AI 的参考，读失败不影响建事项：静默降级成「只能手输新标签」 */
  useEffect(() => {
    let alive = true;
    void loadTagOptions()
      .then((list) => {
        if (alive) setOptions(list);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  /* 选中的应用被挤出「最近 8 条」时也要能看到它（否则用户以为没选上） */
  const apps =
    appKey && !recentApps.some((app) => app.key === appKey)
      ? [{ key: appKey, label: appLabel ?? appKey }, ...recentApps]
      : recentApps;

  const start = () => {
    const text = name.trim();
    if (!text) {
      setHint('先在上方输入事项名称');
      document.querySelector<HTMLInputElement>('.pill__input')?.focus();
      return;
    }
    submit(text);
  };

  return (
    <div className="quick-add">
      <PanelTagField
        value={tags}
        options={options}
        onChange={setTags}
        onHint={setHint}
        suggestText={name}
      />
      <div className="quick-add__apps" role="group" aria-label="绑定应用">
        <span className="quick-add__label">应用</span>
        {apps.length === 0 ? (
          <span className="quick-add__empty">切到目标应用后再回来，这里会列出最近用过的</span>
        ) : (
          apps.map((app) => {
            const on = app.key === appKey;
            return (
              <button
                key={app.key}
                type="button"
                className="quick-add__app"
                data-current={on ? 'true' : 'false'}
                aria-pressed={on}
                title={on ? `取消绑定 ${app.label}` : `绑定到 ${app.label}（切到它就自动计时）`}
                onClick={() => setApp(on ? null : app.key, on ? null : app.label)}
              >
                {app.label}
              </button>
            );
          })
        )}
      </div>
      {hint && (
        <p className="quick-add__hint" role="status">
          {hint}
        </p>
      )}
      <div className="quick-add__actions">
        <button type="button" className="quick-add__start" onClick={start}>
          开始
        </button>
      </div>
    </div>
  );
}