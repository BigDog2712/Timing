/**
 * Timing — 「加载 effect 里不许再有 `loadedRef` 守卫」的源码哨兵（本轮）
 * -----------------------------------------------------------------------------
 * 为什么需要它：`loadedRef` 守卫 + `active` 作废这两件事**各自都合理**，放在一起才致命
 * —— 而且在 jsdom（默认不用 StrictMode）与生产构建里都不报错。同一个形状这一个月里
 * 出现了两次（先「管理分类」、再「应用设置」弹窗），两次都是 `npm run dev` 里永久停在
 * 「加载中」，CI 全绿。渲染级用例（`components/DataCategoryManageStrictMode.test.tsx` /
 * `components/DataAppEditDialogStrictMode.test.tsx`）能抓住已经存在的缺陷，但抓不住
 * "下一个人顺手把缓存守卫加回来"这次编辑 —— 那一次编辑发生在下一次 `npm test` 之前。
 *
 * 所以这条哨兵钉的是**源码形状**：两份 hook 的加载 effect 里都不许出现 `loadedRef`。
 * 判据读注释剥离后的代码，因为两份文件的文件头**必须**留着一段"别加回来 + 为什么"的
 * 说明（那段说明里就写着 `loadedRef`，它正是防复发的另一半）。
 *
 * 变异靶点：任意一份 hook 里加回 `const loadedRef = useRef(false);` + `if (loadedRef.current) return;`
 * —— 本条立刻红（实测见交付说明）。
 *
 * ## 这条哨兵的**边界**（别对它过度承诺）
 *
 * ① **它只挡"朴素删除"**：整段删掉加载 effect 且**不留任何 token** —— 三条正向断言
 *    （`let active = true;` / `active = false;` / `setLoading(false)`）是 **presence-only**
 *    的字面量检查，只要文件里还留着这三串字符就全绿。QA 做过的空转实验正是这个结论：
 *    把 effect 整段删掉、只留一段死代码凑齐这三个 token → 本条全绿，只有渲染级的两条
 *    StrictMode 用例才红。所以**真正的语义护栏是渲染级那两条**
 *    （`DataAppEditDialogStrictMode.test.tsx` / `DataCategoryManageStrictMode.test.tsx`：
 *    它们会真的在 StrictMode 下挂载、真的断言「加载中」会结束），本条只是提前一步的哨兵。
 * ② **它是"名字级"护栏**：只禁字面量 `loadedRef`。把守卫改名成 `hasLoaded` 就绕过去了
 *    —— 这是**刻意接受的取舍**，不是遗漏：形状级断言（"加载 effect 内不许出现
 *    `if (X.current) return`"）会误伤其它正当的 ref 守卫（例如"卸载后不再写 state"这类
 *    完全合法的早退），为了堵一个改名就能绕的洞去换一片误报不划算。
 *    本条的价值是「下一次有人复制粘贴旧代码」时立刻响，而不是形式化证明不存在守卫。
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

/**
 * 去掉行注释与块注释，只留可执行代码。
 *
 * 为什么不能直接 `not.toContain("loadedRef")`：两份文件的文件头注释**必须**写着
 * 「这里故意没有 `loadedRef` 守卫（别加回来）」以及那段机制说明 —— 那是防复发的
 * 另一半，不该为了迁就一条断言删掉。`(^|[^:])` 这个前置字符是为了不把 `https://`
 * 这类字符串里的双斜杠当注释起点（两份文件里目前都没有，留着当护栏）。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const APP_EDIT_DIALOG = stripComments(
  read("src/windows/activity/features/data/hooks/useAppEditDialog.ts"),
);
const CATEGORY_ADMIN = stripComments(
  read("src/windows/activity/features/data/hooks/useCategoryAdminSession.ts"),
);

describe("分类 / 应用设置两条加载路径 · 不许有 loadedRef 守卫", () => {
  it("g01_use_app_edit_dialog_has_no_loaded_ref_guard", () => {
    expect(
      APP_EDIT_DIALOG,
      "useAppEditDialog 里又出现了 loadedRef：StrictMode 下第二次 setup 会被守卫挡掉，"
      + "唯一那次加载的 active 已被 cleanup 置 false → 弹窗永久停在「加载中」",
    ).not.toContain("loadedRef");
    /* 正向判据（只挡**朴素删除**：整段删掉且不留 token —— 见文件头「这条哨兵的边界」①；
       语义护栏是渲染级的两条 StrictMode 用例，这三条是名字级/presence-only 的提前哨兵） */
    expect(APP_EDIT_DIALOG, "加载 effect 的 active 作废标记不见了").toContain("let active = true;");
    expect(APP_EDIT_DIALOG, "加载 effect 的 cleanup 不见了").toContain("active = false;");
    expect(APP_EDIT_DIALOG, "加载回落不见了（loading 永远不结束）").toContain("setLoading(false)");
  });

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
