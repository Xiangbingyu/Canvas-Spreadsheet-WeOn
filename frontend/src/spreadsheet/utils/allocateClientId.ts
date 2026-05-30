const CLIENT_ID_STORAGE_KEY = 'canvas_spreadsheet_client_id'

/**
 * 为当前浏览器客户端分配唯一用户 ID（协作场景下多开标签页可复用同一 ID）。
 * 优先读取 localStorage；不存在则生成并持久化。
 */
export function allocateClientId(): string {
  try {
    const existing = localStorage.getItem(CLIENT_ID_STORAGE_KEY)
    if (existing) return existing

    const id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? `user_${crypto.randomUUID()}`
        : `user_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`

    localStorage.setItem(CLIENT_ID_STORAGE_KEY, id)
    return id
  } catch {
    return `user_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
  }
}
