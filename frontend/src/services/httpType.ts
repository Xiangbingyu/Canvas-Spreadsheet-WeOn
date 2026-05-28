import type { WorksheetData } from '@/spreadsheet/model/types'
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
//请求体
export interface CreateDocParams {
  title?: string
  createdBy?: string | null
  eventId?: string | null
}
// {
//     "title": "季度报表",
//     "createdBy": "user_001",
//     "eventId": "evt_create_doc_001"
//   }
//响应体
export interface DocDetail {
  docId: string
  title: string
  currentSeq: number
  createdBy: string | null
  createdAt: string
  updatedAt: string
  snapshot: WorksheetData
}
// {
//     "code": 0,
//     "message": "ok",
//     "data": {
//       "docId": "doc_001",
//       "title": "季度报表",
//       "currentSeq": 0,
//       "createdBy": "user_001",
//       "createdAt": "2026-05-27T10:00:00.000Z",
//       "updatedAt": "2026-05-27T10:00:00.000Z",
//       "snapshot": {
//         "id": "sheet_doc_001_001",
//         "name": "Sheet1",
//         "defaultRowHeight": 25,
//         "defaultColWidth": 100,
//         "rowCount": 0,
//         "colCount": 0,
//         "styles": {},
//         "cells": {}
//       }
//     }
//   }

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
