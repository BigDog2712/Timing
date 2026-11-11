/**
 * Timing — 手柄绑定的响应式读取（唯一读取口）
 * -----------------------------------------------------------------------------
 * 为什么是 `useState(loadHandleBindings())` 而不是 zustand：写入方只有设置页一处
 * （`saveHandleBindings`），本 hook 只读。多一个 store 就等于多一个写入方和一份同步逻辑，
 * 而跨窗同步靠的是 `appearanceSync` 的"人回来就重读"（见该文件头）。
 *
 * 为什么变了才 setState：`pointerenter` 每进一次手柄区就触发一次重读；每次都 setState
 * 会让药丸跟着鼠标重渲染。返回同一个引用 = React 直接跳过。
 */
import { useEffect, useState } from 'react';
import type { HandleBindings } from '../lib/handleCatalog';
import { loadHandleBindings } from '../lib/handleBindings';
import { subscribeHandleReread } from '../lib/appearanceSync';

/** 归一化后的形状键序固定（parse 按 HANDLE_FORMS / HANDLE_SLOTS 顺序建对象），可直接比串 */
function sameBindings(a: HandleBindings, b: HandleBindings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function useHandleBindings(): HandleBindings {
  const [bindings, setBindings] = useState<HandleBindings>(() => loadHandleBindings());

  useEffect(
    () =>
      subscribeHandleReread(() => {
        setBindings((prev) => {
          const next = loadHandleBindings();
          return sameBindings(prev, next) ? prev : next;
        });
      }),
    [],
  );

  return bindings;
}
