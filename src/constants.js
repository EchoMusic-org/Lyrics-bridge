export const DEFAULT_SERVER_URL = 'ws://127.0.0.1:17195'
export const COVER_SIZE = 400
export const COVER_TIMEOUT_MS = 5000
export const MAX_COVER_BYTES = 4 * 1024 * 1024
// 封面缓存按 base64 字符长度近似计费的总量预算（base64 长度 ≈ 原始字节 × 4/3）
export const MAX_COVER_CACHE_BYTES = 8 * 1024 * 1024
export const MAX_COVER_CACHE_SIZE = 20
export const SEEK_THRESHOLD_MS = 2000
export const MIN_SEEK_SYNC_INTERVAL_MS = 10
export const MAX_SEEK_SYNC_INTERVAL_MS = 1000
export const PING_INTERVAL_MS = 10000
export const TOAST_DURATION_MS = 4000
export const SEEK_MARK_CLEAR_DELAY_MS = 1500
export const RECONNECT_DELAY_MS = 5000
// 上传音频的边界：下载/上传分别限时，整体大小上限（整曲 FLAC 可能到几十 MB）
export const AUDIO_DOWNLOAD_TIMEOUT_MS = 30000
export const UPLOAD_TIMEOUT_MS = 120000
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024
// 启动时等待首次连接结果的最长时间，超时或未连上才拉起辅助进程，避免重复实例
export const HELPER_LAUNCH_WAIT_MS = 3000
