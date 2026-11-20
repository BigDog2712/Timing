import { describe, expect, it } from 'vitest';

import { previewReparentPath, reparentTagPath } from './reparent';

/**
 * 「拖动改分类」的判据表。
 *
 * 每条用例只钉**一个**理由：判据是有顺序的（见 reparent.ts 文件头），若一条用例
 * 同时踩中两条（比如既超深度又撞名），改错顺序也照样绿 —— 那这组测试就失去意义了。
 */
describe('拖动改分类 · reparentTagPath', () => {
  const existing = ['娱乐', '娱乐/燕云', '学习', '学习/考公', '工作'];

  it('挂到另一个标签下面：只换父，叶子名不变', () => {
    expect(reparentTagPath('学习/考公', '工作', existing)).toEqual({
      ok: true,
      next: '工作/考公',
    });
  });

  it('拖到一级：整条路径缩成叶子名', () => {
    expect(reparentTagPath('学习/考公', null, existing)).toEqual({ ok: true, next: '考公' });
  });

  it('拖回原位：判 same（面板据此不弹提示、不发意图）', () => {
    expect(reparentTagPath('学习/考公', '学习', existing)).toEqual({ ok: false, reason: 'same' });
    // 本来就一级，再拖到一级投放区也是「没动」
    expect(reparentTagPath('工作', null, existing)).toEqual({ ok: false, reason: 'same' });
  });

  it('拖到自己头上：判 self', () => {
    expect(reparentTagPath('学习/考公', '学习/考公', existing)).toEqual({
      ok: false,
      reason: 'self',
    });
  });

  it('拖进自己的子树：判 descendant（否则改名之后绕成环）', () => {
    expect(reparentTagPath('学习', '学习/考公', existing)).toEqual({
      ok: false,
      reason: 'descendant',
    });
    // 大小写不同也还是同一棵子树
    expect(reparentTagPath('Study', 'study/sub', ['Study', 'Study/sub'])).toEqual({
      ok: false,
      reason: 'descendant',
    });
  });

  it('刚好第 4 级是允许的', () => {
    const tree = ['学习/考公', '工作/技能/英语'];
    expect(reparentTagPath('学习/考公', '工作/技能/英语', tree)).toEqual({
      ok: true,
      next: '工作/技能/英语/考公',
    });
  });

  /**
   * 深度要**算子树**，不能只看「目标深度 + 1」：
   * `学习/考公` 搬到 3 级目标下面自己刚好是第 4 级，但它下面还挂着 `行测`，
   * `行测` 会变成第 5 级 —— 后端 `require_tag_path` 会把那一条跳过，
   * 用户看到的是「只搬了一半」。
   */
  it('子树跟着搬会超过 4 级：判 too-deep', () => {
    const tree = ['学习/考公', '学习/考公/行测', '工作/技能/英语'];
    expect(reparentTagPath('学习/考公', '工作/技能/英语', tree)).toEqual({
      ok: false,
      reason: 'too-deep',
    });
  });

  it('目标路径已存在：判 exists 且大小写不敏感（不静默合并两个标签）', () => {
    const tree = ['学习/Study', '工作', '工作/study'];
    expect(reparentTagPath('学习/Study', '工作', tree)).toEqual({ ok: false, reason: 'exists' });
    // 拖到一级撞名同样拒绝
    expect(reparentTagPath('学习/考公', null, ['学习/考公', '考公'])).toEqual({
      ok: false,
      reason: 'exists',
    });
  });

  it('单级超 32 字 / 整串超 64 字 / 空层级：判 invalid', () => {
    const long = 'a'.repeat(33);
    expect(reparentTagPath(`学习/${long}`, '工作', existing)).toEqual({
      ok: false,
      reason: 'invalid',
    });

    /* 3 级各 20 字的目标（62 字）+ `/考公` = 65 字，越过 64 上限 */
    const deep = ['a'.repeat(20), 'a'.repeat(20), 'a'.repeat(20)].join('/');
    expect(reparentTagPath('学习/考公', deep, existing)).toEqual({ ok: false, reason: 'invalid' });

    expect(reparentTagPath('学习//考公', '工作', existing)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('previewReparentPath 把「会变成什么」算给文案用，不做判据', () => {
    expect(previewReparentPath('学习/考公', '工作')).toBe('工作/考公');
    expect(previewReparentPath('学习/考公', null)).toBe('考公');
    // 即使这次拖动会被拒，也照样算出路径 —— 拒绝文案要用它说清撞的是哪个
    expect(previewReparentPath('学习/考公', '工作')).toBe('工作/考公');
  });
});
