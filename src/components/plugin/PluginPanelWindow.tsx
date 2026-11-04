/**
 * TickBar — 插件面板窗口（label `panel-{pluginId}-{panelId}`，apiVersion 3）
 * -----------------------------------------------------------------------------
 * 这扇窗是「别人能给应用加功能」的落点：插件的 `plugin.json` 声明面板长什么样，
 * 宿主按声明渲染。插件本身仍然不执行任何代码（`docs/plugin-spec.md` §1）。
 *
 * 面板定义从 `plugin_list` 里取——不另开一条「读某个插件」的命令：
 * 设置页刚读过的那份清单就是权威来源，多一条命令只会多一处要同步的词表。
 *
 * 身份不在 label 里：插件 id 与面板 id 都允许含 `-`，反解会切错（见 `lib/window`）。
 */
import { useEffect, useState } from 'react';
import { PanelBlockView } from './PanelBlockView';
import { usePluginStore } from '../../stores/pluginStore';
import { closeCurrentWindow, currentPanelTarget, showCurrentWindowOnReady } from '../../lib/window';

export function PluginPanelWindow() {
  const target = currentPanelTarget();
  const plugins = usePluginStore((s) => s.plugins);
  const loaded = usePluginStore((s) => s.loaded);
  const load = usePluginStore((s) => s.load);
  const [notice, setNotice] = useState<string | null>(null);

  /* K-18 防白闪：窗口是 visible:false 建的，首帧就绪后自己 show。 */
  useEffect(() => showCurrentWindowOnReady(), []);
  useEffect(() => {
    void load();
  }, [load]);

  const plugin = target ? plugins.find((item) => item.id === target.pluginId) : undefined;
  const panel = plugin?.panels.find((item) => item.id === target?.panelId);

  const bar = (title: string, sub: string) => (
    <header className="plgp__bar" data-tauri-drag-region>
      <div className="plgp__head">
        <span className="plgp__title">{title}</span>
        <span className="plgp__src">{sub}</span>
      </div>
      <button
        type="button"
        className="plgp__close"
        aria-label="关闭面板"
        onClick={() => void closeCurrentWindow()}
      >
        ×
      </button>
    </header>
  );

  if (!target) {
    return (
      <div className="plgp">
        {bar('插件面板', '缺少参数')}
        <p className="plgp__muted">这个窗口没有指定插件面板，直接关掉即可。</p>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="plgp">
        {bar('插件面板', '读取中')}
        <p className="plgp__muted">正在读取插件…</p>
      </div>
    );
  }

  if (!plugin) {
    return (
      <div className="plgp">
        {bar('插件面板', target.pluginId)}
        <p className="plgp__error">
          找不到插件「{target.pluginId}」。它可能已被删除或停用——到「设置 → 插件」点「重新加载」。
        </p>
      </div>
    );
  }

  if (!panel) {
    return (
      <div className="plgp">
        {bar(plugin.name, plugin.id)}
        <p className="plgp__error">这个插件没有声明 id 为「{target.panelId}」的面板。</p>
      </div>
    );
  }

  return (
    <div className="plgp">
      {bar(panel.title, plugin.name)}
      <div className="plgp__body">
        {panel.blocks.map((block, index) => (
          <PanelBlockView key={`${block.type}-${index}`} block={block} onOutcome={setNotice} />
        ))}
      </div>
      {notice && <footer className="plgp__notice">{notice}</footer>}
    </div>
  );
}
