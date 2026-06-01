# 行列插删 WS 改造方案

## 1. 背景

当前前端的插入/删除行列操作只更新本地 Redux，没有同步到后端。

结果是：

- 刷新页面后，行列结构变更会丢失
- 同房间其他客户端无法实时收到这类结构性变更
- 后端持久化快照与前端当前表格状态不一致

本方案用于补齐后端 WebSocket 接口与持久化逻辑，使插入/删除行列操作具备：

- 后端持久化
- 房间内广播同步
- 刷新可恢复
- 与现有 `set_cell` / `add_sheet` / `import_sheet` 一致的协同行为

## 2. 方案结论

本次新增 4 个 WebSocket 请求消息：

- `insert_row`
- `delete_row`
- `insert_col`
- `delete_col`

采用以下约定：

- 请求显式携带 `docId`、`clientId`、`sheetId`、`row/col`
- 成功广播使用独立的 updated 类型，而不是复用请求类型
- 行列下标使用 `1-based`
- 插入行/列表示插入空白行/列，原有单元格坐标整体平移
- 删除行/列表示删除目标行/列，剩余单元格坐标整体平移
- 结构变更执行成功后，清空该文档下所有用户的后端 `undo/redo` 栈

## 3. 协议设计

### 3.1 请求消息

#### `insert_row`

```json
{
  "type": "insert_row",
  "docId": "doc_sys_001",
  "clientId": "user_001",
  "sheetId": "sheet_20260527_001",
  "row": 3
}
```

语义：

- 在第 `3` 行之前插入一行空白行
- 原有 `row >= 3` 的单元格整体下移一行

#### `delete_row`

```json
{
  "type": "delete_row",
  "docId": "doc_sys_001",
  "clientId": "user_001",
  "sheetId": "sheet_20260527_001",
  "row": 3
}
```

语义：

- 删除第 `3` 行
- 原有位于第 `3` 行的单元格被删除
- 原有 `row > 3` 的单元格整体上移一行

#### `insert_col`

```json
{
  "type": "insert_col",
  "docId": "doc_sys_001",
  "clientId": "user_001",
  "sheetId": "sheet_20260527_001",
  "col": 2
}
```

语义：

- 在第 `2` 列之前插入一列空白列
- 原有 `col >= 2` 的单元格整体右移一列

#### `delete_col`

```json
{
  "type": "delete_col",
  "docId": "doc_sys_001",
  "clientId": "user_001",
  "sheetId": "sheet_20260527_001",
  "col": 2
}
```

语义：

- 删除第 `2` 列
- 原有位于第 `2` 列的单元格被删除
- 原有 `col > 2` 的单元格整体左移一列

### 3.2 成功广播消息

请求成功后，服务端先回复发送者，再广播给房间内所有客户端。

广播类型采用独立消息：

- `row_inserted`
- `row_deleted`
- `col_inserted`
- `col_deleted`

#### `row_inserted`

```json
{
  "type": "row_inserted",
  "code": 0,
  "message": "ok",
  "data": {
    "docId": "doc_sys_001",
    "clientId": "user_001",
    "sheetId": "sheet_20260527_001",
    "seq": 12,
    "row": 3,
    "canUndo": false,
    "canRedo": false
  }
}
```

其余 3 类成功消息结构保持一致，仅替换为对应的 `row/col` 字段与消息类型。

### 3.3 下标规则

行列下标采用 `1-based`，与前端当前 `workSheetStore` 中的 `insertRow/deleteRow/insertCol/deleteCol` 行为一致。

校验规则：

- 插入行：`1 <= row <= rowCount + 1`
- 删除行：`1 <= row <= rowCount`
- 插入列：`1 <= col <= colCount + 1`
- 删除列：`1 <= col <= colCount`

本次不支持 `0` 行、`0` 列的插删。

## 4. 数据变更规则

### 4.1 插入行

- 目标 sheet 中所有 `cell.row >= row` 的单元格，行号加 `1`
- `rowCount += 1`
- 插入位置本身不主动创建单元格，表示插入空白行

### 4.2 删除行

- 删除所有 `cell.row === row` 的单元格
- 所有 `cell.row > row` 的单元格，行号减 `1`
- `rowCount -= 1`

### 4.3 插入列

- 目标 sheet 中所有 `cell.col >= col` 的单元格，列号加 `1`
- `colCount += 1`
- 插入位置本身不主动创建单元格，表示插入空白列

### 4.4 删除列

- 删除所有 `cell.col === col` 的单元格
- 所有 `cell.col > col` 的单元格，列号减 `1`
- `colCount -= 1`

## 5. 后端改造范围

### 5.1 协议层

修改文件：

- `backend-js/protocol/messageTypes.js`

新增请求类型：

- `INSERT_ROW`
- `DELETE_ROW`
- `INSERT_COL`
- `DELETE_COL`

新增成功消息类型：

- `ROW_INSERTED`
- `ROW_DELETED`
- `COL_INSERTED`
- `COL_DELETED`

### 5.2 WS Dispatcher

修改文件：

- `backend-js/ws/dispatcher.js`

新增 4 个 handler 注册：

- `insertRow`
- `deleteRow`
- `insertCol`
- `deleteCol`

### 5.3 WS Handler

新增文件：

- `backend-js/ws/handlers/insertRow.js`
- `backend-js/ws/handlers/deleteRow.js`
- `backend-js/ws/handlers/insertCol.js`
- `backend-js/ws/handlers/deleteCol.js`

职责与现有 `set_cell` 保持一致：

- 校验 `docId/clientId/sheetId`
- 校验 `row/col` 为正整数
- 校验当前 socket 已加入目标文档且 `clientId` 匹配
- 调用 service
- `reply(payload)`
- `broadcastToRoom(docId, payload)`
- 错误时返回标准 `error`

### 5.4 Service 层

建议新增统一 service：

- `backend-js/service/sheetStructureService.js`

建议统一实现 4 个入口：

- `applyInsertRow`
- `applyDeleteRow`
- `applyInsertCol`
- `applyDeleteCol`

内部共享逻辑建议抽成：

- 参数规范化
- 目标 sheet 校验
- 文档加锁
- 快照坐标重排
- history 记录
- user op state 清空
- 缓存失效
- audit 记录

### 5.5 Docs Service 与 Store

需要打通以下层级：

- `backend-js/service/docsService.js`
- `backend-js/store/docStore.js`
- `backend-js/store/memory/docMemoryStore.js`
- `backend-js/store/mysql/docMysqlStore.js`

建议新增统一方法：

- `applySheetStructureChange(command, options)`

由 store 层负责真正修改 `snapshotJson` 中目标 sheet 的：

- `cells`
- `rowCount`
- `colCount`

## 6. Undo/Redo 策略

### 6.1 本次最终决定

任意一次插入/删除行列成功后，清空该文档下所有用户的后端 `undo/redo` 栈。

原因：

- 当前后端 `undo/redo` 栈以绝对坐标保存操作
- 行列结构变更会导致旧坐标整体失真
- 不仅当前操作者的历史会受影响，其他在线用户的历史也会受影响
- 如果尝试对所有历史栈做坐标迁移，复杂度和错误风险都过高

因此第一版采用更稳妥的策略：

- 结构变更成功
- 当前文档全部用户的 `undoStackJson`、`redoStackJson` 清空
- 返回 `canUndo=false`、`canRedo=false`

### 6.2 需要改动的 user op state

涉及文件：

- `backend-js/store/userOpStateStore.js`
- `backend-js/store/memory/userOpStateMemoryStore.js`
- `backend-js/store/mysql/userOpStateMysqlStore.js`

建议新增统一方法：

- `clearByDocId(docId, options)`

语义：

- 将该 `docId` 下所有用户的 `undoStackJson` 与 `redoStackJson` 清空
- 推荐保留记录本身，只清空栈内容

## 7. History 与 Audit

### 7.1 History

现有 `history` 表结构可以复用，无需新增表字段。

建议新增 `opType`：

- `insert_row`
- `delete_row`
- `insert_col`
- `delete_col`

建议记录：

- `docId`
- `clientId`
- `seq`
- `targetSheetId`
- `targetRow` 或 `targetCol`
- `payloadJson`

`payloadJson` 建议包含：

```json
{
  "type": "insert_row",
  "sheetId": "sheet_20260527_001",
  "row": 3,
  "clearUndoRedo": true
}
```

### 7.2 Audit

修改文件：

- `backend-js/audit/auditEventTypes.js`

新增审计事件：

- `insert_row`
- `delete_row`
- `insert_col`
- `delete_col`

审计 payload 建议包含：

- `sheetId`
- `row` 或 `col`
- `clearedUndoRedo: true`

## 8. 缓存层是否需要修改

结论：

- **缓存层代码本身不需要新增结构或改 key 设计**
- **新结构变更 service 必须沿用现有写后缓存失效流程**
- **缓存测试需要补充行列插删场景**

### 8.1 为什么缓存层代码通常不用改

当前缓存层缓存的是：

- `doc snapshot`
- `doc meta`
- `user docs list`

这几个缓存都是文档级或列表级缓存，不是按某个单元格、某一行、某一列做细粒度缓存。

现有写操作在成功后都会调用：

- `docsService.invalidateDocCaches(docId)`

这会失效：

- 文档快照缓存
- 文档元信息缓存
- 相关用户的文档列表缓存

因此新增行列插删时，只要新的结构变更 service 在写成功后继续调用同一个失效入口，缓存就能正确回源到最新快照，不需要额外修改缓存模块本身。

### 8.2 缓存层需要关注的点

虽然缓存代码通常不用改，但以下内容需要同步补齐：

- 在新的结构变更 service 中调用 `docsService.invalidateDocCaches(docId)`
- 缓存专项测试中增加行列插删后的回源与读新值验证

### 8.3 什么时候才需要改缓存层

只有当后续引入以下能力时，才需要考虑单独改缓存设计：

- 单 sheet 独立缓存
- 行列级局部缓存
- 结构变更后的细粒度局部失效

本次方案不涉及这些内容。

## 9. 测试清单

### 9.1 WebSocket 主链路

修改文件：

- `backend-js/tests/ws.test.js`

建议新增测试：

- `insert_row` 基本成功
- `delete_row` 基本成功
- `insert_col` 基本成功
- `delete_col` 基本成功
- 参数校验失败
- 未 join 时返回 `4003`
- `sheetId` 不存在时报错
- 同房间其他客户端收到广播
- 重新 join 后快照仍保留变更
- 执行后 `userOpState` 被清空

### 9.2 多实例广播

修改文件：

- `backend-js/tests/multiInstanceBroadcast.test.js`

建议新增测试：

- 一实例发起 `insert_row`，另一实例客户端收到 `row_inserted`
- 一实例发起 `delete_col`，另一实例客户端收到 `col_deleted`

### 9.3 缓存专项验证

修改文件：

- `backend-js/tests/cacheRedis.test.js`
- `backend-js/docs/缓存层测试清单.md`

建议新增验证：

- 行列插删后旧的 `doc snapshot` 缓存不会残留
- 行列插删后跨实例读取能拿到最新 `snapshot`
- 行列插删后相关 `user docs list` 缓存失效行为与 `set_title/import_sheet` 一致

## 10. 实施顺序

推荐顺序：

1. 补 `messageTypes`
2. 补 `dispatcher` 与 4 个 handler
3. 新增 `sheetStructureService`
4. 打通 `docsService -> docStore -> memory/mysql store`
5. 新增 `userOpStateStore.clearByDocId`
6. 补 `history` 与 `audit`
7. 补 `ws`、`multiInstance`、`cache` 三类测试
8. 前端接入发送与接收逻辑

## 11. 前端联动要求

后端方案落地后，前端需要同步做两件事：

- 本地插删行列时发送新的 WS 请求
- 收到 `row_inserted/row_deleted/col_inserted/col_deleted` 后更新 Redux

同时，前端本地历史栈也需要在任意结构变更广播后清空，保持与后端策略一致。

## 12. 正式接口文档更新策略

本文件是实现前的改造方案文档。

在接口实际完成后，应再同步更新正式接口文档：

- `docs/接口文档.md`

更新内容包括：

- 新增 4 个 WS 请求消息章节
- 新增 4 个成功广播消息示例
- 补充结构变更后的 `undo/redo` 清空约定
- 补充缓存与刷新后的持久化行为说明
