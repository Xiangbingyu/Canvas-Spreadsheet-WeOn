# curl 手动检查清单

适用环境：Windows PowerShell

本文档用于手动检查 `backend-js` 的 HTTP 接口。每个检查项都给出一条可直接执行的 `curl.exe` 命令，以及对应的预期结果。

## 使用说明

- 在 PowerShell 中请使用 `curl.exe`，不要使用 `curl` 别名。
- 如果需要换行，请使用 PowerShell 的续行符 `` ` ``，不要使用 `cmd` 的 `^`。
- 建议先确认后端服务已经启动，并监听 `http://127.0.0.1:3000`。
- 下文中的 `DOC_ID` 请替换成你实际创建出来的文档 ID，例如 `doc_106`。

### 推荐写法

单行写法：

```powershell
curl.exe -i -X POST "http://127.0.0.1:3000/docs" -H "Content-Type: application/json" --data-binary '{"title":"manual-doc","createdBy":"manual_user","eventId":"evt_manual_001"}'
```

多行写法：

```powershell
curl.exe -i -X POST "http://127.0.0.1:3000/docs" `
  -H "Content-Type: application/json" `
  --data-binary '{"title":"manual-doc","createdBy":"manual_user","eventId":"evt_manual_001"}'
```

## 基础地址

- 服务地址：`http://127.0.0.1:3000`

---

## 1. GET / - 服务根路由

### 命令

```powershell
curl.exe -i "http://127.0.0.1:3000/"
```

### 预期结果

- HTTP 状态码：`200 OK`
- 响应体包含：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "service": "backend-js"
  }
}
```

---

## 2. GET /health - 健康检查

### 命令

```powershell
curl.exe -i "http://127.0.0.1:3000/health"
```

### 预期结果

- HTTP 状态码：`200 OK`
- 响应体包含：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "status": "ok"
  }
}
```

---

## 3. POST /docs - 创建文档

### 命令

```powershell
curl.exe -i -X POST "http://127.0.0.1:3000/docs" `
  -H "Content-Type: application/json" `
  --data-binary '{"title":"manual-doc","createdBy":"manual_user","eventId":"evt_manual_001"}'
```

### 预期结果

- HTTP 状态码：`201 Created`
- 响应体包含：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "docId": "doc_xxx",
    "title": "manual-doc",
    "currentSeq": 0,
    "createdBy": "manual_user",
    "snapshot": {
      "cells": {},
      "styles": {},
      "rowCount": 0,
      "colCount": 0
    }
  }
}
```

### 检查点

- `data.docId` 非空
- `data.title` 等于 `manual-doc`
- `data.createdBy` 等于 `manual_user`
- `data.currentSeq` 等于 `0`

---

## 4. POST /docs - 幂等重试

使用和上一步相同的 `eventId` 再发一次请求。

### 命令

```powershell
curl.exe -i -X POST "http://127.0.0.1:3000/docs" `
  -H "Content-Type: application/json" `
  --data-binary '{"title":"should-be-ignored","createdBy":"other_user","eventId":"evt_manual_001"}'
```

### 预期结果

- HTTP 状态码：`201 Created`
- 响应体中的 `data.docId` 与上一步相同
- 响应体中的 `data.title` 仍然是第一次创建的 `manual-doc`
- 响应体中的 `data.createdBy` 仍然是第一次创建的 `manual_user`

---

## 5. GET /docs/:docId - 查询单个文档

先把 `DOC_ID` 替换成你在第 3 步创建出来的文档 ID。

### 命令

```powershell
curl.exe -i "http://127.0.0.1:3000/docs/DOC_ID"
```

### 预期结果

- HTTP 状态码：`200 OK`
- 响应体包含：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "docId": "DOC_ID",
    "title": "manual-doc"
  }
}
```

### 检查点

- `data.docId` 等于请求路径中的 `DOC_ID`
- `data.title` 等于 `manual-doc`

---

## 6. GET /docs - 查询创建列表

### 命令

```powershell
curl.exe -i "http://127.0.0.1:3000/docs?userId=manual_user&scope=created&page=1&pageSize=10"
```

### 预期结果

- HTTP 状态码：`200 OK`
- 响应体中：
  - `code` 等于 `0`
  - `data.total` 大于等于 `1`
  - `data.list` 中能找到刚才创建的 `DOC_ID`
  - 对应记录的 `relation` 等于 `created`

---

## 7. GET /docs - 查询全部相关列表

### 命令

```powershell
curl.exe -i "http://127.0.0.1:3000/docs?userId=manual_user&scope=all&page=1&pageSize=10"
```

### 预期结果

- HTTP 状态码：`200 OK`
- 响应体中的 `code` 等于 `0`
- `data.list` 返回数组
- 若刚创建的文档与该用户相关，列表中应能看到对应 `DOC_ID`

---

## 8. GET /docs - 查询参与列表

该接口主要依赖用户通过 WebSocket join 参与过文档。若你尚未做过 WebSocket join，这里可能返回空列表。

### 命令

```powershell
curl.exe -i "http://127.0.0.1:3000/docs?userId=manual_user&scope=participated&page=1&pageSize=10"
```

### 预期结果

- HTTP 状态码：`200 OK`
- 响应体中的 `code` 等于 `0`
- `data.list` 返回数组
- 如果用户还没有通过 WebSocket join 参与过任何文档，返回空数组是正常的

---

## 9. GET /docs/:docId - 查询不存在的文档

### 命令

```powershell
curl.exe -i "http://127.0.0.1:3000/docs/doc_999999"
```

### 预期结果

- HTTP 状态码：`404 Not Found`
- 响应体包含：

```json
{
  "code": 4004,
  "message": "document not found: doc_999999",
  "data": null
}
```

---

## 10. POST /docs - title 为空白字符串

### 命令

```powershell
curl.exe -i -X POST "http://127.0.0.1:3000/docs" `
  -H "Content-Type: application/json" `
  --data-binary '{"title":"   "}'
```

### 预期结果

- HTTP 状态码：`400 Bad Request`
- 响应体包含：

```json
{
  "code": 4000,
  "message": "title must be a non-empty string",
  "data": null
}
```

---

## 11. POST /docs - createdBy 为空白字符串

### 命令

```powershell
curl.exe -i -X POST "http://127.0.0.1:3000/docs" `
  -H "Content-Type: application/json" `
  --data-binary '{"title":"manual-doc","createdBy":"   "}'
```

### 预期结果

- HTTP 状态码：`400 Bad Request`
- 响应体包含：

```json
{
  "code": 4000,
  "message": "createdBy must be a non-empty string",
  "data": null
}
```

---

## 12. POST /docs - eventId 为空白字符串

### 命令

```powershell
curl.exe -i -X POST "http://127.0.0.1:3000/docs" `
  -H "Content-Type: application/json" `
  --data-binary '{"title":"manual-doc","eventId":"   "}'
```

### 预期结果

- HTTP 状态码：`400 Bad Request`
- 响应体包含：

```json
{
  "code": 4000,
  "message": "eventId must be a non-empty string",
  "data": null
}
```

---

## 13. POST /docs - 请求体不是对象

### 命令

```powershell
curl.exe -i -X POST "http://127.0.0.1:3000/docs" `
  -H "Content-Type: application/json" `
  --data-binary '[1,2,3]'
```

### 预期结果

- HTTP 状态码：`400 Bad Request`
- 响应体包含：

```json
{
  "code": 4000,
  "message": "request body must be an object",
  "data": null
}
```

---

## 14. 一次性最小检查清单

如果你只想快速确认主要 HTTP 接口是否正常，按下面顺序执行即可：

### 1) 服务存活

```powershell
curl.exe -i "http://127.0.0.1:3000/health"
```

预期：HTTP `200`，`data.status = "ok"`。

### 2) 创建文档

```powershell
curl.exe -i -X POST "http://127.0.0.1:3000/docs" `
  -H "Content-Type: application/json" `
  --data-binary '{"title":"manual-doc","createdBy":"manual_user","eventId":"evt_manual_quick_001"}'
```

预期：HTTP `201`，返回新的 `docId`。

### 3) 查询单文档

```powershell
curl.exe -i "http://127.0.0.1:3000/docs/DOC_ID"
```

预期：HTTP `200`，`data.docId = DOC_ID`。

### 4) 查询列表

```powershell
curl.exe -i "http://127.0.0.1:3000/docs?userId=manual_user&scope=created&page=1&pageSize=10"
```

预期：HTTP `200`，列表中能看到刚创建的文档。

---

## 15. 关于 WebSocket 接口

`curl.exe` 适合检查 HTTP 接口，不适合检查本项目的 WebSocket 消息交互。

原因如下：

- WebSocket 需要先建立长连接，再持续发送多条 JSON 消息
- `join`、`presence`、`set_cell`、`undo`、`redo`、`import_sheet` 都可能收到多条返回
- `curl.exe` 不适合模拟这种会话式交互

如果你要手动检查 WebSocket，建议使用以下方式：

- 自动检查脚本：`npm run check:ws-api`
- 手动交互工具：`npx wscat -c ws://127.0.0.1:3000`

