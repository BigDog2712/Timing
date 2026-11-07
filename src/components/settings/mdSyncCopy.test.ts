import { describe, expect, it } from 'vitest';
import {
  CLOSED_TIER_SUFFIX,
  CLOUD_DIR_HINT,
  COPY,
  EXPLAIN_KEYS,
  MIXED_ROOT_PREFIX,
  REMOVED_PHRASES,
  SHORT_PATH_MAX,
  affectedNoteFor,
  mixedFileNote,
  mixedRootNote,
  mixedRootTitle,
  shortPath,
} from './mdSyncCopy';

/* [V0.11.16] PRD 4.0 的文案表在这里**再抄一遍**（不是 import 常量自比自）。
   两份独立转录才能抓住错字：常量被改错一个字，`toBe` 立刻红。
   本文件只做纯字符串比对，不挂载组件——组件里的「有没有真的用上」由
   `mdSyncLayout.test.tsx` / `MdSyncTab.test.tsx` 管。 */

/** PRD 4.0「改成」一栏的逐字转录（手抄，不许从 `COPY` 取） */
const EXPECTED = {
  C3: '日记文件名 + 三段标题。',
  C6: '可用 {date}，也可加后缀，如 {date}-asd.md',
  C8: '只改这三个标题下面的内容，日记其他内容不动。',
  C9: '数据库和备份放这里。',
  C11: '这三档落点跟着数据根一起搬。',
  C14: '日记本：双向，保留你手写的内容。',
  C16: '1 分钟 ~ 24 小时',
  C19: '多端一致用：体积小，读得快。',
  C21: '覆盖前留的底，可打开、可恢复。',
} as const;

const VALUES = Object.values(COPY);

describe('mdSyncCopy —— PRD 4.0 逐字常量表', () => {
  it('八句正文与 PRD 4.0 逐字一致（C16 已随同步间隔一起删除）', () => {
    expect(COPY.formatHint).toBe(EXPECTED.C3);
    expect(COPY.fileTemplateNote).toBe(EXPECTED.C6);
    expect(COPY.safeNote).toBe(EXPECTED.C8);
    expect(COPY.dataRootHint).toBe(EXPECTED.C9);
    expect(COPY.affectedNote).toBe(EXPECTED.C11);
    expect(COPY.syncHint).toBe(EXPECTED.C14);
    expect(COPY.cloudHint).toBe(EXPECTED.C19);
    expect(COPY.backupHint).toBe(EXPECTED.C21);
  });

  it('C1 / C16：间隔文案整句进 REMOVED_PHRASES，常量表里零命中', () => {
    expect(COPY).not.toHaveProperty('intervalNote');
    expect(REMOVED_PHRASES).toContain(EXPECTED.C16);
    expect(REMOVED_PHRASES).toContain('同步间隔');
    for (const value of VALUES) expect(value).not.toContain(EXPECTED.C16);
    for (const value of VALUES) expect(value).not.toContain('同步间隔');
  });

  it('A1b：解释性长句恰好 4 句，且都不超过 20 字、也不许再长回来', () => {
    expect([...EXPLAIN_KEYS].sort()).toEqual(['cloudHint', 'dataRootHint', 'formatHint', 'syncHint']);
    for (const key of EXPLAIN_KEYS) {
      expect(COPY[key].length).toBeLessThanOrEqual(20);
    }
    /* 全表最长的两句是操作指令与安全句（C6 / C8），不是解释：给它们一个上限，
       超过就说明又有人在常量表里写段落了。 */
    for (const value of VALUES) expect(value.length).toBeLessThanOrEqual(40);
    expect(COPY.fileTemplateNote.length).toBeGreaterThan(20);
    expect(COPY.safeNote.length).toBeGreaterThan(20);
  });

  it('A2：被删掉的句子仍留在 REMOVED_PHRASES 里（供全页零命中断言）', () => {
    /* [V0.11.18] 追加 3 条：两条旧 hint（MD1 / CL7）+ 块④ 那个 Switch 的标签 */
    expect([...REMOVED_PHRASES]).toEqual([
      '以 Markdown 为准',
      '文件名与标题来自',
      '文件放在哪个目录',
      '再送一份到坚果云。',
      '多久写一次、写到哪个目录。',
      '启用云端通道',
      /* [V0.11.19 批 1] ③「同步间隔」整行删除 */
      '同步间隔',
      '1 分钟 ~ 24 小时',
    ]);
    /* 它们不许悄悄回到常量表里 */
    for (const phrase of REMOVED_PHRASES) {
      for (const value of VALUES) expect(value).not.toContain(phrase);
    }
  });

  it('文案里没有裸三位状态码（状态码只进日志，PRD E7）', () => {
    const all = [...VALUES, mixedFileNote(['便利贴', '待办事项']), mixedRootNote([{ label: '便利贴', value: 'C:\\Vault2' }])];
    for (const text of all) expect(/\b\d{3}\b/.test(text)).toBe(false);
  });

  it('① 三档文件名不同时的灰字逐字，且列出的是「另外那些档」', () => {
    expect(mixedFileNote(['便利贴', '待办事项'])).toBe('便利贴、待办事项用的是另外的名字；改上面的名字会三档统一。');
  });

  it('③ 三档落点不同的提示：只列不同项，显示截断、title 给全文', () => {
    const items = [{ label: '便利贴', value: 'C:\\Vault2' }, { label: '待办事项', value: 'C:\\Vault3' }];
    expect(mixedRootNote(items)).toBe('三档落点不同：便利贴 C:\\Vault2、待办事项 C:\\Vault3');
    expect(mixedRootNote(items).startsWith(MIXED_ROOT_PREFIX)).toBe(true);
    expect(mixedRootTitle(items)).toContain('C:\\Vault3');

    /* 长路径：显示层截到 24 字符 + …，title 里一个字都不少 */
    const long = 'C:\\Users\\xxx\\Documents\\Obsidian\\日记';
    const short = shortPath(long);
    expect(short).toBe(`${long.slice(0, SHORT_PATH_MAX)}…`);
    expect(short.length).toBe(SHORT_PATH_MAX + 1);
    expect(mixedRootTitle([{ label: '事项计时', value: long }])).toContain(long);
    /* 短路径不截断（不该无端多一个省略号） */
    expect(shortPath('C:\\Vault')).toBe('C:\\Vault');
  });

  it('③ 某一档被关掉时的提示是「…这一档已关闭同步。」', () => {
    expect(`${['便利贴'].join('、')}${CLOSED_TIER_SUFFIX}`).toBe('便利贴这一档已关闭同步。');
    expect(CLOSED_TIER_SUFFIX).toBe('这一档已关闭同步。');
  });

  it('C11 只在实际受影响的那几档上说：三档用原句，不足三档逐一点名', () => {
    /* 三档 → PRD 4.0 的原句（逐字，与 `EXPECTED.C11` 同源） */
    expect(affectedNoteFor(['事项计时', '便利贴', '待办事项'])).toBe(EXPECTED.C11);
    expect(affectedNoteFor(['待办事项'])).toBe('待办事项跟着数据根一起搬。');
    expect(affectedNoteFor(['便利贴', '待办事项'])).toBe('便利贴、待办事项跟着数据根一起搬。');
    /* 除了三档那一帧，任何一帧都不许出现「这三档」 */
    for (const labels of [['待办事项'], ['便利贴', '待办事项']]) {
      expect(affectedNoteFor(labels)).not.toContain('这三档');
    }
  });

  it('G3：空数组返回空串（不许拼出没有主语的「跟着数据根一起搬。」）', () => {
    /* 函数自己必须安全：不能指望调用方先判 `affected.length > 0` —— 那种约定在下一次
       调用时就会破，而破的表现是一句没有主语的话出现在界面上 */
    expect(affectedNoteFor([])).toBe('');
    expect(affectedNoteFor([])).not.toContain('跟着数据根一起搬');
  });

  it('[V0.11.17 B3] 块④远端目录下的静态小字逐字正确，且不含裸状态码', () => {
    /* 手抄 PRD 那句话，防止常量被改错一个字却没人发现 */
    expect(CLOUD_DIR_HINT).toBe(
      '首次使用请先到坚果云网页版，在「我的坚果云」下新建名为 Timing 的文件夹。',
    );
    /* 它必须指向默认目录名 Timing（与 `emptyCloud().basePath === '/Timing'` 同源） */
    expect(CLOUD_DIR_HINT).toContain('Timing');
    expect(CLOUD_DIR_HINT).toContain('新建');
    /* 用户可见文案里不许出现裸三位状态码 */
    expect(/\b\d{3}\b/.test(CLOUD_DIR_HINT)).toBe(false);
    /* 它不是被删掉的那三句之一 */
    for (const phrase of REMOVED_PHRASES) expect(CLOUD_DIR_HINT).not.toContain(phrase);
  });
});
