import { ipc } from './ipc';
import type { DiaryConfig, TodayDiary } from '../types/domain';

export const diaryActions = {
  getConfig: (): Promise<DiaryConfig> => ipc.diaryGetConfig(),
  setConfig: (config: DiaryConfig): Promise<DiaryConfig> => ipc.diarySetConfig(config),
  today: (): Promise<TodayDiary> => ipc.diaryToday(),
  openToday: (): Promise<TodayDiary> => ipc.diaryOpenToday(),
};
