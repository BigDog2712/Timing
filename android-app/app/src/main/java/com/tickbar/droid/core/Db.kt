package com.tickbar.droid.core

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/**
 * 本地库。表名 / 列名与桌面端 `src-tauri/src/migrations/0001~0002` **同构**，
 * 只是砍掉了安卓这一版暂时用不到的列（提醒、置顶、颜色等），
 * 目的是将来导出或做「手机 → 桌面」同步时不用再做一次字段映射。
 *
 * 为什么手写 `SQLiteOpenHelper` 而不是 Room：
 * 骨架阶段零第三方依赖（连 AndroidX 都不引），Room 要拖 kapt / KSP 一整条工具链，
 * 而这里一共就三张表、十来条 SQL，手写反而更清楚。
 *
 * 版本策略：`VERSION` 只增不减。升级走 [onUpgrade] 里的 `when` 阶梯，
 * 每加一版补一个 `if (old < N)` 分支，不要回头改老分支（与桌面迁移铁律一致）。
 */
class Db(context: Context) : SQLiteOpenHelper(context.applicationContext, NAME, null, VERSION) {

    companion object {
        const val NAME = "tickbar.db"

        /**
         * v1：items / time_records / todos 三张表（0.1.0 ~ 0.2.0）
         * v2：两张表补同步三件套 uid / device_id / rev（0.3.0 起的代码要用）
         *
         * 这个数字**必须**跟着列变化走。0.3.0 加列时忘了升版本，导致装过 0.2.0 的机器
         * 升级后一保存就抛 `table time_records has no column named uid` —— 现在补上。
         */
        const val VERSION = 2

        // 事项。桌面 items 表是「记录归类主体」，安卓沿用同一张表，
        // 这样 time_records.item_id 外键语义一致。
        private const val ITEMS = """
            CREATE TABLE IF NOT EXISTS items (
              id          INTEGER PRIMARY KEY AUTOINCREMENT,
              name        TEXT    NOT NULL,
              color       TEXT,
              status      TEXT    NOT NULL DEFAULT 'active',
              is_system   INTEGER NOT NULL DEFAULT 0,
              sort_order  INTEGER NOT NULL DEFAULT 0,
              created_at  INTEGER NOT NULL,
              updated_at  INTEGER NOT NULL,
              deleted_at  INTEGER
            )
        """

        // 已结束的计时会话。与桌面 time_records 的对应关系：
        //   accumulated_sec ← 本次累计秒数（不含暂停空档）
        //   ended_at        ← 结束时刻；started_at = ended_at - 累计时长
        //   completed       ← 安卓独有：倒计时是否跑到 0（桌面记在 note 里，这里给个显式列）
        //
        // 同步三件套（uid / device_id / rev）现在不用，但必须先留：
        //   uid       跨设备稳定的身份，自增 id 只在本机有意义，撞了就废
        //   device_id 谁写的，冲突时按「同 uid 取 rev 大的」合并
        //   rev       逻辑版本，每次编辑 +1，不用墙钟（两台设备时间不会一致）
        private const val RECORDS = """
            CREATE TABLE IF NOT EXISTS time_records (
              id              INTEGER PRIMARY KEY AUTOINCREMENT,
              uid             TEXT    NOT NULL DEFAULT '',
              device_id       TEXT    NOT NULL DEFAULT '',
              rev             INTEGER NOT NULL DEFAULT 1,
              item_id         INTEGER NOT NULL,
              status          TEXT    NOT NULL DEFAULT 'saved',
              started_at      INTEGER NOT NULL,
              ended_at        INTEGER,
              accumulated_sec INTEGER NOT NULL DEFAULT 0,
              completed       INTEGER NOT NULL DEFAULT 0,
              created_at      INTEGER NOT NULL,
              updated_at      INTEGER NOT NULL,
              deleted_at      INTEGER
            )
        """

        private const val TODOS = """
            CREATE TABLE IF NOT EXISTS todos (
              id          INTEGER PRIMARY KEY AUTOINCREMENT,
              uid         TEXT    NOT NULL DEFAULT '',
              device_id   TEXT    NOT NULL DEFAULT '',
              rev         INTEGER NOT NULL DEFAULT 1,
              title       TEXT    NOT NULL,
              done        INTEGER NOT NULL DEFAULT 0,
              sort_order  INTEGER NOT NULL DEFAULT 0,
              created_at  INTEGER NOT NULL,
              updated_at  INTEGER NOT NULL,
              deleted_at  INTEGER
            )
        """

        private val INDEXES = listOf(
            "CREATE INDEX IF NOT EXISTS idx_records_ended   ON time_records(ended_at)",
            "CREATE INDEX IF NOT EXISTS idx_records_item    ON time_records(item_id)",
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_records_uid ON time_records(uid) WHERE uid <> ''",
            "CREATE INDEX IF NOT EXISTS idx_items_name      ON items(name)",
            "CREATE INDEX IF NOT EXISTS idx_todos_done      ON todos(done)",
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_todos_uid  ON todos(uid) WHERE uid <> ''",
        )
    }

    override fun onCreate(db: SQLiteDatabase) {
        listOf(ITEMS, RECORDS, TODOS).forEach(db::execSQL)
        INDEXES.forEach(db::execSQL)
        db.execSQL(
            "INSERT OR IGNORE INTO items (name, is_system, created_at, updated_at) VALUES ('未归类', 1, ?, ?)",
            arrayOf(now(), now()),
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // SQLite 没有 ADD COLUMN IF NOT EXISTS，所以只能靠版本号保证只跑一次。
        // 每加一版补一个 if 分支，不要回头改老分支（与桌面迁移铁律一致）。
        if (oldVersion < 2) migrateToV2(db)
    }

    /**
     * 降级不报错。
     *
     * 默认实现会抛 `SQLiteDowngradeFailedException`，表现就是「装回旧版立刻闪退」——
     * 旧版代码不认识新列不要紧（它只 select 自己认识的列），留着比崩掉好。
     */
    override fun onDowngrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

    /** v1 → v2：给两张业务表补 `uid` / `device_id` / `rev`，再补上依赖它们的唯一索引。 */
    private fun migrateToV2(db: SQLiteDatabase) {
        for (table in listOf("time_records", "todos")) {
            addColumn(db, table, "uid", "TEXT NOT NULL DEFAULT ''")
            addColumn(db, table, "device_id", "TEXT NOT NULL DEFAULT ''")
            addColumn(db, table, "rev", "INTEGER NOT NULL DEFAULT 1")
        }
        // 老库里没有这两个部分唯一索引；补建时 uid 全是空串，被 `WHERE uid <> ''` 排除，不会撞。
        INDEXES.forEach(db::execSQL)
    }

    /** 幂等加列：先查 `PRAGMA table_info`，避免重复 ALTER 抛 duplicate column。 */
    private fun addColumn(db: SQLiteDatabase, table: String, column: String, ddl: String) {
        if (hasColumn(db, table, column)) return
        db.execSQL("ALTER TABLE $table ADD COLUMN $column $ddl")
    }

    private fun hasColumn(db: SQLiteDatabase, table: String, column: String): Boolean =
        db.rawQuery("PRAGMA table_info($table)", null).use { c ->
            while (c.moveToNext()) {
                if (c.getString(1).equals(column, ignoreCase = true)) return true
            }
            false
        }

    override fun onConfigure(db: SQLiteDatabase) {
        db.setForeignKeyConstraintsEnabled(true)
    }

    private fun now() = System.currentTimeMillis()
}
