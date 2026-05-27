# 手动检查清单（HTTP + WebSocket）

适用环境：Windows PowerShell

本文档用于手动检查 `backend-js` 的 HTTP 和 WebSocket 接口。

- HTTP 部分使用 `curl.exe`
- WebSocket 部分使用 `wscat`

每个检查项都给出可直接执行的命令，以及对应的预期结果。

## 使用说明

- 在 PowerShell 中请使用 `curl.exe`，不要使用 `curl` 别名。
- 如果需要换行，请使用 PowerShell 的续行符 `` ` ``，不要使用 `cmd` 的 `^`。
- 建议先确认后端服务已经启动，并监听 `http://127.0.0.1:3000`。
- WebSocket 部分的 JSON 是给 `Apifox` 或 `wscat` 直接粘贴发送的原始消息。
- WebSocket 直接可用示例统一使用以下固定值：
  - 文档 ID：`doc_sys_001`
  - 客户端 ID：`manual_ws_user_001`
  - 导入事件 ID：`evt_import_manual_001`
- 这些 WebSocket 示例可以直接复制到 `Apifox`；如果你想测试自己的新文档，再手动改成你创建出来的 `docId` 即可。

## 快速开始（适合 Apifox）

### 第一步：先创建一个真实文档

先执行下面这条 HTTP 请求，拿到真实的 `docId`。

```powershell
curl.exe -i -X POST "http://127.0.0.1:3000/docs" `
  -H "Content-Type: application/json" `
  --data-binary '{"title":"manual-doc","createdBy":"manual_user","eventId":"evt_manual_001"}'
```

预期会返回类似：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "docId": "doc_106",
    "title": "manual-doc",
    "currentSeq": 0,
    "createdBy": "manual_user"
  }
}
```

记下这里返回的真实 `docId`，例如 `doc_106`。

### 第二步：在 Apifox 的 WebSocket 页面连接

- 地址填：`ws://127.0.0.1:3000`
- 连接成功后，把下面的原始 JSON 直接复制进去发送

### 第三步：直接复制下面这个 `join` 作为第一条 WebSocket 消息

```json
{"type":"join","docId":"doc_sys_001","clientId":"manual_ws_user_001","name":"Manual User","color":"#2563eb"}
```

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
- WebSocket 地址：`ws://127.0.0.1:3000`

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

这里直接用固定存在的种子文档 `doc_sys_001`。

### 命令

```powershell
curl.exe -i "http://127.0.0.1:3000/docs/doc_sys_001"
```

### 预期结果

- HTTP 状态码：`200 OK`
- 响应体包含：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "docId": "doc_sys_001",
    "title": "示例表格"
  }
}
```

### 检查点

- `data.docId` 等于请求路径中的 `doc_sys_001`
- `data.title` 等于 `示例表格`

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
  - `data.list` 中能找到刚才创建返回的真实文档 ID
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
- 若刚创建的文档与该用户相关，列表中应能看到刚创建返回的真实文档 ID

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
curl.exe -i "http://127.0.0.1:3000/docs/doc_sys_001"
```

预期：HTTP `200`，`data.docId = "doc_sys_001"`。

### 4) 查询列表

```powershell
curl.exe -i "http://127.0.0.1:3000/docs?userId=manual_user&scope=created&page=1&pageSize=10"
```

预期：HTTP `200`，列表中能看到刚创建的文档。

---

## 15. WebSocket 手动检查说明

`curl.exe` 适合检查 HTTP 接口，不适合检查本项目的 WebSocket 消息交互。

原因如下：

- WebSocket 需要先建立长连接，再持续发送多条 JSON 消息
- `join`、`presence`、`set_cell`、`undo`、`redo`、`import_sheet` 都可能收到多条返回
- `curl.exe` 不适合模拟这种会话式交互

建议使用以下方式检查 WebSocket：

- 自动检查脚本：`npm run check:ws-api`
- 手动交互工具：`npx wscat -c ws://127.0.0.1:3000`

### 使用说明

- 下文统一使用固定存在的种子文档 `doc_sys_001`
- 下文统一使用固定客户端 ID `manual_ws_user_001`
- 下文统一使用固定导入事件 ID `evt_import_manual_001`
- 如果你想测试自己创建出来的文档，再把 JSON 里的 `doc_sys_001` 改成真实 `docId`
- 如果你想观察广播给其他客户端的效果，可以同时打开两个终端，各连一个 `wscat`

### 连接命令

```powershell
npx wscat -c "ws://127.0.0.1:3000"
```

预期结果：

- 终端显示已连接成功
- 后续可以持续输入 JSON 消息

---

## 16. WebSocket - join

### 发送消息

```json
{"type":"join","docId":"doc_sys_001","clientId":"manual_ws_user_001","name":"Manual User","color":"#2563eb"}
```

### 预期结果

- 第一条返回是 `join_ack`
- 第二条返回是 `presence`
- `join_ack.data.docId = doc_sys_001`
- `join_ack.data.clientId = manual_ws_user_001`
- `join_ack.data.snapshot` 为对象
- `join_ack.data.users` 为数组
- `presence.data.docId = doc_sys_001`
- `presence.data.users` 中能找到 `manual_ws_user_001`

### 典型返回

```json
{
  "type": "join_ack",
  "code": 0,
  "message": "ok",
  "data": {
    "docId": "doc_sys_001",
    "clientId": "manual_ws_user_001",
    "currentSeq": 0,
    "snapshot": {},
    "users": []
  }
}
```

```json
{
  "type": "presence",
  "code": 0,
  "message": "ok",
  "data": {
    "docId": "doc_sys_001",
    "users": []
  }
}
```

---

## 17. WebSocket - presence

### 发送消息

```json
{"type":"presence","docId":"doc_sys_001"}
```

### 预期结果

- 当前发送方会收到 2 条 `presence`
- 两条消息的 `data.docId` 都等于 `doc_sys_001`
- `users` 数组中能找到当前 `manual_ws_user_001`

### 典型返回

```json
{
  "type": "presence",
  "code": 0,
  "message": "ok",
  "data": {
    "docId": "doc_sys_001",
    "users": [
      {
        "clientId": "manual_ws_user_001",
        "name": "Manual User",
        "color": "#2563eb",
        "status": "online"
      }
    ]
  }
}
```

---

## 18. WebSocket - set_cell

### 发送消息

```json
{"type":"set_cell","docId":"doc_sys_001","clientId":"manual_ws_user_001","row":1,"col":1,"value":"hello ws","style":null}
```

### 预期结果

- 当前发送方会收到 2 条 `cell_updated`
- `data.docId = doc_sys_001`
- `data.clientId = manual_ws_user_001`
- `data.row = 1`
- `data.col = 1`
- `data.value = "hello ws"`
- `data.seq` 为大于 `0` 的数字
- `data.canUndo = true`
- `data.canRedo = false`

### 典型返回

```json
{
  "type": "cell_updated",
  "code": 0,
  "message": "ok",
  "data": {
    "docId": "doc_sys_001",
    "clientId": "manual_ws_user_001",
    "seq": 1,
    "row": 1,
    "col": 1,
    "value": "hello ws",
    "style": null,
    "canUndo": true,
    "canRedo": false
  }
}
```

---

## 19. WebSocket - undo

### 前置条件

- 先成功执行一次 `set_cell`

### 发送消息

```json
{"type":"undo","docId":"doc_sys_001","clientId":"manual_ws_user_001"}
```

### 预期结果

- 当前发送方会收到 2 条 `undo_applied`
- `data.docId = doc_sys_001`
- `data.clientId = manual_ws_user_001`
- `data.row = 1`
- `data.col = 1`
- `data.value = ""`
- `data.canRedo = true`
- `data.seq` 应大于前一次 `set_cell` 的 `seq`

### 典型返回

```json
{
  "type": "undo_applied",
  "code": 0,
  "message": "ok",
  "data": {
    "docId": "doc_sys_001",
    "clientId": "manual_ws_user_001",
    "seq": 2,
    "row": 1,
    "col": 1,
    "value": "",
    "style": null,
    "canUndo": false,
    "canRedo": true
  }
}
```

---

## 20. WebSocket - redo

### 前置条件

- 先成功执行一次 `undo`

### 发送消息

```json
{"type":"redo","docId":"doc_sys_001","clientId":"manual_ws_user_001"}
```

### 预期结果

- 当前发送方会收到 2 条 `redo_applied`
- `data.docId = doc_sys_001`
- `data.clientId = manual_ws_user_001`
- `data.row = 1`
- `data.col = 1`
- `data.value = "hello ws"`
- `data.canUndo = true`
- `data.seq` 应大于前一次 `undo` 的 `seq`

### 典型返回

```json
{
  "type": "redo_applied",
  "code": 0,
  "message": "ok",
  "data": {
    "docId": "doc_sys_001",
    "clientId": "manual_ws_user_001",
    "seq": 3,
    "row": 1,
    "col": 1,
    "value": "hello ws",
    "style": null,
    "canUndo": true,
    "canRedo": false
  }
}
```

---

## 21. WebSocket - import_sheet

### 发送消息

```json
{"type":"import_sheet","docId":"doc_sys_001","clientId":"manual_ws_user_001","eventId":"evt_import_manual_001","snapshot":{"rowCount":2,"colCount":2,"cells":{"1:1":{"value":"Name","style":null},"1:2":{"value":"Score","style":null},"2:1":{"value":"Alice","style":null},"2:2":{"value":"99","style":null}}}}
```

### 预期结果

- 当前发送方会收到 2 条 `sheet_imported`
- `data.docId = doc_sys_001`
- `data.clientId = manual_ws_user_001`
- `data.seq` 为新的递增值
- `data.canUndo = false`
- `data.canRedo = false`

### 典型返回

```json
{
  "type": "sheet_imported",
  "code": 0,
  "message": "ok",
  "data": {
    "docId": "doc_sys_001",
    "clientId": "manual_ws_user_001",
    "seq": 4,
    "canUndo": false,
    "canRedo": false
  }
}
```

### 补充验证

- 重新开一个新的 `wscat` 连接
- 再发送一次 `join`
- 预期在 `join_ack.data.snapshot` 中看到：
  - `rowCount = 2`
  - `colCount = 2`
  - `cells["1:1"].value = "Name"`
  - `cells["2:2"].value = "99"`

---

## 22. WebSocket - 不支持的消息类型

### 发送消息

```json
{"type":"unknown_type"}
```

### 预期结果

- 返回 1 条 `error`
- `code = 4001`
- `message = "Unsupported message type"`

### 典型返回

```json
{
  "type": "error",
  "code": 4001,
  "message": "Unsupported message type",
  "data": null
}
```

---

## 23. WebSocket - 常见错误场景

### 1) 未 join 直接调用 presence

发送消息：

```json
{"type":"presence","docId":"doc_sys_001"}
```

预期结果：

- 返回 `error`
- `code = 4003`
- `message = "socket has not joined this document"`

### 2) 未 join 直接调用 undo

发送消息：

```json
{"type":"undo","docId":"doc_sys_001","clientId":"manual_ws_user_001"}
```

预期结果：

- 返回 `error`
- `code = 4003`
- `message = "socket has not joined this document as the specified client"`

### 3) 缺少 join 参数

发送消息：

```json
{"type":"join","docId":"doc_sys_001"}
```

预期结果：

- 返回 `error`
- `code = 4000`
- `message = "docId and clientId are required"`

### 4) 文档不存在

发送消息：

```json
{"type":"join","docId":"doc_nonexistent","clientId":"manual_ws_user_001"}
```

预期结果：

- 返回 `error`
- `code = 4004`
- `message` 包含 `document not found: doc_nonexistent`

---

## 24. WebSocket 一次性最小检查清单

如果你只想快速确认主要 WebSocket 接口是否正常，按下面顺序执行即可：

### 1) 建立连接

```powershell
npx wscat -c "ws://127.0.0.1:3000"
```

### 2) join

```json
{"type":"join","docId":"doc_sys_001","clientId":"manual_ws_user_001","name":"Manual User","color":"#2563eb"}
```

预期：先收到 `join_ack`，再收到 `presence`。

### 3) set_cell

```json
{"type":"set_cell","docId":"doc_sys_001","clientId":"manual_ws_user_001","row":1,"col":1,"value":"hello ws","style":null}
```

预期：收到 2 条 `cell_updated`。

### 4) undo

```json
{"type":"undo","docId":"doc_sys_001","clientId":"manual_ws_user_001"}
```

预期：收到 2 条 `undo_applied`。

### 5) redo

```json
{"type":"redo","docId":"doc_sys_001","clientId":"manual_ws_user_001"}
```

预期：收到 2 条 `redo_applied`。

### 6) import_sheet

```json
{"type":"import_sheet","docId":"doc_sys_001","clientId":"manual_ws_user_001","eventId":"evt_import_manual_001","snapshot":{"rowCount":2,"colCount":2,"cells":{"1:1":{"value":"Name","style":null},"1:2":{"value":"Score","style":null},"2:1":{"value":"Alice","style":null},"2:2":{"value":"99","style":null}}}}
```

预期：收到 2 条 `sheet_imported`。
