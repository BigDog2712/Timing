/**
 * 手柄「发送快捷键」的判据（[0.13]）
 * -----------------------------------------------------------------------------
 * 这一层的东西最终会往**用户当前的前台应用**注入按键，所以每条判据都在守一个
 * 「不报错但会出错」的口子：
 *
 *  - 没有修饰键的组合 = 往别人的输入框里打一个字（a02 / a08）
 *  - 修饰键顺序错 = 目标收到的是 `M` 而不是 `Ctrl+M`（a04）
 *  - 键名表两份 = 录的是 M、发出来的是别的（a05 / a06：解析与发送共用同一张表）
 *  - `+` 出现在键名里 = 文本切不回去（a07）
 */
import { describe, expect, it } from 'vitest';

import {
  formatHotkey,
  hotkeyToVirtualKeys,
  parseHotkey,
  specFromKeyboardEvent,
} from './hotkey';

function keydown(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', init);
}

describe('组合键文本', () => {
  it('hk01_格式化与解析互为逆运算', () => {
    const spec = { ctrl: true, alt: false, shift: true, key: 'M' };
    expect(formatHotkey(spec)).toBe('Ctrl+Shift+M');
    expect(parseHotkey('Ctrl+Shift+M')).toEqual(spec);
  });

  it('hk02_没有修饰键的组合不被接受', () => {
    /* 安全护栏：单键 = 往用户当前前台应用里注入一个字符。段落与空格都不例外。 */
    expect(parseHotkey('M')).toBeNull();
    expect(parseHotkey('Enter')).toBeNull();
  });

  it('hk03_修饰键别名与小写键名都收', () => {
    expect(parseHotkey('control+m')).toEqual({
      ctrl: true, alt: false, shift: false, key: 'M',
    });
    expect(parseHotkey(' alt + option + f12 ')).toEqual({
      ctrl: false, alt: true, shift: false, key: 'F12',
    });
  });

  it('hk03b_带_Win_的组合一律不收', () => {
    /* [R1] Win+R / Win+X 是本功能唯一的完整 RCE 路径：两步就能拼出「打开运行框 → 敲命令」。
       这里三个旧别名（win / cmd / super）全部改判为「不认识」，而不是「认识但发不出去」——
       后者会让用户在录制框里成功、按下去失败。 */
    for (const text of ['win+r', 'Ctrl+win+m', 'cmd+space', 'super+x']) {
      expect(parseHotkey(text), `"${text}" 不该被接受`).toBeNull();
    }
  });

  it('hk04_修饰位的顺序固定_ctrl_alt_shift', () => {
    /* 同一组合只有一种写法：顺序变了会让「看起来不同的两条配置」其实是同一条，
       用户在设置里改不动它 —— 而且发送顺序与显示顺序共用这一处定义。 */
    const spec = { ctrl: true, alt: true, shift: true, key: 'F1' };
    expect(formatHotkey(spec)).toBe('Ctrl+Alt+Shift+F1');
  });

  it('hk05_坏文本一律_null', () => {
    for (const text of ['', 'Ctrl', 'Ctrl+', 'Ctrl+M+N', 'Ctrl+Foo', 'M+Ctrl']) {
      expect(parseHotkey(text), `"${text}" 不该被接受`).toBeNull();
    }
  });

  it('hk07_符号键用未加_shift_的字符_加号不是键名', () => {
    /* `+` 是分隔符：键名里出现它，文本就再也切不回去了 */
    expect(parseHotkey('Ctrl+=')).toEqual({ ctrl: true, alt: false, shift: false, key: '=' });
    expect(parseHotkey('Ctrl+-')).toEqual({ ctrl: true, alt: false, shift: false, key: '-' });
    /* 反过来证明 `+` 不能当键名：格式出来的文本切不回去（所以键表里根本没有它） */
    const broken = formatHotkey({ ctrl: true, alt: false, shift: false, key: '+' });
    expect(parseHotkey(broken)).toBeNull();
  });
});

describe('录制', () => {
  it('hk08_修饰键本身与无修饰键的按法都返回_null', () => {
    /* null = 「继续等下一个键」，不是错误：录制框靠它判断「这一下不算」 */
    expect(specFromKeyboardEvent(keydown({ code: 'ShiftLeft', shiftKey: true }))).toBeNull();
    expect(specFromKeyboardEvent(keydown({ code: 'ControlLeft', ctrlKey: true }))).toBeNull();
    expect(specFromKeyboardEvent(keydown({ code: 'KeyM' }))).toBeNull();
    /* 白名单外的键（媒体键）不发：它们的 VK 语义随设备变化 */
    expect(specFromKeyboardEvent(keydown({ code: 'MediaPlayPause', ctrlKey: true }))).toBeNull();
  });

  it('hk08b_按着_Win_的按法返回_null', () => {
    /* [R1] 只按 Win+R 与「Ctrl+Win+R」都要挡住：前者是系统运行框，后者能从别的应用
       借 Ctrl 的面子绕开一部分系统拦截。判据看的是 metaKey，与主键是什么无关。 */
    expect(specFromKeyboardEvent(keydown({ code: 'KeyR', metaKey: true }))).toBeNull();
    expect(specFromKeyboardEvent(keydown({ code: 'KeyR', ctrlKey: true, metaKey: true }))).toBeNull();
  });

  it('hk09_修饰键_主键的按法产出_spec', () => {
    expect(specFromKeyboardEvent(keydown({ code: 'KeyM', ctrlKey: true, shiftKey: true })))
      .toEqual({ ctrl: true, alt: false, shift: true, key: 'M' });
  });

  it('hk10_物理键位而不是字符_is_shift_不影响主键名', () => {
    /* `Shift+Digit1` 的 `key` 是 `!`，但 VK 是数字 1 —— 用 `key` 拼会指向另一个键 */
    expect(specFromKeyboardEvent(keydown({ code: 'Digit1', ctrlKey: true, shiftKey: true }))?.key).toBe('1');
  });
});

describe('VK 序列', () => {
  it('hk11_修饰键在前_主键在最后', () => {
    const vks = hotkeyToVirtualKeys({ ctrl: true, alt: false, shift: true, key: 'M' });
    /* Ctrl 0x11 / Shift 0x10 / M 0x4D —— 声明顺序 = 按下顺序，后端逆序抬起 */
    expect(vks).toEqual([0x11, 0x10, 0x4d]);
  });

  it('hk12_没有修饰键的_spec_得到空序列', () => {
    /* 纵深防御：手改过的配置绕过 `parseHotkey` 直接进这里时也要被挡住 */
    expect(hotkeyToVirtualKeys({ ctrl: false, alt: false, shift: false, key: 'M' })).toEqual([]);
  });

  it('hk13_认不出的主键得到空序列', () => {
    expect(hotkeyToVirtualKeys({ ctrl: true, alt: false, shift: false, key: 'Nope' })).toEqual([]);
  });

  it('hk14_功能键与符号键的_vk_来自同一张表', () => {
    expect(hotkeyToVirtualKeys({ ctrl: true, alt: false, shift: false, key: 'F12' }))
      .toEqual([0x11, 0x7b]);
    expect(hotkeyToVirtualKeys({ ctrl: true, alt: false, shift: false, key: '/' }))
      .toEqual([0x11, 0xbf]);
  });
});
