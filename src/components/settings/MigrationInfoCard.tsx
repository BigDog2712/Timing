/**
 * Timing — 设置 · 通用页签的「数据迁移」卡（V0.5.0 新增）
 * -----------------------------------------------------------------------------
 * 为什么需要它：改名把数据目录从 `com.tickbar.app` 搬到 `com.timing.app`，
 * 迁移本身发生在**窗口出现之前**（`lib.rs::run()` 开头），用户看不到任何过程。
 * 如果没有这块，迁移成功与「数据丢了」在用户眼里长得一模一样——都能打开，
 * 都不知道原来那些事项去哪了。
 *
 * 只做三件事，一件不多：
 *   1. 说清数据从哪来（后端判定好的 `source`，前端**不做二次推断**）；
 *   2. 迁移成功时给出可核对的数字（时间 / 版本 / 行数 / 字节数）；
 *   3. 旧目录还在时给一个「打开旧数据目录」的按钮（后端重算路径，见 migrationActions）。
 *
 * 文案与 `source` 的对应关系由 ARCHITECTURE §3.3 固定，五值互斥、无兜底分支遗漏
 * （`Record<MigrationSource, …>` 让新增枚举值在编译期就报错，而不是静默显示空白）。
 *
 * 移动端不挂载本卡（迁移只发生在桌面）：由调用方 `GeneralTab` 用 `IS_MOBILE` 拦。
 * 分层：组件不碰 `ipc`（L1 机械门禁），数据一律经 `services/migrationActions`。
 */
import { useEffect, useState } from 'react';
import { migrationActions } from '../../services/migrationActions';
import { errorText } from '../../services/ipc';
import type { MigrationInfo, MigrationSource, RowCounts } from '../../types/domain';

/** 每个来源的一句话结论 + 一句补充说明（null = 不显示补充行） */
const SOURCE_COPY: Record<MigrationSource, { title: string; hint: string | null }> = {
  legacy: {
    title: '已从 TickBar 迁移',
    hint: '旧数据目录会原样保留（只复制、不移动），可随时手动清理。',
  },
  pending: {
    title: '旧数据待迁移',
    hint: '上次你选择了「以空白数据启动」。下次启动会再试一次，旧数据不会被删除。',
  },
  unattached: {
    title: '发现未采用的旧数据',
    hint: '当前用的是新目录里的数据，旧目录里仍有内容。需要的话可以打开看一眼。',
  },
  skipped: {
    title: '已跳过迁移（开发模式）',
    hint: '本次进程按开关跳过了迁移；正常启动（不带 TIMING_SKIP_MIGRATE）会自动迁移。',
  },
  fresh: {
    title: '全新数据',
    hint: '没有找到旧版本留下的数据目录，一切从零开始。',
  },
};

/** 字节数 → 人类可读（迁移库通常 80 KB ~ 数 MB，保留一位小数足够） */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 迁移时刻：后端给的是本地时区 ISO8601 带偏移（`2026-11-04T15:20:31+08:00`）。
 * 这里只做**字符串切分**，不经 `Date`——`Date` 会按运行环境时区再换算一次，
 * 而这条时间本来就是本地时间，换算只会把它挪错。
 */
function formatMigratedAt(raw: string): string {
  const at = raw.indexOf('T');
  if (at < 0) return raw;
  const date = raw.slice(0, at);
  const time = raw.slice(at + 1, at + 6);
  return `${date} ${time}`;
}

/** 五表行数摘要（顺序与 `RowCounts` 字段一致，用户认的是中文名） */
function formatRows(rows: RowCounts): string {
  return [
    `事项 ${rows.items}`,
    `记录 ${rows.timeRecords}`,
    `待办 ${rows.todos}`,
    `便利贴 ${rows.notes}`,
    `设置 ${rows.settings}`,
  ].join(' · ');
}

export function MigrationInfoCard() {
  const [info, setInfo] = useState<MigrationInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    /* 组件可能在响应到达前被卸载（切页签）；用 alive 标记避免对已卸载组件 setState */
    let alive = true;
    migrationActions
      .load()
      .then((next) => {
        if (alive) setInfo(next);
      })
      .catch((err: unknown) => {
        if (alive) setError(errorText(err));
      });
    return () => {
      alive = false;
    };
  }, []);

  const openLegacyDir = async (): Promise<void> => {
    setError(null);
    setOpening(true);
    try {
      await migrationActions.openLegacyDir();
    } catch (err) {
      /* 目录被用户手动删掉是最常见的失败：把原因说出来，别让按钮「点了没反应」 */
      setError(errorText(err));
    } finally {
      setOpening(false);
    }
  };

  /* 首帧：还没拿到信息就不占位——设置页塞一个「加载中」只会让内容跳动 */
  if (!info && !error) return null;

  const copy = info ? SOURCE_COPY[info.source] : null;
  const migratedAt = info?.migratedAt ? formatMigratedAt(info.migratedAt) : null;
  const rowsText = info?.rowCounts ? formatRows(info.rowCounts) : null;

  return (
    <section className="card">
      <h3 className="card__title">数据迁移</h3>

      {copy && (
        <p className="mig__title" data-source={info?.source}>
          {copy.title}
          {migratedAt && <span className="setting-row__hint">{migratedAt}</span>}
        </p>
      )}

      {copy?.hint && <p className="mig__hint">{copy.hint}</p>}

      {rowsText && (
        <p className="mig__meta">
          {rowsText}
          {info?.dbBytes != null && <span className="setting-row__hint">{formatBytes(info.dbBytes)}</span>}
        </p>
      )}

      {info?.appVersionAtMigration && (
        <p className="mig__meta">迁移时版本 v{info.appVersionAtMigration}</p>
      )}

      {info?.legacyDir && (
        <p className="mig__path" title={info.legacyDir}>
          {info.legacyDir}
        </p>
      )}

      {info?.legacyExists && (
        <button
          type="button"
          className="btn btn--ghost mig__btn"
          disabled={opening}
          onClick={() => void openLegacyDir()}
        >
          {opening ? '正在打开…' : '打开旧数据目录'}
        </button>
      )}

      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
