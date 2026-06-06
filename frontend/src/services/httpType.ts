/**
 * HTTP 接口 DTO（与 docs/接口文档.md 对齐）
 *
 * 后端统一响应外壳：`{ code: number; message: string; data: T | null }`
 * - 下列「响应」类型均为 `data` 字段；由 httpAPI.ts 解包后返回。
 * - WebSocket 消息类型见 spreadsheet/model/collabProtocol.ts
 *
 * | # | 方法 | 路径              | 请求                         | 响应 data        |
 * |---|------|-------------------|------------------------------|------------------|
 * | 1 | GET  | /                 | —                            | ServiceRootData  |
 * | 2 | GET  | /health           | —                            | HealthData       |
 * | 3 | POST | /docs             | CreateDocParams              | DocDetail        |
 * | 4 | GET  | /docs             | ListDocsParams（Query）      | ListDocsData     |
 * | 5 | GET  | /docs/:docId      | 路径参数 docId: string       | DocDetail        |
 */

import type { WorkbookData } from '@/spreadsheet/model/types'

// ---------------------------------------------------------------------------
// 接口 1：GET / — 服务根路由
// @see docs/接口文档.md § GET / — 服务根路由
// ---------------------------------------------------------------------------

/** 响应 data */
export interface ServiceRootData {
  service: string
}

// ---------------------------------------------------------------------------
// 接口 2：GET /health — 健康检查
// @see docs/接口文档.md § GET /health — 健康检查
// ---------------------------------------------------------------------------

/** 响应 data */
export interface HealthData {
  status: string
}

// ---------------------------------------------------------------------------
// 接口 3：POST /docs — 创建文档
// @see docs/接口文档.md § POST /docs — 创建文档
// ---------------------------------------------------------------------------

/** 请求体（JSON） */
export interface CreateDocParams {
  title?: string
  createdBy?: string | null
  eventId?: string | null
  /** 可选 workbook 快照；传入则基于该快照创建文档 */
  snapshot?: WorkbookData
}

/** 响应 data（接口 5 复用） */
export interface DocDetail {
  docId: string
  title: string
  currentSeq: number
  createdBy: string | null
  createdAt: string
  updatedAt: string
  snapshot: WorkbookData
}

// ---------------------------------------------------------------------------
// 接口 4：GET /docs — 查询文档列表
// @see docs/接口文档.md § GET /docs — 查询文档列表
// ---------------------------------------------------------------------------

/** Query：scope 取值 */
export type DocListScope = 'created' | 'participated' | 'all'

/** Query：list[].relation 取值 */
export type DocRelation = 'created' | 'participated'

/** 请求 Query 参数 */
export interface ListDocsParams {
  userId: string
  scope: DocListScope
  page: number
  pageSize: number
}

/** 响应 data.list 单项 */
export interface DocListItem {
  docId: string
  title: string
  createdBy: string | null
  createdAt: string
  updatedAt: string
  currentSeq: number
  relation: DocRelation
}

/** 响应 data */
export interface ListDocsData {
  list: DocListItem[]
  page: number
  pageSize: number
  total: number
  hasMore: boolean
}

// ---------------------------------------------------------------------------
// 接口 5：GET /docs/:docId — 查询单个文档
// @see docs/接口文档.md § GET /docs/:docId — 查询单个文档
// ---------------------------------------------------------------------------

/** 请求：路径参数 docId（string），无 Query / Body */
/** 响应 data：DocDetail（见接口 3） */
