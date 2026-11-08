-- =============================================================================
-- Timing 数据库迁移 0007（V0.11.27）
-- 变更：md_cloud_pending 按通路隔离（块④本地同步 / 块⑤云端同道路各自记账）。
-- 旧行折算规则：全部归 'webdav' 通路。理由（按重要性）：
--   1. pending_since>0 的欠账行只可能来自 WebDAV 轮（folder 轮只 mark_synced，
--      欠账恒 0）——折给 folder 会永久丢补传清单，折给 webdav 零丢失；
--   2. folder 的成功行（etag=NULL, pending_since=0）折给 webdav 的代价：下次
--      webdav 轮对该日按「无 If-Match 覆盖」处理，与「远端没回 ETag」既有语义一致；
--   3. folder 通路从空表起步，首轮写盘后自行重建「今天已上传」；
--   4. 不在 SQL 里 json_extract 读配置（不依赖 JSON1 编译开关，折算规则与配置无关）。
-- =============================================================================

CREATE TABLE md_cloud_pending_v7 (
  date          TEXT NOT NULL,                 -- yyyy-MM-dd（本地时区）
  channel       TEXT NOT NULL,                 -- 'folder' | 'webdav'（与 purge 水位键、备份 target 同源）
  etag          TEXT,
  last_hash     TEXT,
  pending_since INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, channel)
);

INSERT INTO md_cloud_pending_v7 (date, channel, etag, last_hash, pending_since)
  SELECT date, 'webdav', etag, last_hash, pending_since FROM md_cloud_pending;

DROP TABLE md_cloud_pending;
ALTER TABLE md_cloud_pending_v7 RENAME TO md_cloud_pending;

UPDATE settings SET value = '7', updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE key = 'schema.version';
