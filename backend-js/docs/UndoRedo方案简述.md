# Undo/Redo 方案简述

## 1. 方案目标

本方案用于 `Canvas-Spreadsheet-WeOn` 后端的协同 `undo/redo` 设计，目标如下：

说明：

- 本文档描述的是后续完整方案
- 一期先不实现 `undo/redo` 主流程
- 一期只保留对应数据结构、文件位置和后续接入方案

- 一期内存结构直接对标二期数据库结构
- `undo/redo` 适用于多人协同场景
- `undo/redo` 不通过回退全局指针实现
- 所有实际落地变更都进入全局历史表

本方案采用 **B 方案**：

- 每个用户、每个文档维护自己的 `undoStack` 和 `redoStack`
- 栈中保存可直接执行的操作快照
- `undo/redo` 时不必反查全局历史详情

## 2. 核心原则

- `seq` 是文档级全局递增序号，不是用户自己的序号
- `undo/redo` 都视为新的业务操作，执行后分配新的 `seq`
- 全局历史只追加，不删除、不覆盖
- 当前文档状态按最新操作结果覆盖更新
- 新的普通编辑会清空当前用户自己的 `redoStack`
- `undo` 只撤销当前用户自己的可撤销操作，不影响其他用户的操作

## 3. 数据设计

### 3.1 `doc`

用于保存文档当前状态。

推荐字段：

- `docId`
- `title`
- `snapshot`
- `currentSeq`
- `createdAt`
- `updatedAt`

### 3.2 `history`

用于保存文档全局操作历史，采用 append-only。

推荐字段：

- `docId`
- `seq`
- `clientId`
- `opType`
- `row`
- `col`
- `oldValue`
- `newValue`
- `sourceSeq`
- `createdAt`

字段说明：

- `opType` 可取 `set_cell`、`import_sheet`、`undo`、`redo`
- `sourceSeq` 表示本次 `undo/redo` 对应的原始操作序号
- 普通编辑时，`sourceSeq` 可为空

### 3.3 `user_op_state`

用于保存每个用户在每个文档上的 `undo/redo` 状态，逻辑上等价于用户私有历史栈。

推荐字段：

- `docId`
- `clientId`
- `undoStack`
- `redoStack`
- `updatedAt`

其中栈元素建议直接保存完整操作快照，例如：

```json
{
  "sourceSeq": 12,
  "docId": "doc_001",
  "clientId": "user_001",
  "opType": "set_cell",
  "row": 3,
  "col": 2,
  "oldValue": "100",
  "newValue": "200"
}
```

## 4. 执行流程

### 4.1 `set_cell`

当用户发起一次普通编辑时：

1. 读取当前单元格旧值
2. 分配新的全局 `seq`
3. 写入 `history`
4. 更新 `doc` 当前状态
5. 将该操作压入当前用户 `undoStack`
6. 清空当前用户 `redoStack`

### 4.2 `undo`

当用户点击撤回时：

1. 从当前用户 `undoStack` 弹出栈顶操作
2. 根据该操作生成逆操作
3. 为逆操作分配新的全局 `seq`
4. 写入 `history`
5. 更新 `doc` 当前状态
6. 将刚刚被撤销的原始操作压入 `redoStack`

说明：

- `undo` 产生的是一条新的历史记录
- 不是把文档状态直接回退到旧 `seq`

### 4.3 `redo`

当用户点击重做时：

1. 从当前用户 `redoStack` 弹出栈顶操作
2. 按原业务意图重新执行该操作
3. 为本次重做分配新的全局 `seq`
4. 写入 `history`
5. 更新 `doc` 当前状态
6. 将该原始操作重新压回 `undoStack`

说明：

- `redo` 也会产生一条新的历史记录
- 不是把指针前移到旧 `seq`

## 5. 连续 Undo/Redo 语义

连续 `undo` 的语义是：

- 每次都撤销当前用户最近一条仍可撤销的操作

示例：

- `seq1`: A 修改 `A1`
- `seq2`: B 修改 `B1`
- `seq3`: A 修改 `A1`

此时 A 连续两次 `undo`：

- 第一次撤销 A 的 `seq3`
- 第二次撤销 A 的 `seq1`

不会撤销 B 的 `seq2`。

连续 `redo` 的语义是：

- 每次都重做当前用户最近一条仍可重做的操作

## 6. 前端按钮规则

- `undoStack` 为空时，禁用 `undo`
- `redoStack` 为空时，禁用 `redo`

服务端建议在响应中返回：

```json
{
  "canUndo": true,
  "canRedo": false
}
```

前端据此控制按钮状态，避免只依赖本地推断。

## 7. 一期内存实现要求

一期虽然使用内存存储，但结构上应直接对标后续落库：

- 内存中的 `doc` 对标数据库表 `doc`
- 内存中的 `history` 对标数据库表 `history`
- 内存中的 `user_op_state` 对标数据库表 `user_op_state`

这样二期切换为 MySQL 时，只需要替换 `store` 层存储介质，不需要重新设计业务流程。

## 8. 结论

本方案最终采用：

- 文档级全局 `seq`
- 全局历史 append-only
- 当前状态覆盖更新
- 每用户每文档一套 `undoStack/redoStack`
- 栈内保存可直接执行的操作快照

该方案实现简单、响应速度快、数据库压力较小，并且适合作为一期内存实现到二期持久化实现的统一方案。
