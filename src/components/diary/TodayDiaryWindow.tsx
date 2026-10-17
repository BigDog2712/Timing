import { useEffect, useState } from 'react';

export interface TodayDiaryView {
  date: string;
  path: string;
  exists: boolean;
}

export interface TodayDiaryActions {
  load: () => Promise<TodayDiaryView>;
  open: () => Promise<TodayDiaryView>;
}

export function TodayDiaryWindow({ actions }: { actions: TodayDiaryActions }) {
  const [diary, setDiary] = useState<TodayDiaryView | null>(null);
  const [error, setError] = useState('');
  const refresh = () => actions.load().then(setDiary).catch((e: unknown) => setError(e instanceof Error ? e.message : '读取日记失败'));
  useEffect(() => { void refresh(); }, []);
  const open = () => actions.open().then(setDiary).catch((e: unknown) => setError(e instanceof Error ? e.message : '打开日记失败'));
  return (
    <main className="panel-window today-diary-window">
      <header className="panel-window__header" data-tauri-drag-region="true">
        <h1>今日日记</h1><button type="button" onClick={refresh} aria-label="刷新">刷新</button>
      </header>
      <section className="panel-window__body">
        <p>{diary?.date ?? '加载中'}</p>
        <p className="panel-window__path">{diary?.path ?? ''}</p>
        {error && <p role="alert">{error}</p>}
        <button type="button" onClick={open} disabled={!diary?.exists}>打开今日日记</button>
        {diary && !diary.exists && <p>文件尚未创建，请先在编辑器中建立该日期文件。</p>}
      </section>
    </main>
  );
}
