# Doc / Sheet 改造清单

## 1. 背景

当前后端默认：

- `doc` 就是一张表
- `doc.snapshot_json` 保存的是单个 sheet 的数据
- `set_cell`、`undo`、`redo`、`join_ack` 都直接基于单表快照工作

现在需要升级为：

- `doc` 表示工作区 / workbook
- `sheet` 才表示单张表格
- `doc.snapshot_json` 保存整个 workbook
- `undo/redo` 仍然按 `doc` 级维护，不单独为每个 `sheet` 维护一套栈

本文档用于总结本次后端改造范围、设计结论和实施顺序。

## 2. 设计结论

### 2.1 是否创建 `sheet` 表

本阶段建议：**不创建独立 `sheet` 表**。

原因：

- 当前权威状态已经是 `doc.snapshot_json`
- `join_ack`、`GET /docs/:docId`、缓存、导入、撤销恢复都天然围绕整份文档快照工作
- `undo/redo` 仍是 `doc` 级语义，不是 `sheet` 级语义
- 如果单独拆出 `sheet` 表，会让一次写操作从“更新一条 doc”变成“更新多条 sheet 或 doc + history + user_op_state”，事务复杂度明显上升

当前阶段更合适的方案：

- `doc` 仍保存整个 workbook 快照
- `sheet` 作为 `snapshot_json` 中的子结构存在
- `history` 和 `user_op_state` 增加 `sheetId` 维度

### 2.2 `undo/redo` 语义

保持现有原则不变：

- 仍然按 `docId + clientId` 维护一套 `undoStack` / `redoStack`
- `seq` 仍然是 `doc` 级全局递增
- `undo` / `redo` 仍然视为新的正式操作
- 新的普通编辑仍然清空当前用户的 `redoStack`

需要新增的点：

- 每个可撤销操作 entry 必须带 `sheetId`
- `undo` / `redo` 执行时根据 `sheetId + row + col` 找到目标单元格

### 2.3 Redis / 锁粒度

保持 `doc` 级即可：

- 分布式锁仍然按 `docId` 加锁
- 文档快照缓存仍然按 `docId` 缓存整份 workbook

不建议改成 `sheet` 级锁，因为：

- 当前顺序确认点仍是 `doc`
- `seq` 仍是 `doc` 级
- `undo/redo` 也仍是 `doc` 级

## 3. 目标数据结构

### 3.1 `doc.snapshot_json`

目标结构如下：

```json
{
  "activeSheetId": "sheet_001",
  "sheetOrder": ["sheet_001", "sheet_002"],
  "sheets": {
    "sheet_001": {
      "id": "sheet_001",
      "name": "Sheet1",
      "defaultRowHeight": 25,
      "defaultColWidth": 100,
      "rowCount": 100,
      "colCount": 26,
      "styles": {},
      "cells": {}
    },
    "sheet_002": {
      "id": "sheet_002",
      "name": "汇总",
      "defaultRowHeight": 25,
      "defaultColWidth": 100,
      "rowCount": 50,
      "colCount": 10,
      "styles": {},
      "cells": {}
    }
  }
}
```

### 3.2 `history`

建议保持现有 `doc` 级历史结构，并增加 `sheetId` 维度：

- 保留 `doc_id + seq` 作为全局唯一顺序
- 新增 `target_sheet_id`
- `set_cell` / `undo` / `redo` 要记录：
  - `target_sheet_id`
  - `target_row`
  - `target_col`
- `import_sheet` 继续记录整份 workbook 到 `payload_json`

### 3.3 `user_op_state`

`undoStackJson` / `redoStackJson` 中的 entry 结构升级为：

```json
{
  "sourceSeq": 13,
  "docId": "doc_001",
  "clientId": "user_001",
  "opType": "set_cell",
  "sheetId": "sheet_001",
  "row": 1,
  "col": 1,
  "oldValue": "A",
  "oldStyle": null,
  "newValue": "B",
  "newStyle": null,
  "baseSeq": 12
}
```

## 4. 必改模块清单

### 4.1 文档实体与快照归一化

需要修改：

- `backend-js/domain/entities/doc.js`

改造内容：

- 把当前单 sheet 的 `createEmptyDocSnapshot()` 改成 workbook 结构
- 把 `normalizeDocSnapshot()` 改成：
  - 归一化 `activeSheetId`
  - 归一化 `sheetOrder`
  - 归一化 `sheets`
  - 逐个归一化 sheet 的 `cells` / `styles` / 行列信息
- 推荐补充公共 helper：
  - `normalizeWorkbookSnapshot()`
  - `normalizeSheetSnapshot()`
  - `createEmptyWorkbookSnapshot()`
  - `createEmptySheetSnapshot()`

目标：

- 所有 service / store 都依赖统一 workbook 结构，避免各层各自拼 JSON

### 4.2 文档存储层

需要修改：

- `backend-js/store/memory/docMemoryStore.js`
- `backend-js/store/mysql/docMysqlStore.js`

改造内容：

- `applySetCell()` 改为：
  - 先定位 `snapshot.sheets[sheetId]`
  - 再更新 sheet 下的 `cells` / `styles`
  - 行列扩展只更新目标 sheet 的 `rowCount` / `colCount`
- `applyImportSheet()` 改为接收 workbook 结构
- 后续如果新增 `add_sheet`，由 doc store 负责：
  - 生成新 `sheetId`
  - 追加到 `sheetOrder`
  - 写入 `sheets`

目标：

- 存储层成为 workbook 的唯一落点
- service 层不直接操作 snapshot 内部细节

### 4.3 Docs Service

需要修改：

- `backend-js/service/docsService.js`

改造内容：

- `toDocView()` 输出的 `snapshot` 改为 workbook
- `createDoc()` 默认创建一个包含 `Sheet1` 的 workbook
- `getDocState()` / `getDocStateForWrite()` 返回的 `snapshotJson` 保持 workbook 结构
- `applySetCell()` / `applyImportSheet()` 的参数改为支持 `sheetId` / workbook

目标：

- HTTP 和 WS 上游统一拿到 workbook 结构

### 4.4 `set_cell`

需要修改：

- `backend-js/ws/handlers/setCell.js`
- `backend-js/service/cellService.js`

改造内容：

- 请求参数新增 `sheetId`
- `normalizeSetCellCommand()` 校验：
  - `docId`
  - `clientId`
  - `sheetId`
  - `row`
  - `col`
- service 执行前检查目标 `sheetId` 是否存在
- 历史记录增加 `sheetId`
- `undoStack` 记录增加 `sheetId`
- 响应 `cell_updated` 增加 `sheetId`

规则建议：

- `set_cell` 必须显式传 `sheetId`
- 不要依赖 `activeSheetId` 自动推导目标 sheet

原因：

- `activeSheetId` 可能只是前端当前视图状态
- 多人协作时，不同用户当前正在查看的 sheet 不一定一致

### 4.5 `undo/redo`

需要修改：

- `backend-js/service/undoRedoService.js`
- `backend-js/service/undoRedoOtService.js`
- `backend-js/ws/handlers/undo.js`
- `backend-js/ws/handlers/redo.js`

改造内容：

- 从 `undoStack` / `redoStack` 中读出 `sheetId`
- `getCurrentCellState()` 改为按 `sheetId + row + col` 读取
- “同一个单元格被修改”的判断改为：
  - `sheetId`
  - `row`
  - `col`
- `undo_applied` / `redo_applied` 响应增加 `sheetId`
- `history` 追加记录时增加 `target_sheet_id`

保持不变的点：

- 栈仍然按 `docId + clientId` 维护一套
- 不拆成每个 sheet 一套 `undo/redo`

### 4.6 `import_sheet`

需要修改：

- `backend-js/service/importService.js`
- `backend-js/ws/handlers/importSheet.js`

改造内容：

- 请求和响应中的 `snapshot` 改为 workbook 结构
- 成功后仍然：
  - 更新 `doc.snapshot_json`
  - 追加 `history`
  - 清空当前用户 `undoStack` / `redoStack`

规则建议：

- 当前阶段把 `import_sheet` 继续视为 `doc` 级 barrier
- 即使只导入某一张表，建议仍然走整份 workbook 替换或整份 workbook 提交

### 4.7 `join` 与查询接口

需要修改：

- `backend-js/service/joinService.js`
- `backend-js/routes/docs.js`

改造内容：

- `join_ack.data.snapshot` 改为 workbook
- `GET /docs/:docId` 返回 workbook
- `POST /docs` 返回默认 workbook

目标：

- 前端打开文档时一次拿到整个工作区结构

### 4.8 缓存层

需要修改：

- `backend-js/cache/docSnapshotCache.js`
- `backend-js/cache/docMetaCache.js`
- 相关缓存读写调用方

改造内容：

- `doc snapshot cache` 缓存值改为 workbook 结构
- `doc meta cache` 结构基本不变
- 缓存 key 不需要调整，仍按 `docId`

说明：

- 当前 key 粒度仍然合理
- 只需要更新缓存 value 的结构

### 4.9 数据库结构

需要修改：

- `backend-js/db/mysql/schema.js`

改造内容：

- `doc.snapshot_json` 仍保留，不拆表
- `history` 增加 `target_sheet_id VARCHAR(64) NULL`
- 如果后续新增 `add_sheet` / `rename_sheet` / `delete_sheet`，也可以沿用当前 `history` 表记录不同 `op_type`

建议暂不改动：

- 不新增 `sheet` 表
- 不把 `user_op_state` 拆成 `doc + sheet + client`

### 4.10 种子数据与测试

需要修改：

- `backend-js/db/seed/docSeed.js`
- `backend-js/db/seed/docSeedWriter.js`
- `backend-js/tests/docs.test.js`
- `backend-js/tests/ws.test.js`
- 其他依赖 snapshot 结构的测试

改造内容：

- 种子文档改成 workbook 结构
- `join_ack` 测试断言改成 workbook
- `GET /docs/:docId` 测试断言改成 workbook
- `set_cell` / `undo` / `redo` 测试都要补 `sheetId`

## 5. 建议新增的能力

本次如果同步推进多 sheet 基础能力，建议一起补下面两个操作：

### 5.1 `add_sheet`

建议新增：

- WS 请求：`add_sheet`
- 响应：`sheet_added`

最小行为：

- 生成新 `sheetId`
- 创建空 sheet
- 写入 `sheetOrder`
- 默认可考虑切为 `activeSheetId`
- 追加 `history`

### 5.2 `set_active_sheet`

需要先确认语义：

- 如果表示“文档默认打开哪张表”，可以持久化到 `doc.snapshot_json.activeSheetId`
- 如果表示“当前用户正在看哪张表”，则不应写入文档快照，而应放前端本地态或 presence

当前建议：

- `doc.snapshot_json.activeSheetId` 只表示文档默认激活 sheet
- 用户实时查看中的 tab 不纳入后端权威状态

## 6. 推荐实施顺序

### 第一阶段：先统一数据模型

- 改 `domain/entities/doc.js`
- 统一 workbook / sheet 的归一化方法
- 改种子数据结构

交付标准：

- 后端内部可以稳定读写 workbook

### 第二阶段：打通主链路

- 改 `docMemoryStore` / `docMysqlStore`
- 改 `docsService`
- 改 `join_ack`
- 改 `GET /docs/:docId`

交付标准：

- 打开文档时能拿到 workbook

### 第三阶段：改写操作协议

- 改 `set_cell`
- 改 `cell_updated`
- 历史记录带 `sheetId`
- `undoStack` / `redoStack` 带 `sheetId`

交付标准：

- 指定 sheet 的单元格修改可正常工作

### 第四阶段：改 `undo/redo`

- 改 `undoRedoService`
- 改 `undoRedoOtService`
- 改 `undo_applied` / `redo_applied`

交付标准：

- 跨多 sheet 场景下，撤销恢复仍按 doc 级生效

### 第五阶段：补多 sheet 相关操作

- `add_sheet`
- `sheet_added`
- 后续如有需要再加 `rename_sheet` / `delete_sheet`

交付标准：

- 工作区具备基本多 sheet 生命周期能力

## 7. 风险点

### 7.1 `activeSheetId` 语义混淆

风险：

- 如果把“用户当前正在查看的 sheet”直接写进 `doc.snapshot_json.activeSheetId`
- 多人协作时会互相覆盖

建议：

- 区分“文档默认激活 sheet”和“用户当前本地激活 sheet”

### 7.2 `set_cell` 误用全局激活 sheet

风险：

- 服务端根据 `activeSheetId` 自动推断目标 sheet
- 会导致写错 sheet

建议：

- 请求必须显式携带 `sheetId`

### 7.3 `history` 字段语义继续漂移

当前已有迹象：

- `set_cell` 实际把 `{ value, style }` 放进了 `oldValueJson` / `newValueJson`
- `oldStyleJson` / `newStyleJson` 没有真正独立使用

建议：

- 本次改造顺手统一 `history` 的字段规范
- 避免后续继续堆兼容逻辑

### 7.4 测试坐标体系不一致

风险：

- 现有测试里既有 `0:0` 形式，也有 `row >= 1` 的校验逻辑

建议：

- 本次顺手统一单元格坐标规范
- 明确到底使用 0-based 还是 1-based

## 8. 本次改造的最终建议

建议按以下原则落地：

- `doc` 是 workbook
- `sheet` 是 snapshot 内子资源
- 当前阶段不创建独立 `sheet` 表
- `undo/redo` 继续按 `doc` 级维护
- `set_cell`、`undo`、`redo`、`history`、`user_op_state` 全部补 `sheetId`
- Redis 锁、缓存、seq 继续保持 `doc` 级

这样可以在不打散现有架构的前提下，把单表模型平滑升级为多 sheet workbook 模型。
