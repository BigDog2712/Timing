import type { Locale } from "../../shared/i18n/index.ts";

/**
 * 应用排行行上「工具」标记的文案（[0.12.6 · P0-9]）。
 *
 * ## 为什么单独成文件
 *
 * `copy.ts`（`DASHBOARD_COPY`）已经贴着单文件硬上限，且本轮另一位工程师在改同一份文件
 * —— 两处同时改必然冲突。口径与那张表**完全一致**：`Record<Locale, …>`、四语言齐全、
 * 不进 `src/shared/i18n/**`（那是按索引对齐的位置数组，插一行会整体错位）。
 *
 * ## 为什么只有三个键
 *
 * 标记本身是**一行字**（`工具`），信息量却不够：「工具」在中文里既可能是名词（工具栏）
 * 也可能是"这个应用是工具"，所以第二句 `title` 必须把**后果**说出来。用户看到总时长
 * 变少时，能顺着这两个字找到解释。
 *
 * 第三个键（`emptyAllTools`）是同一件事的另一面：一整天**只有**工具类应用时，计时卡的环
 * 里一段都没有（工具类不进应用维度），空态若照旧写"今天还没有记录"，用户会拿它跟
 * 排行里那三行时长对照 —— 一句看得见的假话。所以空态要把"为什么空"说出来。
 * 它跟上面两句必须**同一套口径**（都是"不计入统计"），三句话分开写就会漂成三种解释。
 *
 * ## 为什么只说「总量与分类分布」，不说「时间统计」
 *
 * P0-9 原本写的是「分布 / 趋势 / 总量」，但**趋势（今日分时柱）本轮明确不剔除工具类**
 * —— 它读的是后端逐桶并集，拿不到"每小时里哪个应用占了多少"，逐应用扣除在前端做不了
 * （见 `docs/design/2026-11-20-item-card-ai-tagging.md` 风险 3）。文案要是笼统写成
 * 「不计入时间统计」，用户在趋势卡上就会看到"说好不计入的时长还在柱子里"，
 * 于是验收被判不一致。**这里写的是已经做到的那一半**；等趋势侧有了逐应用桶，
 * 再把这句话扩回去。
 */
export interface ToolTagCopy {
  /** 行上的标记文字（12px，跟在应用名后面） */
  toolBadge: string;
  /** 标记的 `title`：说清"为什么它能不计入统计" */
  toolHint: string;
  /**
   * 计时卡**空态**（今天只有工具类应用时那一句）。`duration` 已由
   * `formatDashboardDuration` 格式化好，文案只负责把它放进句子里。
   */
  emptyAllTools: (duration: string) => string;
}

export const TOOL_TAG_COPY: Record<Locale, ToolTagCopy> = {
  "zh-CN": {
    toolBadge: "工具",
    toolHint: "工具类应用，不计入总量与分类分布",
    emptyAllTools: (duration) => `今天只有工具类应用（${duration}），不计入统计`,
  },
  "en-US": {
    toolBadge: "Tool",
    toolHint: "Tool app — excluded from the total and category breakdown",
    emptyAllTools: (duration) => `Only tool apps today (${duration}) — not counted in stats`,
  },
  "ru-RU": {
    toolBadge: "Инструмент",
    toolHint: "Приложение-инструмент: не входит в итог и разбивку по категориям",
    emptyAllTools: (duration) => `Сегодня только приложения-инструменты (${duration}) — в статистику не входят`,
  },
  es: {
    toolBadge: "Herramienta",
    toolHint: "Aplicación de herramienta: no cuenta en el total ni en el desglose por categoría",
    emptyAllTools: (duration) => `Hoy solo aplicaciones de herramienta (${duration}): no cuentan en las estadísticas`,
  },
};
