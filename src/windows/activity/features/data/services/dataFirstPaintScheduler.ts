type IdleWindow = {
  cancelIdleCallback?: (handle: number) => void;
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
};

export function scheduleDataWorkAfterFirstPaint(
  callback: () => void,
  timeoutMs = 800,
  delayMs = 0,
): () => void {
  if (typeof window === "undefined") {
    const timer = globalThis.setTimeout(callback, delayMs);
    return () => globalThis.clearTimeout(timer);
  }

  let cancelled = false;
  let firstFrame = 0;
  let secondFrame = 0;
  let delayHandle: number | null = null;
  let idleHandle: number | null = null;
  let timeoutHandle: number | null = null;

  const scheduleIdleWork = () => {
    if (cancelled) return;

    const idleWindow = window as unknown as IdleWindow;
    const requestIdleCallback = idleWindow.requestIdleCallback;
    const cancelIdleCallback = idleWindow.cancelIdleCallback;
    if (typeof requestIdleCallback === "function" && typeof cancelIdleCallback === "function") {
      idleHandle = requestIdleCallback.call(window, () => {
        idleHandle = null;
        if (!cancelled) callback();
      }, { timeout: timeoutMs });
      return;
    }

    timeoutHandle = window.setTimeout(() => {
      timeoutHandle = null;
      if (!cancelled) callback();
    }, 0);
  };
  const run = () => {
    if (delayMs <= 0) {
      scheduleIdleWork();
      return;
    }

    delayHandle = window.setTimeout(() => {
      delayHandle = null;
      scheduleIdleWork();
    }, delayMs);
  };

  firstFrame = window.requestAnimationFrame(() => {
    firstFrame = 0;
    secondFrame = window.requestAnimationFrame(() => {
      secondFrame = 0;
      run();
    });
  });

  return () => {
    cancelled = true;
    if (firstFrame) window.cancelAnimationFrame(firstFrame);
    if (secondFrame) window.cancelAnimationFrame(secondFrame);
    if (delayHandle !== null) {
      window.clearTimeout(delayHandle);
    }
    if (idleHandle !== null) {
      const cancelIdleCallback = (window as unknown as IdleWindow).cancelIdleCallback;
      if (typeof cancelIdleCallback === "function") {
        cancelIdleCallback.call(window, idleHandle);
      }
    }
    if (timeoutHandle !== null) {
      window.clearTimeout(timeoutHandle);
    }
  };
}
