import { ipc, onIpcEvent } from './ipc';
import type { TimerState } from '../types/domain';

export const timerWindowActions = {
  open: (): Promise<void> => ipc.openTimerWindow(),
  load: (): Promise<TimerState> => ipc.getTimerState(),
  subscribe: (handler: (state: TimerState) => void): Promise<() => void> =>
    onIpcEvent<TimerState>('timer:state-changed', handler),
};
