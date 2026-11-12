/**
 * 「一次读取的三态」——分析窗自有，给 `useTodayTodos` / `useTodayNotes` 与 `ModuleShell` 共用。
 *
 * 为什么不是两个布尔（`loading` + `failed`）：两个布尔能拼出 `loading && failed` 这种
 * **不存在**的状态，于是每个使用点都得记住"先判哪个"，迟早有一处判反；
 * 三态互斥时，"渲染"和"无障碍属性"只能从**同一个变量**派生，编不出矛盾。
 */
export type LoadStatus = "loading" | "ready" | "error";
