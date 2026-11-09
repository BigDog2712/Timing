/**
 * Timing — 设置 · 数据管理 · ① Markdown 落点设置（V0.11.16，PRD 4.1）
 * -----------------------------------------------------------------------------
 * 责任边界：**只回答「写成什么样」**——一个日记文件名 + 三个标题行。
 * 不在这里的东西（都在块③）：根目录、种类启用开关、运行状态、「打开今日文件」。
 *
 * 本轮那一刀（C4/C5 删、C6/C7/C8 新增）：v0.11.15 为三个种类各画一组「文件模板 +
 * 标题行」共 6 个输入框，可三档 `file` 出厂全是 `{date}.md`——同一个文件、同一个名字，
 * 界面上却要改三次、讲三遍。现在：
 *
 * - **一个文件名框写三档**，但只有用户亲手改过才扇出（`shared.file`，见 `mdSyncShared`）；
 * - 三个标题行仍是**三份**（三个标题本来就是三种东西，PRD B3 要求它们互不覆盖）；
 * - 三档文件名不一致时补一行灰字，并保留「逐个设置」那个出口。
 *
 * 校验：前端**只判空**；其余规则由后端 `MdSyncBinding::validate` 在保存时返回原文，
 * `splitBindingError` 把它落到对应行下方。
 */
import { useMdSyncStore } from '../../stores/mdSyncStore';
import { MD_SYNC_KIND_LABELS } from '../../types/domain';
import type { MdSyncBinding } from '../../types/domain';
import { COPY, mixedFileNote } from './mdSyncCopy';
import { differingBindings, sharedValue } from './mdSyncShared';
import { previewFile, splitBindingError } from './mdSyncConfig';
import type { MdSyncDraft } from './useMdSyncDraft';

interface MdFormatBlockProps {
  draft: MdSyncDraft;
}

export function MdFormatBlock({ draft }: MdFormatBlockProps) {
  const today = useMdSyncStore((s) => s.view?.today ?? '');
  /* [V0.11.33] 模板路径一行进块①（W8 / P15）：全局一份，全局只有这一个入口 */
  const { bindings, shared, saving, loading, error, updateBinding, setSharedFile, diaryTemplate, setDiaryTemplate } = draft;
  /* 后端那条「第 2 个落点：标题行必须以 # 开头」→ 落到第 2 行下方；不是这种形状
     → `null`，红字退回页签顶部（不猜是哪一行） */
  const inline = error ? splitBindingError(error, bindings.length) : null;

  if (bindings.length === 0) {
    return <p className="sync__empty">{loading ? '正在读取落点…' : '没有可配置的落点。'}</p>;
  }

  const file = sharedValue(bindings, shared, 'file');
  const preview = previewFile(file, today);
  /* 只列「与计时档不同」的那些档：计时档的值就在上面那个框里，再念一遍是重复 */
  const others = differingBindings(bindings, 'file');

  const patchHeading = (index: number, binding: MdSyncBinding, heading: string) => {
    updateBinding(index, { ...binding, heading }, 'format');
  };

  return (
    <>
      <div className="sync__fields">
        <label className="sync__field">
          <span className="sync__label">日记文件名</span>
          <div className="sync__row">
            <input
              className="sync__input"
              value={file}
              disabled={saving}
              spellCheck={false}
              placeholder="{date}.md"
              aria-label="日记文件名"
              onChange={(event) => setSharedFile(event.target.value)}
            />
            {/* C7：三处「今天会写成…」收成这一行只读。不保存也能看到文件名长什么样 */}
            <span className="sync__today">今天：{preview || '（还没填文件名）'}</span>
          </div>
        </label>
        {/* C6：令牌与后缀的唯一说明（原来的「支持 4 个令牌 + 标题行规则 + 合并口径」已删） */}
        <p className="sync__hint">{COPY.fileTemplateNote}</p>
        {others.length > 0 && (
          <p className="sync__hint" data-mixed="true">
            {mixedFileNote(others.map((item) => item.label))}
          </p>
        )}
        {/* [V0.11.33] W8：日记模板路径（全局一份，R3）。A1b 纪律不豁免新句——
            说明交给 placeholder 与 PRD 语义，不加 hint 不进 EXPLAIN_KEYS */}
        <label className="sync__field">
          <span className="sync__label">日记模板路径</span>
          <input
            className="sync__input"
            value={diaryTemplate}
            disabled={saving}
            spellCheck={false}
            placeholder="如 %APP_DIR%\模板.md，留空 = 不套模板"
            aria-label="日记模板路径"
            onChange={(event) => setDiaryTemplate(event.target.value)}
          />
        </label>
      </div>

      {bindings.map((binding, index) => {
        const label = MD_SYNC_KIND_LABELS[binding.kind];
        return (
          <div className="sync__heading-row" key={`${binding.kind}-${index}`}>
            <label className="sync__field">
              <span className="sync__label">{label}</span>
              <input
                className="sync__input"
                value={binding.heading}
                disabled={saving}
                spellCheck={false}
                placeholder={`#### ${label}`}
                aria-label={`${label}标题行`}
                onChange={(event) => patchHeading(index, binding, event.target.value)}
              />
            </label>
            {/* 没填就不给假的「能写」假象；后端还会再校验一次格式 */}
            {!binding.heading.trim() && <p className="data__note">这一行还没填完。</p>}
            {inline?.index === index && <p className="sync__error">{inline.text}</p>}
          </div>
        );
      })}

      {/* C8：全页唯一保留的安全句——它替代了原来重复三遍的那句话（PRD A3） */}
      <p className="data__note">{COPY.safeNote}</p>
    </>
  );
}
