/**
 * 自定义绑定的编码判据（[0.13]）
 * -----------------------------------------------------------------------------
 * 前缀是**持久化格式的一部分**：写进用户配置之后，「是不是自定义绑定」这件事只能靠它
 * 回答（目录里的 id 永远不含冒号）。所以这里的每条判据都对应一个会静默出错的口子：
 *
 *  - 前缀认错 → 一条「启动 Photoshop」的绑定被当成未知 id 归一成「无」（按键没反应，设置里也空）
 *  - 空载荷被接受 → 下拉显示「启动 」，点下去只得到一条没头没尾的报错
 *  - 路径被 basename 之外的东西截断 → 同一份配置在两处显示成两个不同的名字
 */
import { describe, expect, it } from 'vitest';

import {
  describeCustomBinding,
  fileNameOf,
  parseCustomBinding,
  serializeCustomBinding,
} from './handleCustomBinding';

describe('自定义绑定编码', () => {
  it('cb01_launch_往返_路径里的盘符冒号不会被当成分隔符', () => {
    const raw = serializeCustomBinding('launch', 'C:\\Apps\\Photoshop.exe');
    expect(raw).toBe('launch:C:\\Apps\\Photoshop.exe');
    expect(parseCustomBinding(raw)).toEqual({ kind: 'launch', payload: 'C:\\Apps\\Photoshop.exe' });
  });

  it('cb02_hotkey_往返', () => {
    const raw = serializeCustomBinding('hotkey', 'Ctrl+Alt+M');
    expect(parseCustomBinding(raw)).toEqual({ kind: 'hotkey', payload: 'Ctrl+Alt+M' });
  });

  it('cb03_内置动作_id_与空值都不是自定义绑定', () => {
    for (const value of ['note.current', 'timer.start', '', null, undefined]) {
      expect(parseCustomBinding(value), `"${String(value)}" 不该被当成自定义绑定`).toBeNull();
    }
  });

  it('cb04_空载荷算无效', () => {
    /* 前缀单独出现在配置里 = 采集到一半的坏数据。返回 payload 会导致「启动 」这种残废项 */
    expect(parseCustomBinding('launch:')).toBeNull();
    expect(parseCustomBinding('hotkey:   ')).toBeNull();
  });

  it('cb05_未知前缀不算', () => {
    expect(parseCustomBinding('web:https://example.com')).toBeNull();
    expect(parseCustomBinding('note.current:extra')).toBeNull();
  });
});

describe('可读名', () => {
  it('cb06_basename_兼容两种分隔符与尾随分隔符', () => {
    expect(fileNameOf('C:\\Apps\\Photoshop.exe')).toBe('Photoshop.exe');
    expect(fileNameOf('/usr/bin/code')).toBe('code');
    expect(fileNameOf('relative/thing.lnk')).toBe('thing.lnk');
    /* 只有一个分隔符的极端情形不能返回空串 */
    expect(fileNameOf('C:\\')).toBe('C:');
    expect(fileNameOf('name.exe')).toBe('name.exe');
  });

  it('cb07_描述把两种绑定说成两种话', () => {
    expect(describeCustomBinding({ kind: 'launch', payload: 'D:\\工具\\微信.exe' })).toBe('启动 微信.exe');
    expect(describeCustomBinding({ kind: 'hotkey', payload: 'Ctrl+Shift+M' })).toBe('发送 Ctrl+Shift+M');
  });
});
