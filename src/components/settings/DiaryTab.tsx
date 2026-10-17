import { useEffect, useState } from 'react';
import { errorText } from '../../services/ipc';
import { diaryActions } from '../../services/diaryActions';
import type { DiaryConfig } from '../../types/domain';

export function DiaryTab() {
  const [config, setConfig] = useState<DiaryConfig | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { void diaryActions.getConfig().then(setConfig).catch((e) => setError(errorText(e))); }, []);
  if (!config) return <div className="setting-group">{error || '加载日记设置中'}</div>;
  const update = (key: keyof DiaryConfig, value: string) => { setSaved(false); setConfig({ ...config, [key]: value }); };
  const save = () => { setError(''); void diaryActions.setConfig(config).then(setConfig).then(() => setSaved(true)).catch((e) => setError(errorText(e))); };
  return <div className="setting-group">
    <h3 className="setting-group__title">今日日记</h3>
    <label className="setting-row"><span className="setting-row__label">Vault 根目录</span><input value={config.vaultRoot} onChange={(e) => update('vaultRoot', e.target.value)} /></label>
    <label className="setting-row"><span className="setting-row__label">日记目录</span><input value={config.diaryRelativeDir} onChange={(e) => update('diaryRelativeDir', e.target.value)} /></label>
    <label className="setting-row"><span className="setting-row__label">文件名格式</span><input value={config.diaryFileNameFormat} onChange={(e) => update('diaryFileNameFormat', e.target.value)} /></label>
    <label className="setting-row"><span className="setting-row__label">编辑器路径</span><input value={config.editorPath} onChange={(e) => update('editorPath', e.target.value)} /></label>
    <button type="button" className="btn btn--neutral" onClick={save}>保存日记设置</button>
    {saved && <span className="setting-row__hint">已保存</span>}{error && <p className="inline-error" role="alert">{error}</p>}
  </div>;
}
