import type { Cell, Style } from '@/spreadsheet/model/types'
/** GET / — 服务根路由 */
export interface ServiceRootData {
  service: string
}
// {
//     "code": 0,
//     "message": "ok",
//     "data": {
//       "service": "backend-js"
//     }
//   }

/** GET /health — 健康检查 */
export interface HealthData {
  status: string
}
// {
//     "code": 0,
//     "message": "ok",
//     "data": {
//       "status": "ok"
//     }
//   }

/** POST /docs — 创建文档 */
export interface CreateDocParams {
  title?: string
  createdBy?: string | null
  eventId?: string | null
  /** 可选 workbook 快照；传入则基于该快照创建文档 */
  snapshot?: WorkbookSnapshot
}
// {
//     "title": "季度报表",
//     "createdBy": "user_001",
//     "eventId": "evt_create_doc_001"
//   }
/** GET /docs/:docId、POST /docs 响应中的单个 sheet */
export interface ServerSheetSnapshot {
  id: string
  name: string
  defaultRowHeight?: number
  defaultColWidth?: number
  rowCount?: number
  colCount?: number
  styles?: Record<string, Style>
  cells?: Record<string, Cell>
}

/** GET /docs/:docId 响应中的 workbook 快照 */
export interface WorkbookSnapshot {
  activeSheetId: string
  sheetOrder: string[]
  sheets: Record<string, ServerSheetSnapshot>
}

export interface DocDetail {
  docId: string
  title: string
  currentSeq: number
  createdBy: string | null
  createdAt: string
  updatedAt: string
  snapshot: WorkbookSnapshot
}

/** GET /docs — 查询文档列表 */
export type DocListScope = 'created' | 'participated' | 'all'
export type DocRelation = 'created' | 'participated'

export interface ListDocsParams {
  userId: string
  scope: DocListScope
  page: number
  pageSize: number
}

export interface DocListItem {
  docId: string
  title: string
  createdBy: string | null
  createdAt: string
  updatedAt: string
  currentSeq: number
  relation: DocRelation
}

export interface ListDocsData {
  list: DocListItem[]
  page: number
  pageSize: number
  total: number
  hasMore: boolean
}
