import { describe, expect, it } from 'vitest';
import type { MdSyncCloud } from '../../types/domain';
import { channelOf, cloudToSave, emptyCloud, withChannel } from './mdSyncConfig';

/* [V0.11.18] T1 的**单一真相**在这里被钉死：`cloud.enabled` 就是存储通道。
   本文件只测三个纯函数，不挂载组件——「界面上有没有真的用上」由
   `mdSyncChannel.test.tsx` 管。 */

/** 一份「配过、且现在只用本地」的真实形态：地址 / 目录 / 账号都有值（主人真实配置就是这样） */
function configured(over: Partial<MdSyncCloud> = {}): MdSyncCloud {
  return {
    enabled: true,
    mode: 'localfolder',
    localRoot: 'D:\\Nutstore\\我的坚果云\\TimingMD',
    baseUrl: 'https://dav.jianguoyun.com/dav/',
    basePath: '/Timing',
    user: 'me@example.com',
    ...over,
  };
}

describe('channelOf —— 通道的唯一判据', () => {
  it('enabled:true → 本地 + 云端（老用户零迁移：他存的就是 true）', () => {
    expect(channelOf(configured({ enabled: true }))).toBe('both');
  });

  it('enabled:false → 只用本地（不是「没配置」，是「配过但现在不跑云端」）', () => {
    expect(channelOf(configured({ enabled: false }))).toBe('local');
  });

  it('emptyCloud() → 只用本地（从没配过云端的人的默认态）', () => {
    expect(channelOf(emptyCloud())).toBe('local');
  });
});

describe('withChannel —— 切通道只动 enabled', () => {
  it('切到只用本地：enabled 变 false，地址 / 目录 / 账号一个不丢（CH4）', () => {
    const before = configured({ enabled: true });
    const after = withChannel(before, 'local');
    expect(after.enabled).toBe(false);
    /* 逐字段比：少保留一个字段，就等于用户切一次通道丢一次配置 */
    expect(after.mode).toBe(before.mode);
    expect(after.localRoot).toBe(before.localRoot);
    expect(after.baseUrl).toBe(before.baseUrl);
    expect(after.basePath).toBe(before.basePath);
    expect(after.user).toBe(before.user);
  });

  it('切回本地 + 云端：enabled 变 true，其余同样原样', () => {
    const before = configured({ enabled: false });
    const after = withChannel(before, 'both');
    expect(after.enabled).toBe(true);
    expect(after.baseUrl).toBe(before.baseUrl);
    expect(after.user).toBe(before.user);
  });

  it('不原地改对象（React 的 setState 靠引用变化才知道要重渲染）', () => {
    const before = configured({ enabled: true });
    expect(withChannel(before, 'local')).not.toBe(before);
    expect(before.enabled).toBe(true);
  });
});

describe('cloudToSave —— 保存前的归一', () => {
  it('从没配过 + 停在只用本地 → 落 null（与 v0.11.17 零 diff）', () => {
    expect(cloudToSave(emptyCloud(), false)).toBeNull();
  });

  it('从没配过 + 选了本地 + 云端 → 落对象（他真的想开云端）', () => {
    const cloud = withChannel(emptyCloud(), 'both');
    expect(cloudToSave(cloud, false)).toEqual(cloud);
  });

  it('配过 + 停在只用本地 → 原样保留（CH4：地址 / 目录 / 账号都在库里）', () => {
    const cloud = configured({ enabled: false });
    expect(cloudToSave(cloud, true)).toEqual(cloud);
  });

  it('这条是防线不是细节：不归一时「点两下」会凭空造出一个空壳 cloud 对象', () => {
    /* 复现路径：从没配过 → 点「本地 + 云端」→ 点回「只用本地」→ 保存。
       若直接用草稿里的 cloud，落库就是一个「像配过」的对象，`cloudConfigured` 变 true、
       块④ 从此默认展开。归一之后是 null。 */
    const shell = withChannel(withChannel(emptyCloud(), 'both'), 'local');
    expect(shell).toEqual(emptyCloud());
    expect(cloudToSave(shell, false)).toBeNull();
  });
});
