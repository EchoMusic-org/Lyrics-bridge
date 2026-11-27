import { toMilliseconds } from './utils.js'

// 该行是否带有真实的逐字时间戳。
// 宿主对无逐字数据的行会按行时长均分估算（charactersEstimated=true），
// 或在清洗层补一个 endTime=0 的整行占位字符；两者都不能当逐字数据下发，
// 否则外部软件会做出与演唱无关的假逐字高亮（与宿主 hasWordByWordTiming 同判据）。
function hasRealCharTiming(chars) {
  return Array.isArray(chars) && chars.some(char => Number(char?.endTime) > Number(char?.startTime))
}

function toCharPayload(chars, offsetMs) {
  return chars.map(char => ({
    s: (Number(char.startTime) || 0) + offsetMs,
    e: (Number(char.endTime) || 0) + offsetMs,
    t: String(char.text ?? ''),
  }))
}

// 从 LyricLine 构建逐字数据（可选扩展字段，无真实数据时不发送）
export function buildLineDetail(line, offsetMs = 0) {
  const detail = {}

  // 翻译逐字是宿主按字符比例均分的估算值（源数据无翻译时间戳），不下发，
  // 外部软件按协议回退到整行显示 translated 文本。
  const chars = line?.characters
  if (!line?.charactersEstimated && hasRealCharTiming(chars)) {
    detail.characters = toCharPayload(chars, offsetMs)

    const rChars = line?.romanizedCharacters
    // 音译逐字继承主歌词时间轴，仅在主歌词为真实逐字时有效
    if (Array.isArray(rChars) && rChars.length > 0) {
      detail.romanized_characters = toCharPayload(rChars, offsetMs)
    }
  }

  const translated = String(line?.translated ?? '')
  if (translated) detail.translated = translated

  const romanized = String(line?.romanized ?? '')
  if (romanized) detail.romanized = romanized

  return detail
}

// offsetMs 为宿主歌词偏移（全局 + 单曲微调），行时间是原始值，需在此叠加
export const buildLyrics = (lyricLines, offsetMs = 0) => {
  const safeOffset = Number.isFinite(Number(offsetMs)) ? Math.round(Number(offsetMs)) : 0
  return lyricLines.map(line => ({
    time_ms: toMilliseconds(line?.time) + safeOffset,
    text: String(line?.text ?? ''),
    ...buildLineDetail(line, safeOffset),
  }))
}
