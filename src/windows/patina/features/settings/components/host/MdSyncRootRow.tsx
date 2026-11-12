/**
 * Timing — 设置 · 数据管理 · ③「日记落点」那一行（V0.11.16，PRD 4.3 / 设计 §3.5）
 * -----------------------------------------------------------------------------
 * 责任边界：一个输入框（写三档 `root`）+「选择…」+ 一行只读「今天：绝对路径」+
 * 三档聚合状态 + 一个「打开今日文件」。
 *
 * 三个口径（改之前先看）：
 * 1. **单框不是三档的镜像**：`setSharedRoot` 只在用户真要改时扇出（`mdSyncShared`）；
 * 2. **「今天」那行的绝对路径优先用后端算好的** `status.bindings[timers].path`——
 *    `%APP_DIR%` / `%USERPROFILE%` / `~` 的解析顺序是 `infra/md_env.rs` 的**唯一口径**，
 *    前端再实现一遍就是第二套口径，两边一旦有偏差就是「设置页显示的路径不是实际写入
 *    的路径」。只有草稿与已保存不一致时才退到前端拼接，并加前缀「保存后」；
 * 3. **「打开今日文件」固定用计时那一档**：三档落点不同、或计时档被关闭时，按钮禁用并
 *    用 `title` 说明。自动挑「第一个启用的档」会让打开的文件与上面「今天：…」显示的
 *    那一行不是同一个，比禁用更糟。
 */
import { pickFolder } from '../../services/host/folderPicker';
import { useMdSyncStore } from '../../services/host/mdSyncRuntimeStore';
import { MD_SYNC_KIND_LABELS } from '../../services/host/hostTypes';
import { aggregateStatus, previewFile } from '../../services/host/mdSyncConfig';
import { baseOf, sharedValue } from '../../services/host/mdSyncShared';
import type { MdSyncDraft } from '../../services/host/useMdSyncDraft';

interface MdSyncRootRowProps {
  draft: MdSyncDraft;
}

export function MdSyncRootRow({ draft }: MdSyncRootRowProps) {
  const view = useMdSyncStore((s) => s.view);
  const today = view?.today ?? '';
  const { bindings, shared, saving, setSharedRoot } = draft;
  /* 基准档 = 计时那一档：三档一致时它没有特殊性，不一致时它是「单框显示谁」的答案。
     与 `mirrorOf` 共用 `baseOf`——各写一个 `bindings[0]` 就会出现「上面显示计时档的路径、
     按钮打开的是便利贴那一档」这种自相矛盾。 */
  const base = baseOf(bindings);

  if (!base) {
    return <p className="sync__empty">没有可同步的落点。</p>;
  }

  const root = sharedValue(bindings, shared, 'root');
  const file = sharedValue(bindings, shared, 'file');
  const saved = view?.status.bindings.find((item) => item.kind === base.kind);
  /* [QA G1] 判据是「草稿是否等于**已落库**的那一档」，不是「草稿是否等于基准档」。
     v0.11.16 首版写成 `root === base.root && file === base.file`，而 `base` 是**草稿**里的
     基准档——F2 之后逐档手改会把值写进 `bindings`，于是 `same` 恒为 true，`保存后：` 那个
     分支成了死代码。用户看到的是同一屏两处路径自相矛盾：上面那行「今天：C:\Vault\…」
     （后端旧值），紧挨着的逐档行已经是「D:\x\…」。
     比 `view.config.bindings`（后端已落库那份）就回到本意：草稿与已落库不同 → 说「保存后」。
     `view` 变了本组件本来就会重渲染（下面 `useMdSyncStore` 整份订阅），不需要额外依赖。 */
  const storedBase = view?.config.bindings.find((item) => item.kind === base.kind);
  const same = storedBase !== undefined && root === storedBase.root && file === storedBase.file;
  const joined = `${root.trim() || '尚未设置根目录'}\\${previewFile(file, today)}`;
  const pathText = same ? `今天：${saved?.path || joined}` : `保存后：${joined}`;

  const aggregate = aggregateStatus(bindings, view?.status.bindings ?? []);
  /* 计时档被关掉或还没设根目录：点了只会得到「今日文件尚未生成」或写到一个空路径 */
  const blocked = saving || !base.enabled || !base.root.trim();
  const blockReason = !base.enabled
    ? `先启用「${MD_SYNC_KIND_LABELS[base.kind]}」这一档`
    : '先设置日记落点';

  const handlePick = async () => {
    const picked = await pickFolder(
      '选择日记落点根目录',
      root.includes('%') ? undefined : root || undefined,
    );
    /* 选目录是**显式意图**：三档统一到用户挑的这个目录（与手打一模一样） */
    if (picked) setSharedRoot(picked);
  };

  return (
    <>
      <div className="sync__field">
        <span className="sync__label">日记落点</span>
        <div className="sync__row">
          <input
            className="sync__input"
            value={root}
            disabled={saving}
            spellCheck={false}
            placeholder="%APP_DIR%\md"
            aria-label="日记落点根目录"
            onChange={(event) => setSharedRoot(event.target.value)}
          />
          <button
            type="button"
            className="btn btn--neutral sync__pick"
            disabled={saving}
            onClick={() => void handlePick()}
          >
            选择…
          </button>
        </div>
        <p className="sync__path" title={pathText}>{pathText}</p>
      </div>

      <div className="sync__agg">
        <span className="sync__status" data-error={aggregate.errors.length > 0 ? 'true' : 'false'}>
          {aggregate.text}
        </span>
        <button
          type="button"
          className="btn btn--ghost sync__open"
          disabled={blocked}
          title={blocked ? blockReason : undefined}
          onClick={() => void draft.open(base.kind)}
        >
          打开今日文件
        </button>
      </div>

      {/* 失败原文最多三条，各自一行（`aggregateStatus` 已截断）：红字不吞、不合并 */}
      {aggregate.errors.map((text) => (
        <p className="sync__error" key={text}>{text}</p>
      ))}
    </>
  );
}
