/**
 * TickBar — 设置 · 插件页签（V0.3.4 由「扩展」改名并砍掉内置功能展示）
 * -----------------------------------------------------------------------------
 * 历史：V0.3.2 实装真实插件列表（原文件 `ExtensionsTab.tsx`，类名 `.ext__*`）。
 * V0.3.4 起两处变化（ADR-023）：
 *   1. **页签名改「插件」**——插件是用户放进目录的东西，叫「扩展」会和浏览器扩展
 *      混淆，也说不清「这里为什么什么都没有」。
 *   2. **不再展示任何内置功能**：出厂快捷计时（摸鱼菜单那三条）是应用自带行为，
 *      不是可以装/卸的插件。它的实体在后端 `builtin_quick_timers()` 里继续作为合并
 *      底座存在，但设置页不再单列一块——列出来只会让人以为能删掉它。
 *
 * 展示的是**磁盘事实**：读不到 / JSON 不合法 / apiVersion 过高的插件也会列出来，
 * 并在行内直接给出原因（`plugin.error`）——静默消失才是最难排查的形态。
 *
 * 插件是声明式的（读启动头 `plugin.json`，不执行插件代码），所以这里没有
 * 启用/停用开关：`enabled` 写在启动头里，改文件 + 重新加载即可。
 */
import { useEffect } from 'react';
import { formatMinutes } from '../../lib/format';
import { pluginApi } from '../../services/api';
import { MD_SYNC_KIND_LABELS } from '../../types/domain';
import { usePluginStore } from '../../stores/pluginStore';
import type { PluginInfo, PluginSource } from '../../types/domain';

const SOURCE_LABEL: Record<PluginSource, string> = {
  dev: '开发',
  exe: '随包',
  user: '用户',
};

function contributions(plugin: PluginInfo): string {
  const parts: string[] = [];
  if (plugin.quickTimers.length > 0) {
    const items = plugin.quickTimers
      .map((quick) => `${quick.item} ${formatMinutes(quick.minutes * 60)}`)
      .join(' · ');
    parts.push(`快捷计时 ${plugin.quickTimers.length} 项：${items}`);
  }
  if (plugin.mdSync && plugin.mdSync.bindings.length > 0) {
    const kinds = plugin.mdSync.bindings
      .map((binding) => MD_SYNC_KIND_LABELS[binding.kind])
      .join(' · ');
    parts.push(`Markdown 同步 ${plugin.mdSync.bindings.length} 个落点：${kinds}`);
  }
  return parts.length > 0 ? parts.join('；') : '无贡献项';
}

interface PluginsTabProps {
  /**
   * 是否显示「打开目录」。移动端传 false（PRD §5 D16：手机没有资源管理器可跳，
   * 后端 `plugin_open_dir` 为移动桩返回 IO_ERROR）。桌面不传 = true，行为不变。
   */
  showOpenDir?: boolean;
}

export function PluginsTab({ showOpenDir = true }: PluginsTabProps) {
  const plugins = usePluginStore((s) => s.plugins);
  const dir = usePluginStore((s) => s.dir);
  const loaded = usePluginStore((s) => s.loaded);
  const loading = usePluginStore((s) => s.loading);
  const error = usePluginStore((s) => s.error);
  const load = usePluginStore((s) => s.load);

  useEffect(() => {
    void load();
  }, [load]);

  /* 空态只在**首次扫描完成之后**成立：`plugins` 初值是空数组，若只看长度，
     打开页签的第一帧会闪一句「还没有安装插件」再跳成真实列表。 */
  const isEmpty = loaded && plugins.length === 0 && !error;

  return (
    <div className="plg">
      {/* 顶部路径栏 + 打开目录 + 重新加载必须保留：没有它们用户无法把插件放进目录。 */}
      <div className="plg__bar">
        <span className="plg__path" title={dir}>
          {dir || '正在定位插件目录…'}
        </span>
        {showOpenDir && (
          <button type="button" className="btn btn--ghost plg__btn" onClick={() => void pluginApi.openDir()}>
            打开目录
          </button>
        )}
        <button
          type="button"
          className="btn btn--neutral plg__btn"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? '加载中…' : '重新加载'}
        </button>
      </div>

      {error && <p className="plg__error">{error}</p>}

      {isEmpty ? (
        <p className="plg__empty">还没有安装插件。把插件文件夹放进上面的目录，点「重新加载」即可。</p>
      ) : (
        <ul className="plg__list">
          {plugins.map((plugin) => {
            const broken = plugin.error != null;
            return (
              <li key={plugin.id} className="plg__item" data-broken={broken ? 'true' : 'false'}>
                <div className="plg__head">
                  <span className="plg__name">{plugin.name}</span>
                  <span className="plg__tag" data-source={plugin.source}>
                    {SOURCE_LABEL[plugin.source] ?? plugin.source}
                  </span>
                  {plugin.version && <span className="plg__ver">v{plugin.version}</span>}
                  {!plugin.enabled && !broken && <span className="plg__ver">已停用</span>}
                </div>
                {plugin.description && <p className="plg__desc">{plugin.description}</p>}
                <p className="plg__meta">{contributions(plugin)}</p>
                {/* 同 id 可能同时躺在 dev / exe / user 三处：把这份到底从哪读来的写出来，
                    否则「我改的文件没生效」只能靠猜（先到先得规则在 plugin.rs）。 */}
                {plugin.dir && (
                  <p className="plg__dir" title={plugin.dir}>
                    {plugin.dir}
                  </p>
                )}
                {broken && <p className="plg__error">未能载入：{plugin.error}</p>}
              </li>
            );
          })}
        </ul>
      )}

      <p className="plg__hint">
        plugins 目录下每个文件夹是一个插件，必须有启动头 <code>plugin.json</code>。
        改动后点「重新加载」即可生效，无需重启。
      </p>
    </div>
  );
}
