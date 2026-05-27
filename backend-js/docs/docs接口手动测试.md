# docs 接口手动测试

本文档用于手动验证后端 `docs` 相关 HTTP 接口当前实现效果，示例以 `curl` 为主。

补充说明：

- HTTP 状态码是标准 HTTP 风格，例如 `200`、`201`、`400`、`404`
- 响应体里的 `code` 是业务码，例如成功时为 `0`，文档不存在时为 `4004`
- 如果想同时看到 HTTP 状态码和响应头，可以在命令里加 `-i`

## 启动服务

默认端口为 `3000`，先在 `backend-js` 目录启动服务：

```bash
npm start
```

以下示例默认后端地址为：

```bash
http://127.0.0.1:3000
```

## 1. 创建文档

接口：

```http
POST /docs
Content-Type: application/json
```

### 1.1 正常创建

```bash
curl -X POST "http://127.0.0.1:3000/docs" ^
  -H "Content-Type: application/json" ^
  -d "{\"title\":\"test-sheet\",\"createdBy\":\"user_001\",\"eventId\":\"evt_create_doc_001\"}"
```

响应示例：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "docId": "doc_001",
    "title": "test-sheet",
    "currentSeq": 0,
    "createdBy": "user_001",
    "createdAt": "2026-05-26T10:00:00.000Z",
    "updatedAt": "2026-05-26T10:00:00.000Z",
    "snapshot": {
      "cells": {},
      "styles": {},
      "rowCount": 0,
      "colCount": 0
    }
  }
}
```

说明：

- `eventId` 用于幂等控制。
- `title` 不传时默认会使用 `Untitled`。
- `createdBy` 可以不传，此时返回值中通常为 `null`。

### 1.2 重复 eventId 幂等验证

第一次请求：

```bash
curl -X POST "http://127.0.0.1:3000/docs" ^
  -H "Content-Type: application/json" ^
  -d "{\"title\":\"first-title\",\"createdBy\":\"user_001\",\"eventId\":\"evt_create_doc_002\"}"
```

第二次请求，故意改标题和创建人，但 `eventId` 保持一致：

```bash
curl -X POST "http://127.0.0.1:3000/docs" ^
  -H "Content-Type: application/json" ^
  -d "{\"title\":\"second-title\",\"createdBy\":\"user_999\",\"eventId\":\"evt_create_doc_002\"}"
```

预期现象：

- 第二次仍返回 `201`
- 第二次响应内容应与第一次完全一致

### 1.3 参数错误示例

空白 `title`：

```bash
curl -X POST "http://127.0.0.1:3000/docs" ^
  -H "Content-Type: application/json" ^
  -d "{\"title\":\"   \"}"
```

响应示例：

```json
{
  "code": 4000,
  "message": "title must be a non-empty string",
  "data": null
}
```

对应 HTTP 状态码：`400`

空白 `eventId`：

```bash
curl -X POST "http://127.0.0.1:3000/docs" ^
  -H "Content-Type: application/json" ^
  -d "{\"title\":\"invalid-event-id-doc\",\"eventId\":\"   \"}"
```

响应示例：

```json
{
  "code": 4000,
  "message": "eventId must be a non-empty string",
  "data": null
}
```

对应 HTTP 状态码：`400`

## 2. 查询文档列表

接口：

```http
GET /docs?userId=xxx&scope=created|participated|all&page=1&pageSize=10
```

说明：

- `userId` 必填
- `scope` 必填，可选值：`created`、`participated`、`all`
- `page` 必填，正整数
- `pageSize` 必填，正整数，且不能大于 `100`
- `pageSize` 也兼容写成 `pagesize`

### 2.1 查询我创建的文档

```bash
curl "http://127.0.0.1:3000/docs?userId=user_docs_created&scope=created&page=1&pageSize=10"
```

响应示例：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "list": [
      {
        "docId": "doc_002",
        "title": "created-doc-2",
        "createdBy": "user_docs_created",
        "createdAt": "2026-05-26T10:01:00.000Z",
        "updatedAt": "2026-05-26T10:01:00.000Z",
        "currentSeq": 0,
        "relation": "created"
      },
      {
        "docId": "doc_001",
        "title": "created-doc-1",
        "createdBy": "user_docs_created",
        "createdAt": "2026-05-26T10:00:00.000Z",
        "updatedAt": "2026-05-26T10:00:00.000Z",
        "currentSeq": 0,
        "relation": "created"
      }
    ],
    "page": 1,
    "pageSize": 10,
    "total": 2,
    "hasMore": false
  }
}
```

### 2.2 查询我参与的文档

```bash
curl "http://127.0.0.1:3000/docs?userId=user_docs_participated&scope=participated&page=1&pageSize=10"
```

响应示例：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "list": [
      {
        "docId": "doc_003",
        "title": "participated-doc",
        "createdBy": "owner_user_001",
        "createdAt": "2026-05-26T10:02:00.000Z",
        "updatedAt": "2026-05-26T10:02:00.000Z",
        "currentSeq": 0,
        "relation": "participated"
      }
    ],
    "page": 1,
    "pageSize": 10,
    "total": 1,
    "hasMore": false
  }
}
```

### 2.3 查询创建和参与的合集

```bash
curl "http://127.0.0.1:3000/docs?userId=user_docs_all&scope=all&page=1&pageSize=10"
```

响应示例：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "list": [
      {
        "docId": "doc_005",
        "title": "all-participated-doc",
        "createdBy": "owner_user_003",
        "createdAt": "2026-05-26T10:03:00.000Z",
        "updatedAt": "2026-05-26T10:03:00.000Z",
        "currentSeq": 0,
        "relation": "participated"
      },
      {
        "docId": "doc_004",
        "title": "all-created-doc",
        "createdBy": "user_docs_all",
        "createdAt": "2026-05-26T10:02:30.000Z",
        "updatedAt": "2026-05-26T10:02:30.000Z",
        "currentSeq": 0,
        "relation": "created"
      }
    ],
    "page": 1,
    "pageSize": 10,
    "total": 2,
    "hasMore": false
  }
}
```

### 2.4 列表参数错误示例

```bash
curl "http://127.0.0.1:3000/docs?userId=&scope=unknown&page=0&pageSize=200"
```

响应示例：

```json
{
  "code": 4000,
  "message": "userId must be a non-empty string",
  "data": null
}
```

对应 HTTP 状态码：`400`

提示：

- 当前实现会优先校验 `userId`
- 如果想继续测试其他错误提示，可以把 `userId` 改为合法值后，再分别验证 `scope`、`page`、`pageSize`

## 3. 查询单个文档状态

接口：

```http
GET /docs/:docId
```

### 3.1 查询已存在文档

先创建一个文档，记下返回的 `docId`，再查询：

```bash
curl "http://127.0.0.1:3000/docs/doc_001"
```

响应示例：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "docId": "doc_001",
    "title": "test-sheet",
    "currentSeq": 0,
    "createdBy": "user_001",
    "createdAt": "2026-05-26T10:00:00.000Z",
    "updatedAt": "2026-05-26T10:00:00.000Z",
    "snapshot": {
      "cells": {},
      "styles": {},
      "rowCount": 0,
      "colCount": 0
    }
  }
}
```

### 3.2 查询不存在的文档

```bash
curl "http://127.0.0.1:3000/docs/doc_999"
```

响应示例：

```json
{
  "code": 4004,
  "message": "document not found: doc_999",
  "data": null
}
```

对应 HTTP 状态码：`404`

## 4. 自动化检测脚本

已新增脚本：

`scripts/check-docs-api.ps1`

用途：

- 用 `curl.exe` 自动检测 `POST /docs`
- 检测 `GET /docs/:docId`
- 检测 `GET /docs` 创建列表
- 检测重复 `eventId` 的幂等行为
- 检测 `404` 和 `400` 错误场景

执行方式：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\check-docs-api.ps1
```

指定地址执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\check-docs-api.ps1 -BaseUrl "http://127.0.0.1:3000"
```

注意：

- 执行前请先启动后端服务
- 脚本会同时校验 HTTP 状态码和响应 JSON 中的业务码

## 5. 一组最小测试流程

如果只想快速手动验证实现效果，可以按下面顺序执行：

1. 先调一次 `POST /docs` 创建文档
2. 记录返回的 `docId`
3. 调 `GET /docs/:docId` 查看单文档状态
4. 调 `GET /docs?userId=xxx&scope=created&page=1&pageSize=10` 查看列表
5. 再用相同 `eventId` 调一次 `POST /docs` 验证幂等
6. 最后调一次错误参数示例，确认异常响应格式
