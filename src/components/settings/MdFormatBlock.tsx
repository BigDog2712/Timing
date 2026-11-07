/**
 * Timing — 设置 · 数据管理 · ① Markdown 落点设置（V0.11.15）
 * -----------------------------------------------------------------------------
 * 责任边界：**只回答「写成什么样」**——每个种类的文件模板与标题行，加一个只读预览。
 * 不在这里的东西（都在块③）：根目录、种类启用开关、运行状态、「打开今日文件」。
 *
 * 这是 PRD 1.2 点名的那一刀：旧 `MdSyncBindingCard` 把「文件模板/标题」和「根目录」
 * 混在一张卡里，用户改文件名时看到的是目录输入框。代价是每行末尾必须有一句指路行
 * （「文件放在哪个目录，在下面『Markdown 同步』里改」），这一句是本块的一半价值。
 *
 * 校验：前端**只判空**（空 → 这一行提示「还没填完」）；其余规则由后端
 * `MdSyncBinding::validate` 在保存时返回原文，`splitBindingError` 把它落到对应行下方。
 */
import { useMdSyncStore } from '../../stores/mdSyncStore';
import { MD_SYNC_KIND_LABELS } from '../../types/domain';
import type { MdSyncBinding } from '../../types/domain';
import { previewFile, splitBindingError, subDirOf } from './mdSyncConfig';
import type { MdSyncDraft } from './useMdSyncDraft';

interface MdFormatBlockProps {
  draft: MdSyncDraft;
}

/** 每个种类的合并口径说明（从旧 `MdSyncBindingCard` 逐字搬来：它解释的是「写进去是什么样」） */
function kindHint(kind: MdSyncBinding['kind']): string {
  switch (kind) {
    case 'timers':
      return '按事项分组，写入 Planner 兼容的 YAML log；改时间或删组会回写数据库。';
    case 'notes':
      return '三列表格，隐藏 id 标记；新增 / 编辑 / 删除行都会回写数据库。只写当天创建或改过的便利贴。';
    case 'todos':
      return '清单项，隐藏 id 标记；勾掉或改标题 / 计划时间会回写数据库。只列未完成、且计划时间不在今天的待办。';
  }
}

export function MdFormatBlock({ draft }: MdFormatBlockProps) {
  const today = useMdSyncStore((s) => s.view?.today ?? '');
  const { bindings, saving, loading, error, updateBinding } = draft;
  /* 后端那条「第 2 个落点：文件模板不能包含 ..」→ 落到第 2 行下方；不是这种形状
     → `null`，红字退回页签顶部（不猜是哪一行） */
  const inline = error ? splitBindingError(error, bindings.length) : null;

  if (bindings.length === 0) {
    return <p className="sync__empty">{loading ? '正在读取落点…' : '没有可配置的落点。'}</p>;
  }

  const patch = (index: number, binding: MdSyncBinding, next: Partial<MdSyncBinding>) => {
    updateBinding(index, { ...binding, ...next }, 'format');
  };

  return (
    <>
      {bindings.map((binding, index) => {
        const unset = !binding.file.trim() || !binding.heading.trim();
        const preview = previewFile(binding.file, today);
        const subDir = subDirOf(binding.file, today);
        return (
          <div className="sync__fields" key={`${binding.kind}-${index}`}>
            <h5 className="sync__kind">{MD_SYNC_KIND_LABELS[binding.kind]}</h5>
            <p className="sync__desc">{kindHint(binding.kind)}</p>

            <div className="sync__grid">
              <label className="sync__field">
                <span className="sync__label">文件模板（支持 {'{date}'}）</span>
                <input
                  className="sync__input"
                  value={binding.file}
                  disabled={saving}
                  spellCheck={false}
                  placeholder="{date}.md"
                  aria-label={`${MD_SYNC_KIND_LABELS[binding.kind]}文件模板`}
                  onChange={(event) => patch(index, binding, { file: event.target.value })}
                />
              </label>
              <label className="sync__field">
                <span className="sync__label">标题行</span>
                <input
                  className="sync__input"
                  value={binding.heading}
                  disabled={saving}
                  spellCheck={false}
                  placeholder="#### 事项计时"
                  aria-label={`${MD_SYNC_KIND_LABELS[binding.kind]}标题行`}
                  onChange={(event) => patch(index, binding, { heading: event.target.value })}
                />
              </label>
            </div>

            {/* 只读预览：用户在这里看到的就是文件被写成的样子（不需要保存就能看） */}
            <p className="sync__path">
              今天会写成：{preview || '（文件模板为空）'}
              {subDir ? `；会建子目录 ${subDir}` : ''}
            </p>

            {/* 拆分带来的唯一代价，用一句话补掉（PRD 4.1 的「指路行」） */}
            <p className="data__note">文件放在哪个目录，在下面「Markdown 同步」里改。</p>

            {unset && <p className="data__note">这一行还没填完。</p>}
            {inline?.index === index && <p className="sync__error">{inline.text}</p>}
          </div>
        );
      })}
      <p className="data__note">
        文件模板支持 {'{date}'}、{'{yyyy}'}、{'{MM}'}、{'{dd}'}，允许带 / 建子目录；
        标题行必须是 # 开头的形式。同步只改目标标题下的区块，日记其他内容不动。
      </p>
    </>
  );
}
