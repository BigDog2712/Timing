/**
 * mdSyncConfig 的判据（[0.12.1] T04b：从 `src/components/settings/mdSyncConfig.test.ts` 搬来）
 * -----------------------------------------------------------------------------
 * 搬家方式：**逐字搬运 + 只改 import 路径**（`types/domain` → `./hostTypes`；模块本身在
 * 同一层，`./mdSyncConfig` 不用改）。逻辑一个字没动，所以下面注释里说的「与后端同口径」
 * 仍然成立，不必重读。
 *
 * 为什么必须补这一份：旧测试随旧组件删掉了，而本文件测的是**桌面实际运行的那份**
 * （`src/components/settings/mdSyncConfig.ts` 只剩手机端在用）。只测手机副本等于只测
 * 一份没人在跑的实现 —— 桌面这份零覆盖时，`channelToSave` 的「防空壳」防线是裸的。
 */

import { describe, expect, it } from 'vitest';
import type { MdSyncCloud, MdSyncCloudChannel } from './hostTypes';
import {
  channelToSave,
  emptyCloud,
  emptyLocal,
  emptyWebdav,
  isCloudReady,
  isLocalReady,
  isWebdavReady,
  legacyCloudForTest,
} from './mdSyncConfig';

/* [V0.11.26] 本文件钉的是「两条通路各自的纯判据」：
   `isLocalReady` / `isWebdavReady`（填没填全）、`channelToSave`（保存前归一）、
   `legacyCloudForTest`（测试连接载荷）。
   **与后端同口径**：`models/md_sync_channel.rs::is_usable_folder / is_usable_webdav`、
   `services/md_sync/config.rs::load/save`，改一边必须改另一边。

   旧的 `channelOf / withChannel / cloudToSave` 已随通道选择器一起退场（PRD 变更一），
   它们原来的用例按「迁移 / 互不触碰 / 防空壳」三件事平移到这里（O11–O13）。 */

/** 一份「配过、且现在开着」的 folder 通路（主人真实配置的形状） */
function folderChannel(over: Partial<MdSyncCloudChannel> = {}): MdSyncCloudChannel {
  return { enabled: true, localRoot: 'D:\\Nutstore\\我的坚果云\\TimingMD', ...over };
}

/** 一份「配过、且现在开着」的 webdav 通路 */
function webdavChannel(over: Partial<MdSyncCloudChannel> = {}): MdSyncCloudChannel {
  return {
    enabled: true,
    baseUrl: 'https://dav.jianguoyun.com/dav/',
    basePath: '/Timing',
    user: 'me@example.com',
    ...over,
  };
}

describe('emptyLocal / emptyWebdav —— 两块的空配置', () => {
  it('两条通路默认都关着（凭空 true 会在下一次保存偷偷打开它）', () => {
    expect(emptyLocal().enabled).toBe(false);
    expect(emptyWebdav().enabled).toBe(false);
  });

  it('块⑤ 预填服务地址与远端目录（最常见那台服务器开箱可用）', () => {
    expect(emptyWebdav().baseUrl).toBe('https://dav.jianguoyun.com/dav/');
    expect(emptyWebdav().basePath).toBe('/Timing');
    expect(emptyWebdav().user).toBe('');
  });

  it('块④ 不给默认落点目录：没有「常见目录」这种东西', () => {
    expect(emptyLocal().localRoot).toBe('');
  });
});

describe('channelToSave —— 逐通路归一（承接地：防空壳）', () => {
  it('从没配过 + 通路关着 → 落 null（与新装同形）', () => {
    expect(channelToSave(emptyLocal(), false)).toBeNull();
    expect(channelToSave(emptyWebdav(), false)).toBeNull();
  });

  it('从没配过 + 真的开了 → 落对象（他确实想开这条通路）', () => {
    const channel = { ...emptyWebdav(), enabled: true, user: 'me@example.com' };
    expect(channelToSave(channel, false)).toEqual(channel);
  });

  it('配过 + 现在关着 → 原样保留（关掉不删配置，CH4 的继承者）', () => {
    const channel = folderChannel({ enabled: false });
    expect(channelToSave(channel, true)).toEqual(channel);
  });

  it('这条是防线不是细节：「开一下再关掉」不许凭空造出一个空壳对象', () => {
    /* 复现路径：从没配过 → 打开块⑤ → 又关掉 → 保存。
       若直接用草稿里的通路对象，落库就是一个「像配过」的壳，块⑤ 的 `xxxConfigured`
       变 true、以后再也回不到「从未配置」那种与新装同形的 JSON（O13）。 */
    const shell = { ...emptyWebdav(), enabled: true };
    const closed = { ...shell, enabled: false };
    expect(channelToSave(closed, false)).toBeNull();
  });
});

describe('isLocalReady —— 块④「开了且填了落点目录」', () => {
  it('关着 → 不算（后端 `usable_folder` 同样先判 enabled）', () => {
    expect(isLocalReady(folderChannel({ enabled: false }))).toBe(false);
    expect(isLocalReady(emptyLocal())).toBe(false);
  });

  it('空 / 全空白都不算填了', () => {
    expect(isLocalReady(folderChannel({ localRoot: '' }))).toBe(false);
    expect(isLocalReady(folderChannel({ localRoot: '   ' }))).toBe(false);
  });

  it('地址 / 账号空着也不扣分（这条通路一次网络请求都不发）', () => {
    /* 多余的 webdav 字段不参与判据：传进去也不算「填全了」的一部分 */
    const channel = { enabled: true, localRoot: 'D:\\md', baseUrl: '', user: '' };
    expect(isLocalReady(channel)).toBe(true);
  });
});

describe('isWebdavReady —— 块⑤「开了且三件套齐」', () => {
  it('关着 → 不算', () => {
    expect(isWebdavReady(webdavChannel({ enabled: false }))).toBe(false);
    expect(isWebdavReady(emptyWebdav())).toBe(false);
  });

  it('baseUrl / basePath / user 三个缺一不可（逐项扫一遍，漏一个就是假绿）', () => {
    expect(isWebdavReady(webdavChannel())).toBe(true);
    expect(isWebdavReady(webdavChannel({ baseUrl: '' }))).toBe(false);
    expect(isWebdavReady(webdavChannel({ basePath: '  ' }))).toBe(false);
    expect(isWebdavReady(webdavChannel({ user: '' }))).toBe(false);
  });

  it('密码不参与判定：它不在通路结构里（密文归后端 keychain）', () => {
    /* 结构上就没有这个字段 —— 这条断言的作用是「有人给类型加 password 时这里会提醒他
       去同步改后端 `is_usable_webdav`」，而不是在测一个不存在的属性。 */
    expect(Object.keys(webdavChannel())).toEqual(['enabled', 'baseUrl', 'basePath', 'user']);
  });
});

describe('legacyCloudForTest —— 测试连接的载荷（红线 probe.rs 只认旧形状）', () => {
  it('按被测通路现拼：mode 由调用方给，其余字段原样带过去', () => {
    const payload = legacyCloudForTest('localfolder', folderChannel({ auto: undefined }));
    expect(payload.mode).toBe('localfolder');
    expect(payload.localRoot).toBe('D:\\Nutstore\\我的坚果云\\TimingMD');
    expect(legacyCloudForTest('webdav', webdavChannel()).user).toBe('me@example.com');
  });

  it('`enabled` 恒 true：探测是只读动作，不该被开关拦（PRD §4.3）', () => {
    expect(legacyCloudForTest('webdav', emptyWebdav()).enabled).toBe(true);
    expect(legacyCloudForTest('localfolder', emptyLocal()).enabled).toBe(true);
  });

  it('缺项原样传空串，让后端给既有错误文案（前端不自己编一句）', () => {
    expect(legacyCloudForTest('webdav', emptyWebdav()).user).toBe('');
  });
});

describe('emptyCloud / isCloudReady —— 手机端红线面板仍在用的兼容层', () => {
  /* `components/mobile` 全目录零 diff：那两个面板读的还是 legacy `cloud`。
     这里钉住「兼容层没有第二份判据」——它按 mode 转发到上面两个函数。 */

  function legacy(over: Partial<MdSyncCloud> = {}): MdSyncCloud {
    return {
      enabled: true,
      mode: 'webdav',
      localRoot: '',
      baseUrl: 'https://dav.jianguoyun.com/dav/',
      basePath: '/Timing',
      user: 'me@example.com',
      ...over,
    };
  }

  it('emptyCloud() 与 emptyWebdav() 同形（同一份预填值）', () => {
    const cloud = emptyCloud();
    expect(cloud.mode).toBe('webdav');
    expect(cloud.baseUrl).toBe(emptyWebdav().baseUrl);
    expect(cloud.basePath).toBe(emptyWebdav().basePath);
    expect(cloud.enabled).toBe(false);
  });

  it('localfolder 走 isLocalReady、webdav 走 isWebdavReady（不另写一份 if）', () => {
    const local = legacy({ mode: 'localfolder', localRoot: 'D:\\md' });
    expect(isCloudReady(local)).toBe(isLocalReady(local));
    const webdav = legacy({ user: '' });
    expect(isCloudReady(webdav)).toBe(isWebdavReady(webdav));
    expect(isCloudReady(webdav)).toBe(false);
  });
});
