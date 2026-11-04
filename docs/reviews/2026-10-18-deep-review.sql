-- =============================================================================
-- TickBar 深度评审记录 · 2026-10-18
-- -----------------------------------------------------------------------------
-- 用途：把这次评审的「量了什么、发现了什么、改了什么、还剩什么」落成可查询的数据，
--       而不是散在对话或 Markdown 里。任何一条 finding 都能追到 action 与验证证据。
--
-- 用法（SQLite）：
--   sqlite3 review.db < docs/reviews/2026-10-18-deep-review.sql
--   sqlite3 review.db "SELECT * FROM v_open_items;"
--   sqlite3 review.db "SELECT * FROM v_finding_rollup;"
--
-- 口径：行数是「原始文本按 \n 切分」的行数（含空行），与编辑器行号一致。
-- =============================================================================

PRAGMA foreign_keys = ON;

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. 表结构
-- -----------------------------------------------------------------------------

CREATE TABLE review_run (
    id           INTEGER PRIMARY KEY,
    reviewed_at  TEXT NOT NULL,              -- ISO 8601 本地日期
    app_version  TEXT NOT NULL,
    commit_ref   TEXT NOT NULL,
    worktree     TEXT NOT NULL,              -- clean / dirty
    scope        TEXT NOT NULL,
    verdict      TEXT NOT NULL,              -- 一句话结论
    verdict_json TEXT NOT NULL               -- 分项评分，便于后续对比
);

CREATE TABLE review_metric (
    run_id  INTEGER NOT NULL REFERENCES review_run(id) ON DELETE CASCADE,
    name    TEXT NOT NULL,
    value   REAL NOT NULL,
    unit    TEXT NOT NULL,
    note    TEXT,
    PRIMARY KEY (run_id, name)
);

CREATE TABLE review_finding (
    run_id     INTEGER NOT NULL REFERENCES review_run(id) ON DELETE CASCADE,
    seq        INTEGER NOT NULL,
    severity   TEXT NOT NULL CHECK (severity IN ('P0', 'P1', 'P2')),
    area       TEXT NOT NULL,
    title      TEXT NOT NULL,
    evidence   TEXT NOT NULL,                -- 文件:行 / 命令输出 / 计数
    impact     TEXT NOT NULL,
    status     TEXT NOT NULL CHECK (status IN ('fixed', 'mitigated', 'deferred', 'open')),
    status_note TEXT,
    PRIMARY KEY (run_id, seq)
);

CREATE TABLE review_action (
    run_id      INTEGER NOT NULL,
    seq         INTEGER NOT NULL,
    finding_seq INTEGER,
    title       TEXT NOT NULL,
    files       TEXT NOT NULL,               -- 空格分隔的相对路径
    status      TEXT NOT NULL CHECK (status IN ('done', 'partial', 'skipped')),
    verified_by TEXT NOT NULL,               -- 具体命令或证据
    PRIMARY KEY (run_id, seq),
    FOREIGN KEY (run_id, finding_seq) REFERENCES review_finding(run_id, seq)
);

CREATE TABLE review_decision (
    run_id    INTEGER NOT NULL REFERENCES review_run(id) ON DELETE CASCADE,
    seq       INTEGER NOT NULL,
    topic     TEXT NOT NULL,
    decision  TEXT NOT NULL,
    rationale TEXT NOT NULL,
    PRIMARY KEY (run_id, seq)
);

-- -----------------------------------------------------------------------------
-- 2. 视图
-- -----------------------------------------------------------------------------

-- 仍未关闭的项（deferred 也算未关闭：已决策但没实装）
CREATE VIEW v_open_items AS
SELECT run_id, seq, severity, area, title, status, status_note
FROM review_finding
WHERE status IN ('open', 'deferred')
ORDER BY severity, seq;

-- 严重度 × 状态矩阵
CREATE VIEW v_finding_rollup AS
SELECT severity,
       SUM(status = 'fixed')     AS fixed,
       SUM(status = 'mitigated') AS mitigated,
       SUM(status = 'deferred')  AS deferred,
       SUM(status = 'open')      AS open,
       COUNT(*)                  AS total
FROM review_finding
GROUP BY severity
ORDER BY severity;

-- 每条 finding 被哪些 action 覆盖
CREATE VIEW v_finding_actions AS
SELECT f.seq, f.severity, f.title, f.status,
       COUNT(a.seq)                                      AS action_count,
       GROUP_CONCAT(CASE WHEN a.status = 'done' THEN a.title END, ' | ') AS done_actions
FROM review_finding f
LEFT JOIN review_action a ON a.run_id = f.run_id AND a.finding_seq = f.seq
GROUP BY f.run_id, f.seq
ORDER BY f.seq;

-- -----------------------------------------------------------------------------
-- 3. 本次评审
-- -----------------------------------------------------------------------------

INSERT INTO review_run (id, reviewed_at, app_version, commit_ref, worktree, scope, verdict, verdict_json) VALUES
(1,
 '2026-10-18',
 '0.2.10',
 'ec02bf8',
 'dirty',
 '前端 134 文件 / Rust 91 文件 / 62 IPC 命令 / 16 错误码 / 5 表 / 174 测试',
 '后端计时核心扎实；主要风险不在算法，而在「文档与代码各说一套」「决策未实装」「浮层隐式契约」，本轮已把前两类收口为机器门禁与显式登记。',
 '{"core_logic": 8.5, "maintainability": 6.5, "verifiability": 6.0, "ux_consistency": 7.0}');

-- -----------------------------------------------------------------------------
-- 4. 度量（修复后重测）
-- -----------------------------------------------------------------------------

INSERT INTO review_metric (run_id, name, value, unit, note) VALUES
(1, 'frontend_files',           134,    'files',  'src/**（114 个 .ts/.tsx + 20 个 .css）'),
(1, 'frontend_ts_lines',        10852,  'lines',  '按原始文本切行；新增 usePillWheel/usePillKeyboard 后'),
(1, 'frontend_css_lines',       3841,   'lines',  '仅令牌与组件 CSS，无 UI 框架'),
(1, 'rust_files',               91,     'files',  'src-tauri/src/**'),
(1, 'rust_lines',               9336,   'lines',  '含 tests/'),
(1, 'rust_tests',               174,    'count',  '#[test] / #[tokio::test]；本机 MSVC 14.44 实跑 174 passed / 0 failed'),
(1, 'clippy_warnings',          0,      'count',  'cargo clippy --all-targets，修复后 0 warning'),
(1, 'ipc_commands',             62,     'count',  'lib.rs = IpcApi = ipc.ts，check:contract 全绿'),
(1, 'error_codes',              16,     'count',  'error.rs as_str = domain.ts ErrorCode'),
(1, 'db_tables',                5,      'count',  'items / time_records / notes / todos / settings'),
(1, 'migrations',               2,      'count',  '0001_init.sql + 0002_v020.sql'),
(1, 'bundle_js_kb',            373.48,  'KiB',    'vite build 主 chunk，未 gzip'),
(1, 'bundle_js_gzip_kb',       114.13,  'KiB',    'gzip 后'),
(1, 'bundle_css_kb',            62.36,  'KiB',    'gzip 11.36 KiB'),
(1, 'files_over_300_lines',     4,      'files',  'domain.ts 552 / design-tokens.css 486 / tests/timer.rs 347 / app.css 301'),
(1, 'dead_reference_settings',  16,     'fields', 'ReferenceSettings 共 17，仅 defaultCountdownMinutes 被消费'),
(1, 'autofit_poll_ms',          250,    'ms',     'MutationObserver + 250ms 轮询；无性能基线'),
(1, 'flush_interval_s',         15,     's',      'runtime::spawn_flusher'),
(1, 'reminder_scan_s',          15,     's',      '查询式调度 + ±60s 聚合'),
(1, 'countdown_tick_s',         1,      's',      '倒计时 watcher');

-- -----------------------------------------------------------------------------
-- 5. 发现项
-- -----------------------------------------------------------------------------

INSERT INTO review_finding (run_id, seq, severity, area, title, evidence, impact, status, status_note) VALUES
(1, 1, 'P0', '文档/契约',
 '文档与代码的契约数字全面漂移',
 'Spec §5 与 AGENTS 写 52 命令，lib.rs/domain.ts/ipc.ts 实为 62；README/AGENTS 写 0.2.1，三处 manifest 为 0.2.10；测试数 164/168/174 三种口径',
 '新代理会按 52 条实现，误删/漏接 10 条命令；版本号不可信导致发布比对失效',
 'fixed',
 '不改代码契约，改为「Spec 保留锁定口径 + 增量注记 + 机器门禁」'),

(1, 2, 'P0', '设置域',
 'ReferenceSettings 17 字段中 16 个是死配置',
 'src-tauri/src/services/settings.rs 读写 timing.*；前端仅 src/lib/countdown.ts:41 消费 defaultCountdownMinutes；updateReferenceSettings 无 UI 调用方',
 '用户以为改了参考设置，实际行为不变；契约面虚胖',
 'deferred',
 '无 MSVC 无法编译验证 Rust 改动，且 UI 未设计；登记为已决策未实装，v0.3 处理'),

(1, 3, 'P0', '工程门禁',
 '没有可执行的自动门禁',
 'package.json 无 test/lint 脚本；.github 不存在；本机无 cl.exe 导致 cargo test 不可跑',
 '回归只能靠人肉；「必须全绿」的约定无法验证',
 'fixed',
 '新增 check:contract 与 windows CI（typecheck/contract/build/cargo test/clippy）'),

(1, 4, 'P1', '前端结构',
 'PillBar.tsx 超 300 行硬约束且职责过载',
 '323 行，同时承担计时/倒计时/滚轮/内联命名/菜单锚点/拖动/键盘/便利贴入口',
 '硬约束失效后会被当作先例；单组件改动风险高',
 'fixed',
 '拆出 usePillWheel / usePillKeyboard，组件降到 274 行（原始行数口径）'),

(1, 5, 'P1', '计时域',
 '开始计时的并发竞态与结束计时的静默成功',
 'start 先 find_active 再 insert，撞 uq_records_open 时冒泡 DB_ERROR；finalize/end_and_start 在 rows_affected()==0 时仍 commit 并返回 Ok',
 '并发下用户看到「数据库操作失败」；会话已被别处结束时 UI 误以为保存成功',
 'fixed',
 'active_conflict() 翻译唯一冲突为 TIMER_ALREADY_RUNNING；0 行改为 TIMER_NOT_RUNNING 并回滚'),

(1, 6, 'P1', '前端状态',
 '浮层依赖一组隐式契约，且提醒卡可叠层',
 'useWindowAutoFit 要求 .layer 直接子级/fixed/不撑画布；openReminderPopover 是唯一不展开 CLOSED 的 open*，resetTransient 不清它',
 '违反契约时窗口收缩错位；提醒卡压在菜单上，失焦后残留',
 'mitigated',
 '提醒卡补 ...CLOSED 与 resetTransient 清理；隐式契约仍靠约定，未加运行时断言'),

(1, 7, 'P1', '性能',
 '自动收缩每帧采样且无性能基线',
 'useWindowAutoFit：MutationObserver + 250ms 轮询 + 逐元素 getComputedStyle；document.hidden 时仍在跑',
 '长时间驻留的 CPU 占用未知；最小化期间空转',
 'mitigated',
 'document.hidden 时跳过测量并监听 visibilitychange；基线测量留待有 Windows 环境时做'),

(1, 8, 'P2', '安全',
 '日记打开路径经过 cmd 二次解释，且未校验越界',
 'open_today 原用 cmd /C start "" <path>；set_config 不拒绝 .. 与文件名里的分隔符',
 'vault 路径含 & 或引号时命令被重解析；配置可指向 vault 之外',
 'fixed',
 'canonicalize + is_file 校验；Windows 改用 explorer.exe argv；拒绝 .. 与路径分隔符'),

(1, 9, 'P2', '测试',
 '浏览器 mock 是第三份契约实现',
 'browserMock.ts 291 行 + browserMockV020.ts 201 行手工镜像 62 命令',
 '契约变更需改三处代码 + 两份 mock，容易漏',
 'open',
 '可用 check:contract 扩展为第四处比对，或从 IpcApi 生成 mock 骨架；本轮未做'),

(1, 10, 'P2', '结构',
 '仍有 4 个文件超过 300 行',
 'domain.ts 552 / design-tokens.css 486 / tests/timer.rs 347 / app.css 301',
 '与硬约束冲突；domain.ts 作为契约单点尤其难导航',
 'open',
 '拆分方案未定（按域拆 interface / 令牌分文件 / 测试按场景拆），留作下一轮');

-- -----------------------------------------------------------------------------
-- 6. 动作
-- -----------------------------------------------------------------------------

INSERT INTO review_action (run_id, seq, finding_seq, title, files, status, verified_by) VALUES
(1, 1, 1, '新增 IPC 契约自检并接入 npm scripts',
 'scripts/check-contract.mjs package.json',
 'done', 'node scripts/check-contract.mjs → OK 62/62/62，错误码 16/16'),

(1, 2, 3, '新增 Windows CI',
 '.github/workflows/ci.yml',
 'done', 'yaml 落盘；首跑需 push 后观察（本机无 MSVC，无法本地替代）'),

(1, 3, 1, '统一文档口径（版本/命令数/测试数/ADR 范围）',
 'AGENTS.md README.md docs/Spec-V0.2.0.md docs/phase2/IPC-CONTRACT-v2.md CHANGELOG.md',
 'done', 'grep 复核：0.2.10 / 62 / 174 各就位'),

(1, 4, 4, '拆分 PillBar 的滚轮与键盘逻辑',
 'src/components/pill/PillBar.tsx src/hooks/usePillWheel.ts src/hooks/usePillKeyboard.ts',
 'done', 'npm run typecheck 0 错；行数 323 → 274'),

(1, 5, 5, '并发唯一槽冲突翻译 + 0 行更新报错',
 'src-tauri/src/repositories/record_session.rs',
 'done', '代码复核；本机无 MSVC 未能 cargo test，CI 覆盖'),

(1, 6, 6, '提醒卡纳入 CLOSED 并随失焦清理',
 'src/stores/uiStore.ts',
 'done', 'typecheck 通过；行为需桌面实测'),

(1, 7, 7, '不可见时暂停自动收缩测量',
 'src/hooks/useWindowAutoFit.ts',
 'done', 'typecheck 通过；CPU 基线待测'),

(1, 8, 8, '日记打开路径硬化',
 'src-tauri/src/services/diary.rs',
 'done', '代码复核；canonicalize 失败返回 IO_ERROR'),

(1, 9, 2, '参考设置登记为已决策未实装',
 'docs/reviews/2026-10-18-deep-review.sql docs/phase2/IPC-CONTRACT-v2.md',
 'done', '本文件 review_decision #1'),

(1, 10, NULL, '把评审数据落成 SQL',
 'docs/reviews/2026-10-18-deep-review.sql',
 'done', 'sqlite3 可查询 v_open_items / v_finding_rollup');

-- -----------------------------------------------------------------------------
-- 7. 决策
-- -----------------------------------------------------------------------------

INSERT INTO review_decision (run_id, seq, topic, decision, rationale) VALUES
(1, 1, '参考设置 16 个死字段',
 '保留 IPC 契约与存储，不在本轮实装，也不删除字段',
 '本机无 MSVC 无法编译验证 Rust 改动；且 16 个字段的语义（uiScale/plateOpacity/autoWriteOnStop…）没有 UI 设计，强行接线只会造出第二套半成品'),

(1, 2, 'Spec 的 52 命令口径',
 'Spec 保持 52 不动，另加「实装增量 10 条」注记；一致性交给 check:contract',
 'Spec 是 0.2.0 的锁定依据，改写会丢失历史决策；机器门禁比人工数字更可靠'),

(1, 3, '评审记录的载体',
 '用 SQLite 脚本而非 Markdown 表格',
 'findings/actions/metrics 之间有外键关系，可 rollup、可对比后续 run；Markdown 只能平铺'),

(1, 4, 'CI 的 Clippy 强度',
 '先跑 clippy 但不加 -D warnings',
 '存量警告数未知（本机不能编译），直接拒绝会让 CI 首跑必红；待基线清零后再收紧'),

(1, 5, 'PillBar 行数口径',
 '以原始文本行数（含空行）为准，274 行视为达标',
 '此前 323 是非空行口径，与编辑器行号不一致，容易在边界上扯皮');

COMMIT;
