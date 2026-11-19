import { useEffect, useMemo, useRef, useState } from "react";

import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import { AppClassification } from "../../../shared/classification/appClassification.ts";
import { normalizeAppTags } from "../../../shared/classification/appOverrideCodec.ts";
import { normalizeTagPath } from "../../../../shared/tags/normalize.ts";
import { listTimingItemTags } from "../../../platform/persistence/timingReadRepository.ts";
import { listTagDefinitions } from "../../../platform/persistence/tagAdminGateway.ts";
import { ClassificationService } from "../../classification/services/classificationService.ts";

/**
 * 应用排行 · 双击后的**标签编辑**（[0.12.4] 取代原来的「分类设置」弹层）。
 *
 * 为什么不是「分类」：分类是每个应用一个值，改完只能靠一个颜色点体现；标签是
 * 多值 + 有层级，既能表达「这个应用同时属于 工作 和 学习」，也能和事项上的标签
 * 用同一套路径。存进 `__app_override::` 的 `tags` 字段（老行的 `category` 读时回落）。
 *
 * 保存仍走 `ClassificationService.saveAppOverride`：那条路已经处理了 canonical exe、
 * 删除态、候选同步与事件广播，另开一条写盘路径只会多一处「改名后颜色不刷新」。
 */
interface Props {
  exeName: string;
  displayName: string;
  onClose: () => void;
  onSaved?: () => void;
  onError?: (message: string) => void;
}

/** 与 `normalizeAppTags` 的上限一致：超出的部分保存时会被丢掉，所以在输入处就挡住 */
const MAX_TAGS = 12;

export default function AppTagDialog({ exeName, displayName, onClose, onSaved, onError }: Props) {
  const [tags, setTags] = useState<string[]>(() => AppClassification.getAppTags(exeName));
  const [options, setOptions] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    void Promise.all([listTagDefinitions(), listTimingItemTags()])
      .then(([catalog, assignments]) => {
        if (!alive) return;
        const all = new Set<string>(catalog);
        for (const row of assignments) for (const tag of row.tags) all.add(tag);
        setOptions([...all].sort((left, right) => left.localeCompare(right, "zh-CN")));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const merged = useMemo(() => {
    const all = new Set(options);
    for (const tag of tags) all.add(tag);
    return [...all].sort((left, right) => left.localeCompare(right, "zh-CN"));
  }, [options, tags]);

  /** 加一个标签；已经选过 / 到上限时给一句提示而不是静默失败 */
  const pick = (path: string) => {
    setHint("");
    if (!path) return;
    if (tags.includes(path)) {
      setHint("这个标签已经有了");
      return;
    }
    if (tags.length >= MAX_TAGS) {
      setHint(`最多 ${MAX_TAGS} 个标签`);
      return;
    }
    setTags([...tags, path]);
  };

  const add = (raw: string) => {
    let path: string;
    try {
      path = normalizeTagPath(raw);
    } catch (error) {
      setHint(error instanceof Error ? error.message : "标签不合法");
      return;
    }
    setDraft("");
    pick(path);
  };

  /** 底部「所有标签」里的一颗：已选就摘掉，没选就加上 */
  const toggle = (path: string) => {
    if (!tags.includes(path)) {
      pick(path);
      return;
    }
    setHint("");
    setTags(tags.filter((item) => item !== path));
  };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const current = AppClassification.getUserOverride(exeName) ?? {};
      const next = normalizeAppTags(tags);
      /* 只写 `tags`，**不碰** `category` / `categories`：那两个字段是老数据的读路径，
         而标签路径（`娱乐/燕云`）本来就不是合法的分类键，硬塞进去会被
         `normalizeAppOverride` 丢掉。老分类留着不影响展示 —— 读侧 `resolveAppTags`
         优先用 tags，只有 tags 为空时才回落分类。 */
      await ClassificationService.saveAppOverride(exeName, { ...current, tags: next });
      onSaved?.();
      onClose();
    } catch (error) {
      onError?.(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <QuietDialog
      open
      title={`${displayName || exeName} 的标签`}
      description="标签可多选，用斜杠表示层级（如 工作/开发）。"
      onClose={onClose}
      initialFocusRef={inputRef}
      actions={(
        <>
          <button type="button" className="at-button at-button--quiet" onClick={onClose}>
            取消
          </button>
          <button type="button" className="at-button" disabled={busy} onClick={() => void save()}>
            {busy ? "保存中…" : "保存"}
          </button>
        </>
      )}
    >
      <div className="at-tag-picked-head">
        <span className="at-tag-section-label">已选</span>
        <span className="at-tag-section-count">{tags.length} / {MAX_TAGS}</span>
      </div>
      <div className="at-tag-picked">
        {tags.length === 0 ? (
          <p className="at-tag-empty">还没有选标签 —— 在下面点一个，或直接输入新建。</p>
        ) : (
          tags.map((tag) => (
            <button
              key={tag}
              type="button"
              className="at-chip"
              title={`移除 #${tag}`}
              aria-label={`移除标签 #${tag}`}
              onClick={() => setTags(tags.filter((item) => item !== tag))}
            >
              #{tag} ×
            </button>
          ))
        )}
      </div>
      <input
        ref={inputRef}
        className="at-control mt-3 w-full"
        list="app-tag-options"
        placeholder="输入标签，回车添加"
        aria-label="应用标签"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === "," || event.key === "，") {
            event.preventDefault();
            add(draft);
          } else if (event.key === "Backspace" && draft === "" && tags.length > 0) {
            setTags(tags.slice(0, -1));
          }
        }}
      />
      <datalist id="app-tag-options">
        {merged.map((tag) => (
          <option key={tag} value={tag} />
        ))}
      </datalist>
      {hint && (
        <p className="mt-2 text-[var(--at-text-secondary)] at-text-caption" role="status">
          {hint}
        </p>
      )}
      {/* 底部把**所有**已知标签（定义行 + 事项上用过的）铺出来，点一下就是加/减。
          输入框适合"造一个新标签"，这里适合"从现有的里挑" —— 路径常常是
          `学习/考公` 这种带层级的，凭记忆敲容易敲成另一个标签。 */}
      <section className="at-tag-picker" aria-label="所有标签">
        <div className="at-tag-picked-head">
          <span className="at-tag-section-label">所有标签</span>
          <span className="at-tag-section-count">{merged.length} 个</span>
        </div>
        {merged.length === 0 ? (
          <p className="at-tag-empty">还没有任何标签，在上面输入后回车就是新建一个。</p>
        ) : (
          <div className="at-tag-picker-list" role="group" aria-label="所有标签">
            {merged.map((tag) => {
              const on = tags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  className="at-tag-chip"
                  data-selected={on}
                  aria-pressed={on}
                  aria-label={`${on ? "移除" : "添加"}标签 #${tag}`}
                  title={on ? `移除 #${tag}` : `添加 #${tag}`}
                  onClick={() => toggle(tag)}
                >
                  {on ? "✓ " : ""}#{tag}
                </button>
              );
            })}
          </div>
        )}
      </section>
    </QuietDialog>
  );
}
