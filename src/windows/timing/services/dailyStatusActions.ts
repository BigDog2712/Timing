import { ipc } from './ipc';

export type DailyDigestStatus = 'pending' | 'done';
export function getDailyDigestStatuses(date: string): Promise<Record<number, DailyDigestStatus>> {
  return ipc.dailyStatusGet(date);
}
export function setDailyDigestStatus(date: string, itemId: number, status: DailyDigestStatus): Promise<void> {
  return ipc.dailyStatusSet(date, itemId, status);
}
