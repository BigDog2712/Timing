/**
 * QA 复验 · V0.11.18 A6（纯函数半场）：`isCloudReady` 与后端 `is_usable()` 的十档对齐。
 * -----------------------------------------------------------------------------
 * 与 `src-tauri/src/tests/qa_usable_parity.rs` 是**同一张表**（同样十档、同样顺序、同样
 * 名字）。前端这份判据是**复制**来的（视图拿不到云端字段本身，加字段等于改契约 78），
 * 复制体的唯一保险就是「两边对着同一张表各自断言一遍」。
 *
 * 这张表不是从实现抄的，是逐条读 `models/md_sync_cloud.rs::is_usable` 后手写的：
 * `!enabled → false`；`localfolder` 只看 `localRoot.trim()`；`webdav` 要
 * `baseUrl` + `basePath` + `user` 三个 trim 后非空；密码不参与。
 *
 * 四档陷阱（顺序与断言文本里的对齐，不要重排）：
 * - 3：`localRoot` 只有空格 → 假；
 * - 5：`localfolder` + 落点有值、WebDAV 三件套全空 → **真**（那条路不发网络请求）；
 * - 8：`baseUrl` 只有空格 → 假；
 * - 10：字段都留着、`enabled: false` → 假。
 */
import { describe, expect, it } from 'vitest';
import type { MdSyncCloud } from '../../types/domain';
import { emptyCloud, isCloudReady } from './mdSyncConfig';

const webdav = (baseUrl: string, basePath: string, user: string): MdSyncCloud => ({
  enabled: true,
  mode: 'webdav',
  localRoot: '',
  baseUrl,
  basePath,
  user,
});

const folder = (localRoot: string): MdSyncCloud => ({
  enabled: true,
  mode: 'localfolder',
  localRoot,
  baseUrl: '',
  basePath: '',
  user: '',
});

/** 十档验收表：必须与 Rust `qa_usable_parity.rs::table()` 逐档相同 */
const CASES: [string, MdSyncCloud, boolean][] = [
  ['1 · localfolder + 通道关着（enabled:false，字段都留着）', { ...folder('D:\\md'), enabled: false }, false],
  ['2 · localfolder + 落点为空', folder(''), false],
  ['3 · localfolder + 落点只有空格', folder('   '), false],
  ['4 · localfolder + 落点有值', folder('D:\\Nutstore\\Timing'), true],
  ['5 · localfolder + 落点有值、WebDAV 三件套全空（不影响）', folder('D:\\md'), true],
  ['6 · webdav + 三件套全空', webdav('', '', ''), false],
  ['7 · webdav + 只缺 user', webdav('https://dav.jianguoyun.com/dav/', '/Timing', ''), false],
  ['8 · webdav + baseUrl 只有空格', webdav('   ', '/Timing', 'me@example.com'), false],
  ['9 · webdav + 三件套填全', webdav('https://dav.jianguoyun.com/dav/', '/Timing', 'me@example.com'), true],
  [
    '10 · webdav 填全但 enabled=false（配过、现在只用本地）',
    { ...webdav('https://dav.jianguoyun.com/dav/', '/Timing', 'me@example.com'), enabled: false },
    false,
  ],
];

describe('QA · A6 `isCloudReady` 与后端 `is_usable` 同口径', () => {
  it.each(CASES)('%s', (_name, cloud, expected) => {
    expect(isCloudReady(cloud)).toBe(expected);
  });

  it('把十档一次性铺开比一遍（红的时候能看到是哪一档先崩）', () => {
    const actual = CASES.map(([name, cloud, expected]) => ({
      name,
      expected,
      got: isCloudReady(cloud),
    }));
    expect(actual.filter((row) => row.got !== row.expected)).toEqual([]);
  });

  it('`emptyCloud()`（从没配过云端时的草稿）不算填全', () => {
    /* 这个组合在真机上一定出现：cloud === null → draft.cloud = emptyCloud()，
       若它被判成「填全」，新用户一进设置页就会看到「今天还没上传」而不是 A6 那句话。 */
    expect(isCloudReady(emptyCloud())).toBe(false);
    expect(emptyCloud().enabled).toBe(false);
  });

  it('判据只看传入的那份配置，不读全局状态（同一个入参永远同一个答案）', () => {
    const cloud = webdav('https://dav.jianguoyun.com/dav/', '/Timing', 'me@example.com');
    expect([isCloudReady(cloud), isCloudReady(cloud), isCloudReady(cloud)]).toEqual([true, true, true]);
  });
});
