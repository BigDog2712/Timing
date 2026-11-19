/**
 * Timing — 「加载 effect 里不许再有 `loadedRef` 守卫」的源码哨兵
 * -----------------------------------------------------------------------------
 * 为什么需要它：`loadedRef` 守卫 + `active` 作废这两件事**各自都合理**，放在一起才致命
 * —— 而且在 jsdom（默认不用 StrictMode）与生产构建里都不报错。同一个形状这一个月里
 * 出现了两次（先「管理分类」、再「应用设置」弹窗），两次都是 `npm run dev` 里永久停在
 * 「加载中」，CI 全绿。渲染级用例（`DataCategoryManageStrictMode.test.tsx`）能抓住已经
 * 存在的缺陷，但抓不住"下一个人顺手把缓存守卫加回来"这次编辑 —— 那一次编辑发生在下一次
 * `npm test` 之前。
 *
 * [0.12.4] 「应用设置」弹窗（分类 + 事项）已随分类能力一起下线，`useAppEditDialog.ts`
 * 不再存在，本哨兵只剩一份文件要看：`useCategoryAdminSession.ts`。
 *
 * 判据读注释剥离后的代码，因为那份文件的文件头**必须**留着「别加回来 + 为什么」的说明
 * （那段说明里就写着 `loadedRef`，它正是防复发的另一半）。
 *
 * ## 这条哨兵的**边界**（别对它过度承诺）
 *
 * ① **它只挡"朴素删除"**：三条正向断言（`let active = true;` / `active = false;` /
 *    `setLoading(false)`）是 **presence-only** 的字面量检查，只要文件里还留着这三串字符
 *    就全绿。真正的语义护栏是渲染级的 `DataCategoryManageStrictMode.test.tsx`，本条只是
 *    提前一步的哨兵。
 * ② **它是"名字级"护栏**：只禁字面量 `loadedRef`。把守卫改名成 `hasLoaded` 就绕过去了
 *    —— 这是**刻意接受的取舍**：形状级断言会误伤其它正当的 ref 守卫（例如"卸载后不再写
 *    state"这类完全合法的早退）。本条的价值是「下一次有人复制粘贴旧代码」时立刻响。
 */
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from "node:fs";
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { dirname, join } from "node:path";
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** `src/windows/activity/features/data/hooks/` → 仓库根（上溯六级） */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..", "..");
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

/** 去掉行注释与块注释，只留可执行代码（文件头那段说明里必须写着 `loadedRef`）。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const CATEGORY_ADMIN = stripComments(
  read("src/windows/activity/features/data/hooks/useCategoryAdminSession.ts"),
);

describe("分类管理加载路径 · 不许有 loadedRef 守卫", () => {
  it("g02_use_category_admin_session_has_no_loaded_ref_guard", () => {
    expect(
      CATEGORY_ADMIN,
      "useCategoryAdminSession 里又出现了 loadedRef：那条「管理分类永久加载中」的缺陷会原地复活",
    ).not.toContain("loadedRef");
    expect(CATEGORY_ADMIN, "加载 effect 的 active 作废标记不见了").toContain("let active = true;");
    expect(CATEGORY_ADMIN, "加载 effect 的 cleanup 不见了").toContain("active = false;");
    expect(CATEGORY_ADMIN, "加载回落不见了（loading 永远不结束）").toContain("setLoading(false)");
  });
});
