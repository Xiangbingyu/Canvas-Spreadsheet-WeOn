# Gate 实时态落地实施方案

## 1. 文档目标

本文档用于确认本轮后端性能优化的最终落地方案，目标是把以下思路收敛为一套可实施、可分阶段推进、可回归验证的工程方案：

- 写请求先进入 `Gate`
- `Gate` 负责校验、冲突处理、版本分配与在线确认
- 在线确认结果先写入 `Redis`
- 已确认操作通过消息流异步交给 `Apply&Store`
- `Apply&Store` 使用 `MySQL` 做长期落盘与恢复

本文档不再停留在方向讨论，而是明确：

- 技术选型
- 职责边界
- 数据模型
- 失败处理
- 分阶段改造顺序
- 文件级实现清单
- 测试与验收标准

## 2. 拍板结论

本轮方案拍板如下：

- **Gate**：继续放在当前 `backend-js` 写请求入口内实现，不先拆独立仓库
- **实时态存储**：使用 `Redis`
- **消息流**：首版使用 `Redis Stream`
- **异步持久化**：新增 `Apply&Store Worker`
- **长期存储**：继续使用 `MySQL`
- **锁模型**：继续保留当前文档级 `Redis` 锁，但锁仅保护 `Redis` 实时确认区
- **协同语义**：继续保留当前 `seq + baseSeq/sourceSeq + rebase + barrier`
- **迁移顺序**：先迁 `set_cell`，再迁 `set_title`，再迁 `undo/redo`，最后迁 `import_sheet`

简化总结如下：

- 同步确认操作
- 异步落盘状态
- 保留现有协同语义
- 先逻辑拆分，后物理拆分

## 3. 为什么当前可以直接落地

当前仓库已经具备实现该方案的关键基础设施：

- 已接入 `Redis` 客户端与锁能力
- 已接入 `MySQL`
- 已有 `history`、`user_op_state`、`doc` 等基础表
- 已有文档级顺序确认点
- 已实现 `baseSeq`、最小 `rebase`、`undo/redo sourceSeq`、`import_sheet barrier`

因此，这次优化的重点不是重做协同算法，而是把：

- 在线确认
- 最终持久化

从当前同一条同步主链路中拆开。

也就是说，本轮不是重新发明一套协同协议，而是在现有代码和语义基础上做链路重构。

## 4. 本轮范围

本轮纳入范围：

- `set_cell`
- `set_title`
- `undo`
- `redo`
- `import_sheet`
- 对应 `history`、`user_op_state`、snapshot 落盘链路
- 对应缓存失效、广播与恢复逻辑

本轮不纳入范围：

- 新增 `CRDT`
- 引入完整富文本级 `OT`
- 新增第三方 MQ，如 `Kafka`、`RabbitMQ`
- 一开始就拆成两个独立仓库
- 前端交互模型重构

## 5. 技术选型

### 5.1 Gate

首版 `Gate` 不单独部署，先作为当前 `backend-js` 内的业务层模块落地。

原因：

- 当前代码的写请求入口已经集中在 `service/*` 与 `ws/handlers/*`
- 当前协同语义主要沉淀在 service 层，直接抽到 `Gate` 成本最低
- 可以先把职责拆开，再决定是否拆进程或拆服务

结论：

- **首版采用逻辑 Gate，不先做物理独立服务**

### 5.2 Redis

`Redis` 作为实时真相层，承接：

- 当前文档在线状态
- 当前文档最新 `seq`
- 当前文档短期操作流
- 用户 `undo/redo` 栈
- `import_sheet` barrier
- checkpoint 与 worker 消费位点

结论：

- **Redis 不再只是缓存，而是在线协同真相层的一部分**

### 5.3 MQ

首版消息流选型为 `Redis Stream`。

原因：

- 当前项目已经依赖 `redis`
- `Redis Stream` 自带顺序追加、消费组、确认、重试能力
- 接入复杂度低，最适合当前阶段
- 本轮目标是解耦确认与落盘，不是先解决超大规模流处理问题

结论：

- **首版 MQ 采用 Redis Stream**

### 5.4 Apply&Store

`Apply&Store` 首版实现为后台 worker 进程，职责是：

- 消费已确认操作
- 幂等写入 `MySQL`
- 物化 checkpoint / snapshot
- 推进持久化位点

结论：

- **先做 worker，不先做独立微服务**

### 5.5 MySQL

`MySQL` 的角色从“在线确认真相层”调整为“长期恢复与归档真相层”。

主要职责：

- 持久 `history/op_log`
- 持久 snapshot/checkpoint
- 审计归档
- 故障恢复

## 6. 目标架构

### 6.1 逻辑分层

改造后的核心结构如下：

1. 客户端发送写请求
2. `Gate` 进入文档顺序确认点
3. `Gate` 读取 `Redis` 当前实时态
4. `Gate` 做参数校验、版本校验、冲突处理和 `rebase`
5. `Gate` 分配新的全局 `seq`
6. `Gate` 原子写入 `Redis state + seq + user-op-state + stream`
7. `Gate` 立即 ack 并广播已确认操作
8. `Apply&Store Worker` 异步消费 `Redis Stream`
9. Worker 幂等写入 `MySQL history/op_log`
10. Worker 按策略生成 checkpoint / snapshot

### 6.2 真相分层

- **在线真相层**：`Redis`
- **长期真相层**：`MySQL`

在线成功的定义：

- `Redis` 原子写成功

不是：

- `MySQL` 同步写成功

## 7. 职责边界

### 7.1 Gate 职责

`Gate` 只负责在线确认相关能力：

- 参数校验
- 文档锁
- 读取实时态
- `baseSeq/sourceSeq` 校验
- 最小 `rebase`
- 冲突返回
- 分配新 `seq`
- 原子更新 `Redis`
- 回复客户端
- 广播房间

`Gate` 不负责：

- 同步写 `MySQL`
- 同步写审计
- 同步更新最终 checkpoint
- 同步生成稳定 snapshot

### 7.2 Apply&Store 职责

Worker 负责：

- 从 `Redis Stream` 顺序读取已确认操作
- 幂等写入 `MySQL history`
- 按策略更新 `doc` 表中的稳定 snapshot
- 推进 checkpoint
- 重试失败操作
- 需要时异步补写审计

### 7.3 WS Handler 职责

`ws/handlers/*` 只保留：

- 消息入参读取
- 调用 `Gate`
- 回复与广播封装

不再保留：

- 直接控制同步 SQL 主事务

## 8. 数据模型

### 8.1 Redis Key 设计

建议统一使用如下前缀：

- `collab:rt:doc:{docId}:seq`
- `collab:rt:doc:{docId}:state`
- `collab:rt:doc:{docId}:stream`
- `collab:rt:doc:{docId}:barrier`
- `collab:rt:doc:{docId}:checkpoint`
- `collab:rt:doc:{docId}:user-op:{clientId}`

字段说明：

- `seq`：当前文档最新全局版本
- `state`：当前在线 snapshot
- `stream`：已确认操作流，使用 `Redis Stream`
- `barrier`：最近一次 `import_sheet` 的关键版本信息
- `checkpoint`：最近已物化到 `MySQL` 的稳定版本
- `user-op`：用户级 `undo/redo` 状态

### 8.2 Redis Stream 事件模型

建议统一一条操作事件结构：

```json
{
  "docId": "doc_001",
  "seq": 13,
  "type": "set_cell",
  "clientId": "user_001",
  "baseSeq": 12,
  "sourceSeq": null,
  "barrierSeq": null,
  "payload": {
    "sheetId": "sheet_001",
    "row": 1,
    "col": 1,
    "value": "hello",
    "style": null
  },
  "meta": {
    "eventId": null,
    "confirmedAt": "2026-06-01T00:00:00.000Z"
  }
}
```

要求：

- 每条消息必须带 `docId + seq`
- 由 `docId + seq` 作为 MySQL 落盘幂等兜底
- `payload` 只放业务载荷
- `meta` 放附加信息

### 8.3 MySQL 数据模型

本轮优先复用现有表，不强制一次改新表名：

- `doc`
- `history`
- `user_op_state`
- `audit_log`

角色调整如下：

- `history`：正式 `op_log`
- `doc`：稳定 snapshot 与当前 checkpoint 信息
- `user_op_state`：过渡期保留，可作为恢复副本
- `audit_log`：异步归档

如后续需要更清晰分层，可再新增：

- `snapshot_checkpoint`
- `op_flush_progress`

但首版不要求先做大规模 DDL 改造。

## 9. 关键一致性设计

### 9.1 文档锁

继续使用当前文档级锁，但缩小锁范围。

锁内只保留：

- 读取 `Redis` 当前实时态
- 做冲突检查与 `rebase`
- 分配新 `seq`
- 原子提交 `Redis`

锁外执行：

- 广播
- 审计
- `MySQL` 异步落盘
- checkpoint 物化

### 9.2 Redis 原子提交

`Gate` 的核心提交不能拆成多条松散命令，至少需要原子完成：

- 校验当前基础版本
- 写入新 `seq`
- 写入新 `state`
- 写入 `user-op-state`
- 追加 `stream`
- 推进 `barrier` 或 checkpoint 相关元数据

首版建议使用：

- **Redis Lua 脚本**

不建议首版仅依赖普通多次命令拼接，否则容易出现：

- `seq` 已推进，但 `state` 未更新
- `state` 已更新，但 `stream` 未追加
- `user-op-state` 与文档状态脱节

### 9.3 MySQL 幂等

Worker 落盘时必须保证幂等。

首版策略：

- 以 `history` 表的 `(doc_id, seq)` 唯一约束做兜底
- 若重复消费，同一 `docId + seq` 不重复写入
- `event_id` 保留给适用业务场景做附加幂等控制

## 10. 各操作的目标流程

### 10.1 set_cell

目标流程：

1. `ws/handlers/setCell.js` 接收入参
2. 调用 `Gate`
3. `Gate` 读取 `Redis state + seq`
4. 做 `baseSeq` 校验与最小 `rebase`
5. 冲突则直接返回 `4090`
6. 分配新的 `seq`
7. 原子更新 `Redis state`
8. 追加 `Redis Stream`
9. 更新 `Redis user-op-state`
10. 立即回复 `cell_updated`
11. 立即广播该操作
12. Worker 异步写入 `MySQL history`
13. Worker 按策略推进 snapshot/checkpoint

### 10.2 set_title

流程与 `set_cell` 对称：

- 保留 `baseSeq`
- 主确认点在 `Redis`
- `MySQL` 异步沉淀

### 10.3 undo / redo

流程继续保留当前语义：

- 仍依赖 `sourceSeq`
- 仍依赖用户私有栈
- 仍要检查 barrier

变化点：

- 用户 `undo/redo` 栈主更新改为 `Redis`
- `MySQL user_op_state` 作为过渡性恢复副本

### 10.4 import_sheet

`import_sheet` 作为特殊操作处理：

- 整体替换 `state`
- 推进 barrier
- 清空当前用户 `undo/redo`
- 写入 stream
- 立即广播整份已确认导入结果

## 11. 失败处理与恢复

### 11.1 在线写失败

- `Redis` 原子提交失败：本次请求失败，不广播
- 锁获取失败：本次请求失败，按当前错误体系返回
- 参数错误或冲突：按当前错误码返回

### 11.2 异步落盘失败

- `Redis` 已成功，`MySQL` 落盘失败：本次操作仍视为在线成功
- Worker 需要自动重试
- 重复消费通过 `(doc_id, seq)` 幂等兜底

### 11.3 Redis 故障恢复

恢复路径如下：

1. 从 `MySQL` 读取最近稳定 snapshot/checkpoint
2. 回放 checkpoint 之后的正式 `history/op_log`
3. 重建 `Redis state + seq + barrier`
4. 必要时清理不可信的旧实时态

### 11.4 新实例启动恢复

新实例不依赖本地内存真相。

新实例需要能够：

- 从 `MySQL` 恢复稳定态
- 读取 `Redis` 当前在线态
- 在必要时补齐 Redis 实时态

## 12. 分阶段改造顺序

### 12.1 Phase 1：基础设施落地

目标：

- 新增 Redis 实时态抽象
- 新增 Redis Stream 抽象
- 新增 Gate 基础框架
- 新增 Worker 基础框架

此阶段不要求一次切换所有写链路。

### 12.2 Phase 2：先迁 set_cell

原因：

- `set_cell` 是最核心、最高频、最适合做样板链路的写操作
- 风险可控
- 一旦跑通，其他操作可复用大量模式

目标：

- `set_cell` 主链路不再同步写 `MySQL`
- Redis 实时确认打通
- Worker 异步刷入 `history`

### 12.3 Phase 3：迁 set_title

目标：

- 标题修改走与 `set_cell` 对称的新链路

### 12.4 Phase 4：迁 undo / redo

目标：

- 用户私有栈迁入 Redis 实时态
- 保持 `sourceSeq` 语义不变

### 12.5 Phase 5：迁 import_sheet

原因：

- `import_sheet` 涉及 barrier、整表替换、栈清空，风险最高

目标：

- barrier 语义保持不变
- 以 Redis 为确认点

### 12.6 Phase 6：恢复与治理

目标：

- 补恢复逻辑
- 补观测
- 补重试与死信治理
- 评估是否拆进程

## 13. 文件级实现清单

### 13.1 新增配置

建议新增：

- `config/realtimeConfig.js`
- `config/streamConfig.js`
- `config/workerConfig.js`

建议新增环境变量：

- `REALTIME_STATE_DRIVER`
- `OP_STREAM_DRIVER`
- `PERSIST_WORKER_ENABLED`
- `REALTIME_KEY_PREFIX`
- `REALTIME_STATE_TTL_MS`
- `STREAM_CONSUMER_GROUP`
- `STREAM_BATCH_SIZE`
- `SNAPSHOT_CHECKPOINT_OP_INTERVAL`
- `SNAPSHOT_CHECKPOINT_TIME_WINDOW_MS`

### 13.2 新增 Redis 实时态基础设施

建议新增：

- `infra/redis/realtimeClient.js`
- `infra/redis/realtimeKeys.js`
- `infra/redis/realtimeLua.js`
- `infra/redis/stream.js`

### 13.3 新增实时态 Store

建议新增：

- `store/redis/docRealtimeStore.js`
- `store/redis/userOpRealtimeStore.js`
- `store/redis/docOpStreamStore.js`

### 13.4 新增 Gate 层

建议新增：

- `service/gate/gateService.js`
- `service/gate/gateSetCellService.js`
- `service/gate/gateSetTitleService.js`
- `service/gate/gateUndoRedoService.js`
- `service/gate/gateImportSheetService.js`

### 13.5 新增 Worker

建议新增：

- `worker/opLogFlushWorker.js`
- `worker/snapshotMaterializeWorker.js`
- `worker/index.js`

### 13.6 新增恢复服务

建议新增：

- `service/recovery/docRecoveryService.js`

### 13.7 调整现有模块

需要重点调整：

- `ws/handlers/setCell.js`
- `ws/handlers/setTitle.js`
- `ws/handlers/undo.js`
- `ws/handlers/redo.js`
- `ws/handlers/importSheet.js`
- `service/cellService.js`
- `service/titleService.js`
- `service/undoRedoService.js`
- `service/importService.js`
- `service/docsService.js`

### 13.8 后续可选调整

如首版稳定后可再考虑：

- `backend-js/server.js` 增加 worker 启动入口
- 单独 `server-gate.js`
- 单独 `server-worker.js`

## 14. 测试清单

### 14.1 单操作回归

至少补以下用例：

- `set_cell` 正常确认
- `set_cell baseSeq` stale
- `set_cell baseSeq` future
- `set_title` 正常确认
- `undo/redo sourceSeq` 正常回放
- `import_sheet barrier` 正常生效

### 14.2 Redis 原子性测试

至少验证：

- `seq`、`state`、`stream` 同步成功
- 任一失败不会留下半提交状态

### 14.3 Worker 幂等测试

至少验证：

- 重复消费不重复写 `history`
- 中断恢复后能继续推进

### 14.4 恢复测试

至少验证：

- Redis 清空后可从 `MySQL` 重建
- 新实例可恢复文档在线态

### 14.5 多实例测试

至少验证：

- 一个实例确认，另一个实例能收到广播
- 广播顺序与确认顺序一致

## 15. 验收标准

本轮改造完成后，至少应满足：

- 写请求主链路不再同步依赖 `MySQL` 确认
- 同一文档的在线确认基于 `Redis` 实时态完成
- 已确认操作可立即回复并广播
- Worker 能稳定把实时操作流沉淀到 `MySQL`
- 可从 `MySQL snapshot + history/op_log` 恢复文档状态
- `set_cell`、`set_title`、`undo`、`redo`、`import_sheet` 协同语义不变

## 16. 本轮建议开工顺序

建议按以下顺序真正开始编码：

1. 先补配置层与 `Redis realtime/stream` 基础设施
2. 先做 `Gate` 的 `set_cell` 样板实现
3. 再做 `opLogFlushWorker`
4. 再补 `snapshotMaterializeWorker`
5. 打通 `set_title`
6. 打通 `undo/redo`
7. 最后迁 `import_sheet`
8. 最后补恢复、压测和多实例回归

## 17. 结论

这套方案当前可以直接落地。

原因不是系统已经天然支持双服务，而是：

- 当前项目已经具备实现所需的 `Redis`、`MySQL`、锁、广播和协同语义基础
- 需要重构的是写链路职责分配，而不是推翻现有业务协议

因此，本轮最务实的实施路径是：

- 先在 `backend-js` 内实现逻辑 `Gate`
- 先让 `Redis` 承担实时态确认
- 先让 `Redis Stream` 承担异步操作流
- 先让 worker 承担 `Apply&Store`
- 等链路稳定后，再决定是否拆为独立服务进程

最终一句话总结：

- **当前方案可以直接落地，推荐以“单仓库、逻辑双服务、Redis Stream 异步落盘”的方式分阶段实施。**
