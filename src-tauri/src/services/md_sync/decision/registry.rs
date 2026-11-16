//! 挂起冲突的进程内注册表（`decision` 的存储层，不含判定逻辑）。
//!
//! 为什么不落库：挂起冲突是「**这一轮还没裁决**」的现场，进程重启后基线重建、
//! 冲突自然失效；落库反而会在重启后留下一条永远点不动的死条目。
//! 与 `runtime` 的基线同性质。审计（`md_decision_audit`）才是历史，那条落库。
//!
//! 为什么单独一个文件：`decision.rs` 的判定 + 这个注册表 + 单测合起来超过 300 行
//! 门禁。拆的是**存储**与**判定**，不是把函数随便挪几行。
//!
//! 状态的唯一真相是 `Entry.public.state`：展示行与「能不能弹窗」的判断读的是同一格，
//! 不另存一份 `state` 字段——两份状态迟早分叉。

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use chrono::NaiveDate;

use super::{ConflictState, PendingConflict};
use crate::models::md_sync::MdSyncBinding;

/// 注册表条目：除展示字段外，保留裁决所需的原始输入。
#[derive(Debug, Clone)]
pub(super) struct Entry {
    pub(super) binding: MdSyncBinding,
    pub(super) date: NaiveDate,
    pub(super) old_body: String,
    pub(super) new_body: String,
    pub(super) public: PendingConflict,
}

static REGISTRY: OnceLock<Mutex<HashMap<String, Entry>>> = OnceLock::new();

fn registry() -> &'static Mutex<HashMap<String, Entry>> {
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 登记/刷新一个冲突（幂等：同 id 覆盖；`Awaiting` 优先级高于 `Pending`，后台轮不降级）。
pub fn register(
    binding: &MdSyncBinding,
    date: NaiveDate,
    path: String,
    old_body: String,
    new_body: String,
    state: ConflictState,
) {
    let id = binding.key();
    let mut map = registry().lock().expect("decision registry poisoned");
    let next_state = match state {
        ConflictState::AwaitingDecision => ConflictState::AwaitingDecision,
        /* 状态只升不降：前台已经弹过窗，后台轮不得把它拽回挂起。 */
        ConflictState::PendingDecision => map
            .get(&id)
            .map_or(ConflictState::PendingDecision, |entry| entry.public.state),
    };
    let public = PendingConflict {
        id: id.clone(),
        kind: binding.kind,
        heading: binding.heading.clone(),
        path,
        date: date.format("%Y-%m-%d").to_string(),
        state: next_state,
    };
    map.insert(
        id,
        Entry {
            binding: binding.clone(),
            date,
            old_body,
            new_body,
            public,
        },
    );
}

/// 列出全部挂起冲突。
pub fn pending() -> Vec<PendingConflict> {
    registry()
        .lock()
        .expect("decision registry poisoned")
        .values()
        .map(|entry| entry.public.clone())
        .collect()
}

/// 只列「能弹窗、正在等用户」的那部分。
pub fn awaiting() -> Vec<PendingConflict> {
    registry()
        .lock()
        .expect("decision registry poisoned")
        .values()
        .filter(|entry| entry.public.state == ConflictState::AwaitingDecision)
        .map(|entry| entry.public.clone())
        .collect()
}

/// 把后台挂起的冲突提升为前台待裁决（用户进了设置页 / 点了手动同步）。
pub fn promote_all() {
    let mut map = registry().lock().expect("decision registry poisoned");
    for entry in map.values_mut() {
        if entry.public.state == ConflictState::PendingDecision {
            entry.public.state = ConflictState::AwaitingDecision;
        }
    }
}

/// 取一份快照（`resolve` 用）。先取后放锁：`resolve` 随后要 `await` 写文件，
/// 跨 `await` 持锁会让后台轮卡死在 `register` 上。
pub(super) fn snapshot(id: &str) -> Option<Entry> {
    registry()
        .lock()
        .expect("decision registry poisoned")
        .get(id)
        .cloned()
}

/// 改一个条目的状态（`Deferred` 回挂起）。
pub(super) fn set_state(id: &str, state: ConflictState) {
    let mut map = registry().lock().expect("decision registry poisoned");
    if let Some(entry) = map.get_mut(id) {
        entry.public.state = state;
    }
}

/// 移除一个条目（A/B 落实后调用）。
pub(super) fn remove(id: &str) {
    registry()
        .lock()
        .expect("decision registry poisoned")
        .remove(id);
}

/// 清空注册表。**只给单测用**——注册表是全局单例，用例之间必须互不干扰。
/// `pub(crate)` 是为了让 `src/tests/**` 的集成用例也够得着（它们不在本模块子树下）。
#[cfg(test)]
pub(crate) fn clear() {
    registry()
        .lock()
        .expect("decision registry poisoned")
        .clear();
}

/* 注册表是全局单例，`cargo test` 默认并行跑用例 ⇒ 用例之间会互相看见对方的条目
（实测：「提升后进入可弹窗集合」拿到 2 条，因为另一个用例的条目还在）。
所以所有碰注册表的用例都必须先拿这把锁——**包括 `src/tests/` 下的集成用例**，
它们与单测在同一个 lib test 进程里。 */
#[cfg(test)]
static TEST_LOCK: Mutex<()> = Mutex::new(());

/// 串行化访问注册表的测试锁（`cfg(test)` 专用）。
#[cfg(test)]
pub(crate) fn test_guard() -> std::sync::MutexGuard<'static, ()> {
    TEST_LOCK.lock().unwrap_or_else(|err| err.into_inner())
}
