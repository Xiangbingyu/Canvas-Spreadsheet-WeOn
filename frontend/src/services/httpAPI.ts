/**
 * HTTP API 封装（axios）
 *
 * 后端统一响应：{ code: 0, message: "ok", data: T }
 * - code !== 0 时抛出 ApiError
 * - 开发环境 VITE_API_BASE_URL 留空，请求走 Vite proxy → localhost:3000
 */

import axios, { isAxiosError } from 'axios'

import type {
  CreateDocParams,
  DocDetail,
  HealthData,
  ListDocsData,
  ListDocsParams,
  ServiceRootData,
} from './httpType'

/** 后端原始响应结构 */
interface ApiResponse<T = unknown> {
  code: number
  message: string
  data: T
}

/** 业务错误，可通过 e.code 区分错误类型（如 4004 文档不存在） */
export class ApiError extends Error {
  code: number
  data: unknown

  constructor(code: number, message: string, data: unknown = null) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.data = data
  }
}

/** 把 axios / 网络错误转成 ApiError */
function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error

  if (isAxiosError(error)) {
    const body = error.response?.data as ApiResponse | undefined
    if (body && typeof body.code === 'number') {
      return new ApiError(body.code, body.message, body.data ?? null)
    }
    return new ApiError(5000, error.message || '网络错误')
  }

  if (error instanceof Error) return new ApiError(5000, error.message)
  return new ApiError(5000, '未知错误')
}

//创建axios实例
const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '',
  headers: { 'Content-Type': 'application/json' },
  timeout: 30_000,
})

// 成功：检查 code，把 response.data 替换为内层 data
// 失败：统一转为 ApiError
http.interceptors.response.use(
  (response) => {
    const body = response.data as ApiResponse
    if (body.code !== 0) {
      return Promise.reject(new ApiError(body.code, body.message, body.data))
    }
    response.data = body.data
    return response
  },
  (error) => Promise.reject(toApiError(error))
)

/** GET / — 确认服务身份 */
async function getServiceRoot() {
  const res = await http.get<ServiceRootData>('/')
  return res.data
}

/** GET /health — 健康检查 */
async function getHealth() {
  const res = await http.get<HealthData>('/health')
  return res.data
}

/** POST /docs — 创建文档 */
async function createDoc(params: CreateDocParams = {}) {
  const res = await http.post<DocDetail>('/docs', params)
  return res.data
}

/** GET /docs — 查询文档列表 */
async function listDocs(params: ListDocsParams) {
  const res = await http.get<ListDocsData>('/docs', { params })
  return res.data
}

/** GET /docs/:docId — 查询单个文档 */
async function getDoc(docId: string) {
  const res = await http.get<DocDetail>(`/docs/${encodeURIComponent(docId)}`)
  return res.data
}

export const API = {
  getServiceRoot,
  getHealth,
  createDoc,
  listDocs,
  getDoc,
}

export default API
