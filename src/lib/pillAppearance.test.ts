/**
 * `parsePillPrefs` 的口径（[0.12.1 归一] 「Rust 送来的未知输入 → 归一化」的唯一入口）
 * -----------------------------------------------------------------------------
 * 这一层的错法只有一种，而且很难查：**把坏数据当成好数据**。所以调用方拿到的只能是
 * 两种结果 —— 归一化后的完整快照，或 `null`（= 保留现值，不拿默认值盖掉用户设置）。
 * 绝不允许「缺一半就当默认」，那会让悬浮条上出现一份谁都没配过的绑定。
 *
 * 变异自证：把 `parsePillHandles` 里的形状检查删掉（直接交给 `parseHandleBindings`），
 * `k2_*` 会变绿（因为它回落成默认而不是 null），正是要防的那种静默失效。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_HANDLE_BINDINGS } from './handleCatalog';
import { parsePillPrefs } from './pillAppearance';
import type { PillPrefs } from './pillAppearance';

/** 一份完整合法快照（槽位值都取自动作目录，归一后应逐字不变）。 */
function snapshot(): PillPrefs {
  return {
    appearance: { textOpacity: 0.6, bgOpacity: 0.4, floatForm: 'dot' },
    handles: {
      dot: { enabled: true, slots: { ...DEFAULT_HANDLE_BINDINGS.dot.slots } },
      half: { enabled: false, slots: { ...DEFAULT_HANDLE_BINDINGS.half.slots } },
      full: { enabled: true, slots: { ...DEFAULT_HANDLE_BINDINGS.full.slots } },
    },
  };
}

describe('parsePillPrefs', () => {
  it('k1_valid_snapshot_passes_through_unchanged', () => {
    const input = snapshot();
    expect(parsePillPrefs(input)).toEqual(input);
  });

  it('k2_missing_half_is_null_not_defaults', () => {
    const withoutAppearance = snapshot() as Partial<PillPrefs>;
    delete withoutAppearance.appearance;
    expect(parsePillPrefs(withoutAppearance)).toBeNull();

    const withoutHandles = snapshot() as Partial<PillPrefs>;
    delete withoutHandles.handles;
    expect(parsePillPrefs(withoutHandles)).toBeNull();

    /* handles 少一个形态也算「结构不齐」：宁可整份丢弃，也不拿默认绑定顶上去 */
    const missingForm = snapshot();
    delete (missingForm.handles as Partial<PillPrefs['handles']>).half;
    expect(parsePillPrefs(missingForm)).toBeNull();

    /* 外观少一个键同理 */
    const shortAppearance = snapshot();
    delete (shortAppearance.appearance as Partial<PillPrefs['appearance']>).bgOpacity;
    expect(parsePillPrefs(shortAppearance)).toBeNull();
  });

  it('k3_unknown_float_form_falls_back_to_bar', () => {
    /* **口径写死在这里**：形态是封闭枚举，陌生值等价于「旧版没这个值」→ 回落 `bar`
       （与 Rust `normalize_float_form`、前端 `normalizeFloatForm` 同一条规则）；
       只有「字段类型都不对」才是结构坏了，那种情况整份丢弃（见 k2）。 */
    const input = snapshot();
    input.appearance.floatForm = 'triangle' as PillPrefs['appearance']['floatForm'];
    expect(parsePillPrefs(input)?.appearance.floatForm).toBe('bar');
  });

  it('k4_unknown_action_id_becomes_null_slot', () => {
    const input = snapshot();
    input.handles.full.slots.left = 'ghost.action';
    const parsed = parsePillPrefs(input);
    expect(parsed).not.toBeNull();
    expect(parsed?.handles.full.slots.left).toBeNull();
    /* 合法槽位不受影响：坏 id 只影响它自己那个槽 */
    expect(parsed?.handles.full.slots.right).toBe(input.handles.full.slots.right);
  });

  it('k5_opacity_is_clamped_like_the_write_path', () => {
    const input = snapshot();
    input.appearance.textOpacity = 0.01;
    input.appearance.bgOpacity = 1.8;
    const parsed = parsePillPrefs(input);
    /* 0.2 = `TEXT_OPACITY_MIN`：读库与写盘必须夹到同一个区间，否则「存进去 0.2、读出来 0.01」 */
    expect(parsed?.appearance.textOpacity).toBe(0.2);
    expect(parsed?.appearance.bgOpacity).toBe(1);
  });

  it('k6_non_object_inputs_are_null', () => {
    expect(parsePillPrefs(null)).toBeNull();
    expect(parsePillPrefs(undefined)).toBeNull();
    expect(parsePillPrefs('pill')).toBeNull();
    expect(parsePillPrefs([])).toBeNull();
  });
});
