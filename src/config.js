import { DEFAULT_SERVER_URL } from './constants.js'
import { normalizeServerUrl } from './utils.js'

export async function getConfig(ctx) {
  const storedServerUrl = await ctx.storage.get('serverUrl')
  // 兼容历史存储的非法值：规范化失败时回退默认地址
  const serverUrl = normalizeServerUrl(storedServerUrl) || DEFAULT_SERVER_URL
  const autoReconnect = await ctx.storage.get('autoReconnect')
  return { serverUrl, autoReconnect: autoReconnect !== false }
}
