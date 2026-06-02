# SetRangeValues 协议提案 —— 逐格不同的原子批量写入

> 卢晓玲（编辑交互） | 2026-06-02
> 对齐对象：后端、协同层
> 关联：`接口文档2.md` 的 `batch_set_cell`、`SetRangeValues_批量写入设计_lxl.md`（前端侧设计）

---

## 1. 为什么需要这个接口

### 1.1 现有 `batch_set_cell` 的局限

`batch_set_cell` 是「一批坐标 + **一个统一 patch**」模型：`updates` 只给坐标，
`value` / `style` 整批共享一份。它能高效表达「整片选区刷成同一样式 / 同一值」，
但**表达不了「N 个格子各自不同的 value/style」**。

### 1.2 由此引发的问题

两个高频场景天生就是「逐格不同」：

1. **复制粘贴**：粘进来的每个格子内容、样式都不一样
2. **批量撤回**：把 N 个格子各自还原成不同的历史快照

前端目前只能把它们**拆成多条消息**发送：

- 粘贴：逐格 `set_cell`，N 格 = N 条
- 撤回：按「目标快照」分组，每组一条 `batch_set_cell`，混排时退化成多条

而后端每条写消息都要抢同一把文档锁（`withDocLock`，等待超时 3s）。
多条并发抢锁 → 部分超时报 `5000 failed to acquire doc lock`，对应格子写入/还原失败。
（前端已用「分组 + 串行间隔发送」缓解，但治标不治本：消息条数仍随数据规模增长。）

### 1.3 目标

新增 `set_range_values`：

**一条消息携带逐格不同的 value/style，后端一次拿锁、原子应用整批、发一个 seq。**

无论多少格、内容是否相同，永远一条消息、一次锁。

---

## 2. 与现有接口的关系

| 接口 | 模型 | 适用 | 是否保留 |
|---|---|---|---|
| `set_cell` | 单格 value + style | 单格编辑 | 保留 |
| `batch_set_cell` | 一批坐标 + **统一** patch | 整片刷同一值/样式 | 保留 |
| **`set_range_values`（新增）** | 一批坐标 + **逐格不同** value/style | 粘贴、混排撤回、超大数据写入 | 新增 |

`set_range_values` 是「逐格写入」的原子化，定位与 `batch_set_cell` **互补**，不替代。
后续若要收敛，可让它成为三者超集，但本提案只新增、不动现有两个接口。

---

## 3. 请求消息：`set_range_values`

### 3.1 设计要点：样式池化（重要）

为承载**超大数据写入**（粘贴上万格），样式不内联到每个格子，
而是**池化**：相同样式只存一份，格子用 `styleId` 引用。
`styleId` 沿用前端 `generateStyleId` 的内容 hash 规则。

> 不池化的话，一万个同样式的格子要重复一万份完整 style 对象，消息体积爆炸。

### 3.2 消息结构

```JSON
{
  "type": "set_range_values",
  "docId": "doc_sys_001",
  "clientId": "user_001",
  "sheetId": "sheet_20260527_001",
  "baseSeq": 12,
  "styles": {
    "s_abc": { "bold": true, "bgColor": "#2563eb", "color": "#ffffff" },
    "s_def": { "italic": true }
  },
  "cells": [
    { "row": 2, "col": 2, "value": "姓名", "styleId": "s_abc" },
    { "row": 2, "col": 3, "value": "年龄", "styleId": "s_abc" },
    { "row": 3, "col": 2, "value": "张三" },
    { "row": 3, "col": 3, "value": "28", "styleId": "s_def" }
  ]
}
```

### 3.3 字段说明

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `type` | string | 是 | 固定值 `set_range_values` |
| `docId` | string | 是 | 文档 ID |
| `clientId` | string | 是 | 必须与当前 socket 绑定的 clientId 一致，否则 `4003` |
| `sheetId` | string | 是 | 目标工作表 |
| `baseSeq` | number | 是 | 语义同 `batch_set_cell`，见 §5 |
| `styles` | object | 否 | 样式池：`styleId → Style`。`cells` 里被引用的 styleId 必须在此出现 |
| `cells` | array | 是 | 逐格数据，非空。每项见下 |

**`cells[]` 每项**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `row` | number | 是 | 1-based 行号 |
| `col` | number | 是 | 1-based 列号 |
| `value` | string | 否 | 缺省表示「不改该格的值，保留原值」 |
| `styleId` | string | 否 | 引用 `styles` 池中的样式；缺省表示「不改该格样式，保留原样式」；显式传 `null` 表示「清空该格样式」 |

> **value/style 可选语义**（与 `batch_set_cell` 一致地保留「不传即不改」）：
> - 只填 `value`：纯内容写入（粘贴 TSV、改值）
> - 只填 `styleId`：纯样式写入（批量改样式、纯样式撤回）
> - 都填：完整覆盖（带格式粘贴）
> - 都不填：仅占位（一般不出现）

### 3.4 关于「矩形模式」的可选优化（二期再议）

粘贴通常是**密集矩形区**。若 `cells` 显式列举坐标仍嫌大，可加一个可选的
矩形编码（`anchor + 二维数组`，坐标按下标推算省掉 row/col）。
**本提案先只定稀疏 `cells` 形态**，矩形模式作为后续优化项，不阻塞一期。

---

## 4. 成功广播：`range_values_updated`

后端应用成功后，向房间内所有人广播。为保证体积可控，
广播**同样采用样式池化**，结构与请求对称：

```JSON
{
  "type": "range_values_updated",
  "docId": "doc_sys_001",
  "clientId": "user_001",
  "sheetId": "sheet_20260527_001",
  "seq": 17,
  "styles": {
    "s_abc": { "bold": true, "bgColor": "#2563eb", "color": "#ffffff" },
    "s_def": { "italic": true }
  },
  "cells": [
    { "row": 2, "col": 2, "value": "姓名", "styleId": "s_abc" },
    { "row": 2, "col": 3, "value": "年龄", "styleId": "s_abc" },
    { "row": 3, "col": 2, "value": "张三" },
    { "row": 3, "col": 3, "value": "28", "styleId": "s_def" }
  ],
  "canUndo": true,
  "canRedo": false
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `seq` | number | 本次操作分配的序列号（**整批一个 seq**） |
| `styles` | object | 样式池（同请求） |
| `cells` | array | 应用后的逐格最终值（含被保留的原 value/style，方便前端直接落库） |
| `canUndo`/`canRedo` | boolean | 操作者的撤销/重做可用状态 |

> 前端发送方会收到 reply + broadcast 两条同 seq 消息，靠 `seenSeqs` 去重
> （与现有机制一致）。

---

## 5. baseSeq 与并发语义

与 `batch_set_cell` 保持一致：

- `baseSeq > currentSeq`：返回 `4090`
- `baseSeq < currentSeq`：后端对每个目标坐标单独执行结构 transform（行列插删的 rebase）；
  若中间出现 `import_sheet`，返回 `4090`
- 整批在**一次** `withDocLock` 内原子完成，分配**一个** seq

**关键诉求（针对当前痛点）**：一次 `set_range_values` 只抢一次锁、跑一次事务。
这是本接口相对「前端拆多条」的核心收益，请后端务必保证整批在单次锁内完成。

---

## 6. 错误码（复用现有）

| 码 | 场景 |
|---|---|
| `4000` | 消息格式非法（缺字段、`cells` 为空、引用了 `styles` 里不存在的 styleId 等） |
| `4003` | clientId 与 socket 绑定不一致 |
| `4090` | baseSeq 冲突 / 中途 import_sheet |
| `5000` | 服务端内部错误 |

---

## 7. 前端落地计划（对齐后）

协议确定后，前端侧改动（归属编辑交互/store，不碰协同协议实现）：

1. `CollabClient` 增加 `setRangeValues(...)` 发送方法 + `range_values_updated` 收消息分发
   （**此项属协同模块，需易晶莹实现/评审，对应 AGENTS C2 红线**）
2. `workSheetStore` 增加对应 reducer（应用逐格不同的 value/style）
3. 粘贴（`useSpreadsheetInteraction`）改为收集整片 → 一条 `set_range_values`
4. 批量撤回（`useUnifiedHistory`）改为一条 `set_range_values` 还原，
   删除现有「按快照分组 + 串行间隔发送」的兜底逻辑

---

## 8. 待确认问题（请后端 / 协同同学补充意见）

1. **样式池化是否可接受**：后端落库时是否方便处理 `styleId` 引用？还是更希望前端内联 style？
2. **`styleId` 生成规则**：用前端 `generateStyleId` 的 hash，还是后端统一分配？跨端一致性如何保证？
3. **单条消息体量上限**：粘贴上万格时，一条消息可能很大，是否需要约定**分片**阈值（如超过 N 格拆多条 `set_range_values`，每条仍各自原子）？
4. **`value` 省略 vs 空串**：省略 `value`=「保留原值」，传 `""`=「清空为空」，这个区分后端能否支持？
5. **撤销栈**：整批 `set_range_values` 在后端撤销栈里记为**一个**可撤销单元吗（前端期望是）？
6. **广播是否回传完整 cells**：§4 让广播带「应用后最终值」，体量大时是否改为只回 seq + 让各端用请求数据自行应用？

---

> 备注：本文档仅为协议对齐提案，前端不私自实现 WS 结构（遵守 AGENTS C2）。
> 待后端 + 协同确认字段后，更新进 `接口文档2.md`，再分模块实现。
