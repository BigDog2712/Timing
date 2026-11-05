/**
 * `lib/storageKeys` —— 5 个 localStorage 键的双读兼容（V0.5.0 改名配套）
 *
 * 这组用例守的是**升级不丢设置**这条底线：
 *   1. 只写老键（0.4.x 用户的真实状态）→ 读到老值，且新键被顺便补齐（一次性搬运）；
 *   2. 新键已存在 → 以新键为准，老键不再影响；
 *   3. 两处都没有 → null（调用方自己给默认值）；
 *   4. `removeKey` 必须把老键一起删（否则下次读又「复活」）；
 *   5. `isKeyEvent` 对新键与老键都成立（跨窗口同步不能漏老键）。
 *
 * 用假 `localStorage`：jsdom 自带的实现每次测试要手动清理，而这里要精确构造
 * 「只有老键 / 只有新键」两种状态，自建替身更直白。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LEGACY_STORAGE_KEYS,
  STORAGE_KEYS,
  isKeyEvent,
  readKeyWithLegacy,
  removeKey,
  writeKey,
} from './storageKeys';

/** 最小 localStorage 替身（只实现本模块用到的四个方法） */
function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', makeStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('storageKeys —— 键名口径', () => {
  it('新键一律以 timing 开头，老键保留各自的历史形态（含 fit-offset 的冒号）', () => {
    for (const name of Object.keys(STORAGE_KEYS) as (keyof typeof STORAGE_KEYS)[]) {
      expect(STORAGE_KEYS[name].startsWith('timing.'), `${name} 新键`).toBe(true);
      expect(LEGACY_STORAGE_KEYS[name].startsWith('tickbar'), `${name} 老键`).toBe(true);
    }
    /* 这一个是冒号不是点：不是笔误，是 0.4.x 的真实形态（ARCHITECTURE §6.2 P1-2） */
    expect(LEGACY_STORAGE_KEYS.fitOffset).toBe('tickbar:fit-offset');
  });
});

describe('storageKeys —— 双读', () => {
  it('只有老键：读到老值，并把新键补齐（一次性搬运）', () => {
    localStorage.setItem(LEGACY_STORAGE_KEYS.theme, 'light');

    expect(readKeyWithLegacy('theme')).toBe('light');
    expect(localStorage.getItem(STORAGE_KEYS.theme), '命中老键后必须回写新键').toBe('light');
    expect(localStorage.getItem(LEGACY_STORAGE_KEYS.theme), '老键保留不删').toBe('light');
  });

  it('新键已存在：以新键为准，老键不参与', () => {
    localStorage.setItem(STORAGE_KEYS.appearance, '{"textOpacity":0.5,"bgOpacity":0.5}');
    localStorage.setItem(LEGACY_STORAGE_KEYS.appearance, '{"textOpacity":0.2,"bgOpacity":0.2}');

    expect(readKeyWithLegacy('appearance')).toBe('{"textOpacity":0.5,"bgOpacity":0.5}');
  });

  it('两处都没有：返回 null（默认值由调用方决定）', () => {
    expect(readKeyWithLegacy('countdownArm')).toBeNull();
  });

  it('键存在但值为空串：视为没有，继续回落老键（setItem(k, "") 与未设置等价）', () => {
    localStorage.setItem(STORAGE_KEYS.fitOffset, '');
    localStorage.setItem(LEGACY_STORAGE_KEYS.fitOffset, '{"l":4,"t":-2}');

    expect(readKeyWithLegacy('fitOffset')).toBe('{"l":4,"t":-2}');
  });

  it('存储不可用（隐私模式抛错）时返回 null，不向上抛', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    });

    expect(readKeyWithLegacy('theme')).toBeNull();
    expect(() => writeKey('theme', 'dark')).not.toThrow();
    expect(() => removeKey('theme')).not.toThrow();
  });
});

describe('storageKeys —— 写与删', () => {
  it('writeKey 只写新键，不碰老键（回滚 0.4.1 时老偏好还在）', () => {
    localStorage.setItem(LEGACY_STORAGE_KEYS.countdownArm, '600');

    writeKey('countdownArm', '1500');

    expect(localStorage.getItem(STORAGE_KEYS.countdownArm)).toBe('1500');
    expect(localStorage.getItem(LEGACY_STORAGE_KEYS.countdownArm)).toBe('600');
  });

  it('removeKey 双删：只删老键会让下次读又「复活」', () => {
    localStorage.setItem(STORAGE_KEYS.countdownDuration, '900');
    localStorage.setItem(LEGACY_STORAGE_KEYS.countdownDuration, '900');

    removeKey('countdownDuration');

    expect(localStorage.getItem(STORAGE_KEYS.countdownDuration)).toBeNull();
    expect(localStorage.getItem(LEGACY_STORAGE_KEYS.countdownDuration)).toBeNull();
    expect(readKeyWithLegacy('countdownDuration')).toBeNull();
  });
});

describe('storageKeys —— 跨窗口事件', () => {
  it('新键与老键的 storage 事件都算作同一个逻辑键', () => {
    expect(isKeyEvent('appearance', STORAGE_KEYS.appearance)).toBe(true);
    expect(isKeyEvent('appearance', LEGACY_STORAGE_KEYS.appearance)).toBe(true);
  });

  it('别的键（含 null = clear()）不算', () => {
    expect(isKeyEvent('appearance', STORAGE_KEYS.theme)).toBe(false);
    expect(isKeyEvent('appearance', null)).toBe(false);
  });
});
