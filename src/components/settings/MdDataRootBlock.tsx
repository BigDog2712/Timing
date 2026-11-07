/**
 * Timing — 设置 · 数据管理 · ② SQLite 落点设置（V0.11.15，PRD 4.2）
 * -----------------------------------------------------------------------------
 * 责任边界：显示**当前生效**的数据根 + 可写徽标 + 打开文件夹 + 更改位置… + 待生效黄条
 * + 受 `%APP_DIR%` 影响的落点种类 + 插件提示。改位置的动作细节在 `MdDataRootChange`。
 *
 * [V0.11.16] 说明文字从 4 段压到 1 句（C9 在块标题下、C10 删、C11 改短）：这块**唯一的
 * 输入动作是两个按钮**，五段文字讲一个只读路径属于 PRD 2.3 点名的「话说得比事多」。
 * 黄条（C12）与插件提示（C13）是**安全文案，零 diff**：前者说「重启后才生效」，
 * 后者是回退态下唯一会说「插件不见了」的地方。
 *
 * 三条口径（v0.11.15 立、本轮不变）：
 * 1. **只显示 `current`**，不显示 `defaultPath`：后者是出厂值（`<exe>\data`），回退态下
 *    与当前生效目录完全不同，混用会让用户看到错的路径（设计 §8-7）。
 * 2. **待生效不是失败**：切换成功后后端返回的 `pending` 立刻是 `Some(新目录)`，黄条写的
 *    是「重启后生效」；只有再点一次「改回旧位置」或重启后 `get()` 才会变回 `null`。
 * 3. **手机端不渲染**：`data_root_get` 在手机端是 `desktop_only`（回 `IO_ERROR`
 *    「仅桌面端可用」），在手机上调一次就是设置页一片红字。
 */
import { useCallback, useEffect, useState } from 'react';
import { IS_MOBILE } from '../../lib/platform';
import { dataRootApi, rawIpcText } from '../../services/api';
import type { DataRootInfo } from '../../types/domain/dataRoot';
import { MdDataRootChange } from './MdDataRootChange';
import { COPY } from './mdSyncCopy';

export function MdDataRootBlock() {
  /* 守卫放外层：hooks 必须无条件按序调用，函数内提前 return 会打破这条规则 */
  if (IS_MOBILE) return null;
  return <DataRootBody />;
}

function DataRootBody() {
  const [info, setInfo] = useState<DataRootInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [changing, setChanging] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setInfo(await dataRootApi.get());
      setError(null);
    } catch (err) {
      setError(rawIpcText(err)); /* 原文透出：`errorText()` 会把它润色成「系统调用失败」 */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openFolder = async () => {
    setOpening(true);
    setError(null);
    try {
      await dataRootApi.open();
    } catch (err) {
      setError(rawIpcText(err)); /* 目录不存在时后端给「目录不存在：…」，照给 */
    } finally {
      setOpening(false);
    }
  };

  /* 撤销待生效的切换：只动指针，不动任何文件。`null` 是**撤销**，不是「没传参」 */
  const revert = async () => {
    setError(null);
    try {
      setInfo(await dataRootApi.change(null));
    } catch (err) {
      setError(rawIpcText(err));
    }
  };

  return (
    <>
      {loading && !info && <p className="sync__empty">正在读取数据落点…</p>}
      {error && <p className="sync__error">{error}</p>}

      {info && (
        <>
          <div className="data__field">
            <span className="data__label">当前数据目录</span>
            <p className="data__path" title={info.current}>{info.current}</p>
            {/* [V0.11.16] C10：这里原本还有一句「程序、数据库、日志、备份、Markdown
                出厂落点都在这里。」——块标题下的 hint 已经说过同一件事，删掉。 */}
          </div>

          <div className="data__row">
            <span className="data__badge" data-ok={info.writable ? 'true' : 'false'}>
              {info.writable ? '可写' : `不可写：${info.writableError ?? '原因未知'}`}
            </span>
            <span className="data__badge">{info.isDefault ? '默认位置' : '自定义位置'}</span>
            <button type="button" className="btn btn--ghost" disabled={opening}
              onClick={() => void openFolder()}>
              {opening ? '打开中…' : '打开文件夹'}
            </button>
            <button type="button" className="btn btn--neutral" disabled={opening}
              onClick={() => setChanging((value) => !value)}>
              {changing ? '取消更改' : '更改位置…'}
            </button>
          </div>

          {/* 待生效黄条：切换成功 ≠ 已经生效，一个字的「失败」都不许写在这里 */}
          {info.pending && (
            <div className="data__warn">
              <p className="data__warn-text">
                新位置已设置，重启 Timing 之后生效；现在仍在用旧目录。
                <br />
                新位置：<code>{info.pending}</code>
              </p>
              <button type="button" className="btn btn--ghost" onClick={() => void revert()}
                title={info.previous ? `回到 ${info.previous}` : '删掉待生效的设置'}>
                改回旧位置
              </button>
            </div>
          )}

          {/* C11：只在确有三档 `%APP_DIR%` 落点时出现，且压成一句（受影响的是哪三档,
              上面那句话已经不必再念一遍） */}
          {info.affected.length > 0 && (
            <p className="data__note">{COPY.affectedNote}</p>
          )}

          {/* 回退态下插件就在数据根里：切换不会复制它，这是唯一会说「插件不见了」的场景 */}
          {info.pluginsInDataRoot && (
            <p className="data__note">
              插件目录现在也在数据根里。切换位置时不会复制它，请自己把 plugins\ 搬到程序目录下。
            </p>
          )}

          {changing && (
            <MdDataRootChange
              info={info}
              onCancel={() => setChanging(false)}
              onDone={(next) => { setInfo(next); setChanging(false); setError(null); }}
            />
          )}
        </>
      )}
    </>
  );
}
