/**
 * TickBar — 设置 · 外观配色页签的「显示」卡（V0.3.3 从「通用」迁入）
 * -----------------------------------------------------------------------------
 * 两行都是**显示类**偏好，只存本机（localStorage），不写库：
 *   1. 文字不透明度：`useAppearanceStore.textOpacity`（下限 TEXT_OPACITY_MIN）
 *   2. 背景不透明度：`useAppearanceStore.bgOpacity`
 * 行尾只显示百分比，不缀任何说明文字（「小条 / 便利贴」「除设置面板」这类解释已删，
 * 用户要的是读数，不是注解）。
 * [V0.3.5] 高亮颜色已并入「配色」卡（`HighlightColorRow`）——它本质是一个颜色，
 * 和四个主题色放在同一张卡里才成组，本卡只剩两条不透明度。
 */
import { TEXT_OPACITY_MIN, useAppearanceStore } from '../../stores/appearanceStore';
import { Slider } from '../ui/Slider';

export function AppearanceCard() {
  const textOpacity = useAppearanceStore((s) => s.textOpacity);
  const bgOpacity = useAppearanceStore((s) => s.bgOpacity);
  const setTextOpacity = useAppearanceStore((s) => s.setTextOpacity);
  const setBgOpacity = useAppearanceStore((s) => s.setBgOpacity);

  return (
    <section className="card">
      <h3 className="card__title">显示</h3>

      {/* [V0.2.2] 文字 / 背景不透明度（本机偏好，不写数据库；设置面板自身不受影响） */}
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
    </section>
  );
}
