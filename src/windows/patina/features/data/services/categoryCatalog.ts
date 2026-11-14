import { ProcessMapper } from "../../../shared/classification/processMapper.ts";
import type { Locale, UiText } from "../../../shared/i18n/index.ts";
import type { ClassificationBootstrapData } from "../../classification/services/classificationService.ts";
import { buildQuickClassificationCategoryOptions } from "../../classification/services/quickClassification.ts";
import type { AppEditCategoryOption } from "../hooks/useAppEditCategoryAdmin.ts";
import { collectCategoryUsage } from "./appEditDraft.ts";

/**
 * 「分类候选 + 用量」这一对派生量（[本轮] 从 `useAppEditDialog` 抽出来的共用件）。
 *
 * 为什么必须共用：本轮「分类管理」多了一扇独立的门（数据页分类 tab 的「管理分类」），
 * 它和「应用设置」弹窗要看到**同一份**候选与用量 —— 否则同一页里两处会给出不同的
 * 删除影响面（一处 3 个在用、一处 5 个在用），用户没法判断删了会伤到什么。
 * 复制一份等于把"色块取色规则"与"用量口径"各维护两次，早晚分叉。
 *
 * 色块取的是**生效**颜色：自定义覆盖优先，没有就用该分类的默认色。不能留空串 ——
 * `QuietColorField` 会把空串当颜色去解析，`hexToRgb("")` 出来是黑色，用户看到的是
 * 「这个分类是黑的」，而不是「它还没被改过色」。
 */
export function buildAppEditCategoryOptions(
  bootstrap: ClassificationBootstrapData,
  text: UiText,
  locale: Locale,
): AppEditCategoryOption[] {
  return buildQuickClassificationCategoryOptions(bootstrap, text, locale).map((option) => ({
    ...option,
    color: bootstrap.loadedCategoryColorOverrides[option.value]
      ?? ProcessMapper.getDefaultCategoryColor(option.value),
  }));
}

/** 「多少个应用/域名正指着它」＝删除影响面（分类管理每行右侧那个读数） */
export function collectAppEditCategoryUsage(
  bootstrap: ClassificationBootstrapData,
): Record<string, number> {
  return collectCategoryUsage(bootstrap.loadedOverrides, bootstrap.loadedWebDomainOverrides);
}
