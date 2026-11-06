/**
 * Timing — 设置 · 外观配色页签的「显示」卡（V0.3.3 从「通用」迁入）
 * -----------------------------------------------------------------------------
 * 每行都是**显示类**偏好，只存本机（localStorage），不写库：
 *   1. 悬浮形态：`useAppearanceStore.floatForm`（[V0.11.0] 悬浮条 / 小圆点）
 *   2. 文字不透明度：`useAppearanceStore.textOpacity`（下限 TEXT_OPACITY_MIN）
 *   3. 背景不透明度：`useAppearanceStore.bgOpacity`
 * 行尾只显示读数，不缀说明文字（「小条 / 便利贴」「除设置面板」这类解释已删，
 * 用户要的是读数，不是注解）。
 * [V0.3.5] 高亮颜色已并入「配色」卡（`HighlightColorRow`）——它本质是一个颜色，
 * 和四个主题色放在同一张卡里才成组。
 */
import { IS_MOBILE } from '../../lib/platform';
import { FLOAT_FORM_OPTIONS, TEXT_OPACITY_MIN, useAppearanceStore } from '../../stores/appearanceStore';
import { Slider } from '../ui/Slider';

export function AppearanceCard() {
  const floatForm = useAppearanceStore((s) => s.floatForm);
  const setFloatForm = useAppearanceStore((s) => s.setFloatForm);
  const textOpacity = useAppearanceStore((s) => s.textOpacity);
  const bgOpacity = useAppearanceStore((s) => s.bgOpacity);
  const setTextOpacity = useAppearanceStore((s) => s.setTextOpacity);
  const setBgOpacity = useAppearanceStore((s) => s.setBgOpacity);

  return (
    <section className="card">
      <h3 className="card__title">显示</h3>

      {/* [V0.11.0] 常驻形态：切换后立即生效（收起成点 / 展开成条），不重启。
          [V0.11.2] 手机端不渲染这一行：手机没有悬浮条也没有圆点，`MobileShell` 根本不读
          `collapsed`，切了界面零变化却把值写进 localStorage，回头在桌面生效，属于挖坑。 */}
      {!IS_MOBILE && (
        <div className="setting-row">
          <span className="setting-row__label">悬浮形态</span>
          <div className="seg seg--compact" role="group" aria-label="悬浮形态">
            {FLOAT_FORM_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className="seg__item"
                data-on={floatForm === option.id ? 'true' : 'false'}
                aria-pressed={floatForm === option.id}
                onClick={() => setFloatForm(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* [V0.2.2] 文字 / 背景不透明度（本机偏好，不写数据库；设置面板自身不受影响）
          [V0.11.10] 手机端不渲染这两行：它们写的是 App 内面板的 --ui-bg / --ui-text-opacity，
          而手机上的悬浮条是 Kotlin 原生窗口，根本不读这两个值——留着就是「拖了没反应」。
          悬浮条固定为透明底 + 不透明文字（见 overlay/Tk.kt）。 */}
      {!IS_MOBILE && (
        <>
          <div className="setting-row">
            <span className="setting-row__label">
              文字不透明度
              <span className="setting-row__hint">{Math.round(textOpacity * 100)}%</span>
            </span>
            <Slider
              label="文字不透明度"
              value={textOpacity}
              min={TEXT_OPACITY_MIN}
              onChange={setTextOpacity}
            />
          </div>

          <div className="setting-row">
            <span className="setting-row__label">
              背景不透明度
              <span className="setting-row__hint">{Math.round(bgOpacity * 100)}%</span>
            </span>
            <Slider label="背景不透明度" value={bgOpacity} onChange={setBgOpacity} />
          </div>
        </>
      )}
    </section>
  );
}
