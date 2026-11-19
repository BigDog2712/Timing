-- 媒体播放时间线：系统媒体会话（SMTC）报告「正在播放什么」。
--
-- 与 sessions 不同：媒体可以跨多个前台会话连续播放，所以这张表刻意不挂 session_id，
-- 只按自己的时间区间记录，读取时按时间重叠与会话关联。
--
-- 隐私边界：只存系统媒体会话主动公开的标题/作者，不读网页正文、不读地址栏。
CREATE TABLE IF NOT EXISTS media_playback_samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_app_id TEXT NOT NULL,
    title TEXT NOT NULL,
    artist TEXT,
    playback_type TEXT,
    start_time INTEGER NOT NULL,
    end_time INTEGER
);

CREATE INDEX IF NOT EXISTS idx_media_playback_samples_time
ON media_playback_samples(start_time, end_time);

-- 同一时刻只可能有一个「正在播放」，用它同时约束写入与兜底修复。
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_playback_samples_single_active
ON media_playback_samples((1))
WHERE end_time IS NULL;

-- 按应用清理时要能命中：屏蔽某个应用后它的媒体记录也必须一起消失。
CREATE INDEX IF NOT EXISTS idx_media_playback_samples_app_time
ON media_playback_samples(source_app_id, start_time);
