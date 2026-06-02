# Gate / Apply&Store 分阶段实施计划

> 配套文档：`Gate实时态落地实施方案.md`（方向与拍板）。本文是其**可执行落地版**，
> 基于对当前代码的逐行核对，给出阶段顺序、咽喉改造点，并把 Phase 0 / Phase 1 细化到可开工。

## 0. 关键拍板（2026-06-02 确认）

| 决策 | 结论 |
|---|---|
| 优化目标 | **降写延迟 + 多实例水平扩展，两者都要** |
| 迁移策略 | **先统一切 Redis（seq+state 真相），再逐个接 Gate** |
| Worker 形态 | **先同进程后台 loop**，稳定后再评估拆独立进程 |
| **Gate 与 MySQL** | **Gate 写热路径零 MySQL**。Gate 只写 Redis（state+seq+经 Lua 落 stream）并投 MQ；Apply&Store 独占全部 MySQL 写。两模块仅通过 Redis Stream 通信，不共享内存、不互调函数 |
| **Redis 持久化** | **AOF `appendfsync everysec`**：state/stream 落盘，宕机最多丢约 1 秒已确认操作 |
| **首切策略** | **影子校验后切**：先让 worker 消费 stream 落 MySQL，对账 MySQL 与 Redis 一致，确认无误再把 set_cell 正式切纯 Redis |
| **冷启动取数** | **仅冷启动/恢复时读 MySQL** 暖 Redis；写路径永不碰 MySQL |

## 1. 现状核对结论（与方案文档的差异，重要）

落地前必须知道的代码现状，部分与方案文档描述不一致：

1. **seq 当前由 MySQL 持有**：`doc.current_seq`，在文档锁 + `SELECT...FOR UPDATE` 下做
   `current_seq + 1`（`docMysqlStore.js:382`、`docMemoryStore.js:259`）。不存在独立 seq
   计数器，也没有 Redis seq。这是本轮要搬的最核心对象。
2. **seq 分配点集中在 store 层**：所有 `applyX(command)` 都接受可选 `command.seq`，
   缺省才 `current_seq + 1`。这是 Phase 1 的关键抓手——只要由上层（Gate/Redis）预分配
   `seq` 并透传，store 既有逻辑无需大改。
3. **结构变更今天并不清空 undo/redo 栈**：`insert/delete row/col` 走坐标 transform，
   不清栈（方案文档"今天会清空"的描述偏旧）。所以 Phase 4 风险低于文档预期。
4. **import_sheet 当前无 join 校验**：handler 没有成员校验。方案要求收紧为"必须先
   join"，这是真实新增改动（Phase 7）。
5. **import_sheet 只清操作者自己的栈**，其他用户靠 OT barrier 拦截。
6. **广播无 sender 排除**：每条广播都回发给发送方，正好满足方案要保留的
   "reply + broadcast 双消息"行为。
7. **无任何 worker / Redis Stream / 独立进程**：全链路同步，按文档锁串行。Redis 现仅承担
   缓存、锁（已有 Lua release）、presence、pub/sub。

## 2. 落地主线：三个"咽喉点"

整套改造收敛到三个集中点，按序改造即可整体迁移 11 个写操作，无需一上来重写每个 service：

| 咽喉点 | 当前位置 | 现状 | 目标 |
|---|---|---|---|
| **A. seq + state 分配** | `store/docStore.applyX`（`current_seq+1`） | seq 在 MySQL 行锁内分配 | seq 由 Redis 经 Lua 分配，state 真相在 Redis |
| **B. rebase 历史来源** | `cellOtService.js:88` → `historyStore.listByDocIdSeqRange`（读 MySQL） | rebase 读 MySQL history `(baseSeq, currentSeq]` | 改读 Redis Stream（近段历史窗口） |
| **C. 持久化** | `historyStore.append` + 整快照重写（同步、锁内） | 同步写 MySQL | worker 异步消费 stream 落盘 |

锁（`infra/redis/lock.js`）、广播（`collabBroadcastService`，已支持 redis pub/sub）基本可复用。

## 3. 三个 correctness 雷区（实现时不可跳过）

1. **rebase 历史来源迁移**：Phase 2 把 MySQL 转异步后，MySQL history 会**落后于 Redis
   seq**，rebase 不能再读 MySQL。Redis Stream 必须同时承担"近段历史"角色——保留从最近
   checkpoint 往后的全部 op 事件，供坐标 transform 使用。stream 事件必须带齐
   `opType / sheetId / row / col`。client `baseSeq` 早于 checkpoint（极陈旧）直接返回
   `4090` 让其刷新，可接受。
2. **seq 单一权威 + 原子提交**：全程只能有一个 seq 源。Phase 1 起由 Redis 分配。提交用
   **Lua 脚本**原子完成 `CAS 校验 baseSeq → INCR seq → 写 state → XADD stream →
   更新 user-op`，杜绝"seq 推进了但 state/stream 没跟上"的半提交。doc 锁仍在外层串行，
   Lua 的 CAS 是双保险。
3. **恢复路径**：Redis 丢失时，以 MySQL 最新 snapshot + `current_seq` 为 checkpoint，
   回放 `history.seq > checkpoint` 重建 `rt:state + rt:seq + rt:stream + barrier`。
   **因为 Gate 不再同步写 MySQL，恢复模块必须在首切 set_cell 时就一次到位**——不存在
   "Redis 是真相但 MySQL 还同步"的中间安全态。这正是"影子校验后切"要兜住的风险。

## 3b. 架构纠正（相对早期草案）

早期细化版曾写"Phase 1 期 MySQL 仍同步镜像写"作为安全脚手架。按拍板
**Gate 写热路径零 MySQL** 纠正如下：

- **取消同步镜像**：Gate 任何环节不写 MySQL，MySQL 写由 worker 独占。
- **原 Phase 1（Redis 成真相）与原 Phase 2（worker+异步落盘）合并为一次切换**。因为没有
  同步镜像兜底，worker 与恢复必须在首切 set_cell 时同时就位。下文阶段表已据此合并。
- 风险因此集中到首切，用"影子校验后切"控制（见 Phase 1+2 §S）。

## 4. 阶段总览

降延迟 + 多实例两个目标在 **Phase 1+2 末**即全部达成；Phase 3 起是职责清晰化与语义收紧。

| Phase | 内容 | 目标达成 | 风险 |
|---|---|---|---|
| 0 | 基础设施骨架（flag 默认关，行为零变更） | — | 极低 |
| 1+2 | Redis 成真相 + worker 异步落盘 + set_cell 影子校验后切（**合并**，Gate 零 MySQL） | **降延迟 + 多实例达成** | **最高（首切风险集中）** |
| 3 | set_cell 样板 Gate 化 + set_title | 职责拆分 | 中 |
| 4 | 结构变更 + add_sheet 接 Gate | — | 低 |
| 5 | batch_set_cell | — | 中 |
| 6 | undo/redo + 用户栈迁 Redis | — | 中 |
| 7 | import_sheet（barrier + 收紧 join） | — | 最高 |
| 8 | cursor 治理 + 恢复/观测/压测收尾 | — | 低 |

### Phase 1+2 概述（合并，详见下文细化）
- Redis 成为 seq+state 唯一真相；Gate 写热路径**零 MySQL**。
- `worker/opLogFlushWorker.js` 消费 `rt:stream` → 幂等写 `history`（靠 `(doc_id, seq)`
  唯一约束兜底）。
- `worker/snapshotMaterializeWorker.js` 按 `SNAPSHOT_CHECKPOINT_OP_INTERVAL` 物化
  snapshot + 推进 checkpoint，并 `XTRIM` stream（保留 checkpoint 之后窗口）。
- 修复 `collabBroadcastService` 对 `STORE_DRIVER=mysql` 的耦合，让多实例广播随 Redis
  真相生效。
- **影子校验后切**：worker 先消费、对账一致，再把 set_cell 正式切纯 Redis。
- 验收：写热路径零 MySQL；worker 重复消费不重复写；Redis 清空可从 MySQL 重建；
  双实例确认→广播顺序一致。**至此两个目标达成。**

### Phase 3 — set_cell 样板 Gate 化 + set_title
- 抽 `service/gate/gateSetCellService.js`、`gateSetTitleService.js`，handler 只留入参/
  调用/回复广播。
- set_title 显式**不受 import_sheet barrier 阻断**（当前 barrier 判断在 `cellOtService`，
  set_title 不能复用该判断）。

### Phase 4 — 结构变更 + add_sheet
- `insert/delete row/col`、`add_sheet` 接入 gate 服务。
- 明确**不清栈**（现状本就如此），确认结构 transform 历史进入后续 undo/redo 参考。

### Phase 5 — batch_set_cell
- 坐标级 transform、去重、**单 seq** 语义保持不变，单条 stream 事件。

### Phase 6 — undo/redo + 用户栈迁 Redis
- `userOpStateStore` 增加 redis driver，用户私有栈主存 Redis，MySQL 留作过渡恢复副本。
- `sourceSeq` 语义、same-cell 让位 noop 逻辑不变。

### Phase 7 — import_sheet（风险最高）
- barrier 语义不变；**新增收紧为必须先 join**（未加入返回 `4003`）；整表替换 + 推进
  barrier；**不阻断 set_title**。

### Phase 8 — cursor 治理 + 收尾
- cursor 纳入统一 handler/gate 组织（不分配 seq、不进 stream、不落盘）；补重试/死信、
  观测、压测、多实例回归；评估是否拆独立进程。

---

# Phase 0 — 基础设施骨架（行为零变更）

**原则**：所有新增能力默认 flag 关闭，关时跑通现有全部测试、零行为差异。这一阶段只"放好
零件"，不接入写链路。

## 0.1 新增配置

新增 `config/realtimeConfig.js`，与现有 `lockConfig.js` / `cacheConfig.js` 风格一致
（`normalizeDriver` / `normalizePositiveNumber` / `normalizePrefix`）：

```js
// config/realtimeConfig.js
module.exports = {
  // 'memory'(默认) | 'redis'：Redis 实时态总开关
  driver: normalizeDriver(process.env.REALTIME_STATE_DRIVER),
  keyPrefix: normalizePrefix(process.env.REALTIME_KEY_PREFIX, 'collab:rt'),
  stateTtlMs: normalizePositiveNumber(process.env.REALTIME_STATE_TTL_MS, 0), // 0=不过期
};
```

```js
// config/streamConfig.js
module.exports = {
  driver: normalizeDriver(process.env.OP_STREAM_DRIVER),       // 'memory' | 'redis'
  consumerGroup: normalizePrefix(process.env.STREAM_CONSUMER_GROUP, 'apply-store'),
  batchSize: normalizePositiveNumber(process.env.STREAM_BATCH_SIZE, 64),
  // 保留窗口：checkpoint 之后 + 至少最近 N 条兜底极陈旧 client
  retainCount: normalizePositiveNumber(process.env.STREAM_RETAIN_COUNT, 500),
};
```

```js
// config/workerConfig.js
module.exports = {
  enabled: String(process.env.PERSIST_WORKER_ENABLED || '').toLowerCase() === 'true',
  snapshotOpInterval: normalizePositiveNumber(process.env.SNAPSHOT_CHECKPOINT_OP_INTERVAL, 200),
  snapshotTimeWindowMs: normalizePositiveNumber(process.env.SNAPSHOT_CHECKPOINT_TIME_WINDOW_MS, 30000),
};
```

环境变量（写入 `.env.example` 与 CLAUDE.md 驱动表）：
`REALTIME_STATE_DRIVER`、`REALTIME_KEY_PREFIX`、`REALTIME_STATE_TTL_MS`、
`OP_STREAM_DRIVER`、`STREAM_CONSUMER_GROUP`、`STREAM_BATCH_SIZE`、`STREAM_RETAIN_COUNT`、
`PERSIST_WORKER_ENABLED`、`SNAPSHOT_CHECKPOINT_OP_INTERVAL`、`SNAPSHOT_CHECKPOINT_TIME_WINDOW_MS`。

## 0.2 新增 Redis 实时态基础设施（`infra/redis/`）

复用现有 `createRedisConnection(name)`（`infra/redis/client.js`）。

| 文件 | 职责 |
|---|---|
| `infra/redis/realtimeClient.js` | 单例连接 + `ensureReady()`（仿 `lock.js` 的懒连接/关闭） |
| `infra/redis/realtimeKeys.js` | 统一 key 构造，前缀来自 `realtimeConfig.keyPrefix` |
| `infra/redis/realtimeLua.js` | 原子提交 Lua 脚本字符串 + `evalCommit()` 封装 |
| `infra/redis/stream.js` | `XADD` / `XREADGROUP` / `XACK` / `XTRIM` 薄封装 |

Redis key 设计（与方案文档 §8.1 一致）：

```
collab:rt:doc:{docId}:seq          # 当前最新全局 seq（字符串整数）
collab:rt:doc:{docId}:state        # 当前在线 snapshot（JSON 字符串）
collab:rt:doc:{docId}:stream       # 已确认操作流（Redis Stream）
collab:rt:doc:{docId}:barrier      # 最近 import_sheet 关键版本
collab:rt:doc:{docId}:checkpoint   # 已物化到 MySQL 的稳定 seq
collab:rt:doc:{docId}:user-op:{clientId}  # 用户 undo/redo 栈（Phase 6 用）
```

## 0.3 新增实时态 Store（`store/redis/`）

| 文件 | 职责 | 备注 |
|---|---|---|
| `store/redis/docRealtimeStore.js` | 读写 `rt:state` + `rt:seq`，封装 Lua 原子提交 | Phase 1 主角 |
| `store/redis/docOpStreamStore.js` | `append(event)` / `readRange(docId, fromSeq, toSeq)` | rebase + worker 共用 |
| `store/redis/userOpRealtimeStore.js` | 用户栈 Redis 版（**Phase 6 才接入**，先建空壳） | — |

`docRealtimeStore` 首版提供 `memory` + `redis` 两实现，按 `realtimeConfig.driver` 选择，
保持与 `store/docStore.js` 同样的"facade 选 driver"风格。memory 版让现有测试在不依赖
Redis 时也能覆盖新链路。

## 0.4 worker 骨架（同进程，先不消费）

| 文件 | 职责 |
|---|---|
| `worker/index.js` | `startWorkers()` / `stopWorkers()`，按 `workerConfig.enabled` 决定是否启动；首版空转 |
| `worker/opLogFlushWorker.js` | 占位（Phase 2 实现） |
| `worker/snapshotMaterializeWorker.js` | 占位（Phase 2 实现） |

`server.js` 增加可选启动钩子（flag 关时不影响现有启动）：

```js
// server.js（Phase 0 仅加挂载点，enabled=false 时为 noop）
const { startWorkers, stopWorkers } = require('./worker');
server.listen(appConfig.port, async () => {
  await startWorkers(); // workerConfig.enabled=false → 直接 return
});
```

## 0.5 恢复服务骨架（`service/recovery/`）

新增 `service/recovery/docRecoveryService.js`：
- `seedRealtimeFromMysql(docId)`：MySQL snapshot + `current_seq` → 写 `rt:state` + `rt:seq`
  + 初始化 `rt:checkpoint`。Phase 1 的 doc 首次访问由它触发。
- `rebuildRealtime(docId)`：恢复路径（checkpoint + 回放 history），**Phase 2 才需要完整实现**。

## 0.6 Phase 0 验收

- `REALTIME_STATE_DRIVER` 未设置（默认 memory）时：`npm test` / `npm run test:ws` 全绿，
  与改造前逐条一致。
- `PERSIST_WORKER_ENABLED` 未设 true 时：`server.js` 启动行为不变。
- 新增模块有单测覆盖 key 构造、Lua 封装、stream 薄封装。

---

# Phase 1+2 — Redis 成真相 + worker 异步落盘（合并，Gate 零 MySQL）

**这是改动面最大、风险最高的一步**。核心策略：**不动各 op 的业务逻辑**，改三个咽喉点
（A：seq+state 分配；B：rebase 历史来源；C：持久化交给 worker）。
**Gate 写热路径完全不碰 MySQL**——MySQL 写由 worker 独占消费 stream 完成。

打开方式：`REALTIME_STATE_DRIVER=redis` + `OP_STREAM_DRIVER=redis` +
`PERSIST_WORKER_ENABLED=true`（关时完全走旧链路，便于灰度/回滚对拍）。

## 1.1 改造抓手：store 已支持外部预分配 seq

关键发现：所有 `docStore.applyX(command)` 已接受可选 `command.seq`，仅当其缺省才
`current_seq + 1`（见 `docMemoryStore.js:259`、`docMysqlStore.js:382`）。这让
**worker 落盘时能用 stream 事件里的 seq 透传给 `applyX`**，store 既有逻辑无需改签名：

```
旧：service → docLock → [getDocStateForWrite(MySQL)] → applyX(无seq) → seq=current_seq+1
新（Gate，零 MySQL）：
   service → docLock → [Lua 原子: 读 rt:state、CAS baseSeq、INCR rt:seq、
                        写 rt:state、XADD stream] → 拿到 seq → 回复 + 广播
新（Worker，独占 MySQL）：
   消费 rt:stream → applyX({...event, seq}) 落 history+snapshot → XACK → 推进 checkpoint
```

即：**seq 由 Redis（Gate）分配；MySQL 写延后到 worker，用 stream 里带的 seq**，
不再在写热路径上做任何 MySQL 访问。

## 1.2 新增写入门面：`getDocStateForWrite` / `applyX` 的实时态分支

在 `docsService` 增加实时态分支（保持现有函数名，内部按 `realtimeConfig.driver` 选择）：

- `getDocStateForWrite(docId, opts)`：
  - redis 模式：先 `docRealtimeStore.getState(docId)`；miss 则
    `docRecoveryService.seedRealtimeFromMysql(docId)` 后重读。返回的 `snapshotJson` /
    `currentSeq` 来自 Redis。
  - memory/mysql 模式：维持现有 `docStore.getDocState`。
- `applySetCell(command, opts)`（及其他 applyX）：
  - redis 模式（Gate）：调用 `docRealtimeStore.commit(...)`（Lua 原子提交）拿到新 seq +
    新 state + 已 XADD 的 stream 事件，**到此 Gate 结束，不写 MySQL**。
  - **MySQL 落盘不在这里发生**——由 worker 消费 stream 完成（§1.5）。
  - memory/mysql 模式：维持旧逻辑（落盘脚手架仅用于 flag 关闭时的回归对拍）。

> 说明：Phase 1+2 仍由 `cellService` 等编排锁与调用顺序，**不引入 Gate 类**。Gate 化是
> Phase 3+ 的事，避免一次改太多。

## 1.3 Lua 原子提交脚本（咽喉点 A 的核心）

`infra/redis/realtimeLua.js` 提供一段脚本，单次 `EVAL` 内完成：

```
KEYS = [seqKey, stateKey, streamKey, barrierKey]
ARGV = [expectedBaseSeq, newStateJson, streamFields..., opType, ...]

1. local cur = tonumber(redis.call('GET', seqKey) or '0')
2. -- baseSeq 校验：baseSeq==nil 跳过；baseSeq>cur → 返回 conflict(ahead)
3. local newSeq = cur + 1
4. redis.call('SET', seqKey, newSeq)
5. redis.call('SET', stateKey, newStateJson)         -- 整快照写入（沿用当前整快照模型）
6. redis.call('XADD', streamKey, newSeq..'-0', 'event', eventJson)
7. -- import_sheet 时推进 barrier
8. return newSeq
```

要点：
- **CAS 不在 Lua 里做 rebase**（rebase 涉及读 history range、坐标 transform，逻辑复杂，
  留在 JS 层）。Lua 只做"基于已 rebase 后的最终 state 做原子落地 + seq 分配"。
- 调用顺序：JS 层先在锁内读 `rt:state`、跑 `rebaseSetCellCommand`（改读 stream，见 §1.4）、
  算出最终 `nextState`，再把 `nextState` 交给 Lua 一次性落地。
- stream `XADD` 用 `{newSeq}-0` 作为 message id，使 seq 与 stream id 对齐，便于
  worker 幂等与 `readRange`。

## 1.4 rebase 历史来源切到 stream（咽喉点 B）

`cellOtService.rebaseSetCellCommand` 当前通过注入的 `historyStore.listByDocIdSeqRange`
读 MySQL。改造：

- 新增 `historySource` 抽象：redis 模式注入 `docOpStreamStore.readRange(docId, baseSeq, currentSeq)`，
  返回结构与 `historyStore` 行兼容（含 `opType / targetSheetId / targetRow / targetCol`）。
- `transformCellReferenceThroughHistory`、`shouldTreatAsOtBarrier` 逻辑**完全不变**，只换数据源。
- **影子校验期对拍**：worker 落盘后，同一 `(baseSeq, currentSeq]` 用 stream 与 MySQL
  history 两个数据源应返回等价序列，作为切换正确性的硬验收（见 §S）。
- 极陈旧 `baseSeq < checkpoint`（早于 stream 保留窗口）：返回 `4090`（CONFLICT，刷新）。

## 1.5 一致性与失败处理（Gate 零 MySQL）

- **Gate 提交**：锁内 Lua 一次性完成 `CAS baseSeq → INCR seq → 写 state → XADD stream`。
  Lua 返回成功即"在线确认成功"，立即回复 + 广播。**Gate 不写 MySQL，无镜像、无回滚。**
- **MySQL 落盘失败（worker 侧）**：Redis 已是真相，操作仍视为在线成功。worker 自动重试，
  重复消费靠 `history (doc_id, seq)` 唯一约束兜底。失败累积由死信 + 告警暴露（Phase 8 完善）。
- **Redis 宕机丢失窗口**：AOF `appendfsync everysec`，最多丢约 1 秒 worker 尚未落盘且
  AOF 尚未刷盘的已确认操作；恢复时 seq 可能回退到 AOF 落点。这是已接受的权衡。
- **doc 锁**：继续用 `infra/redis/lock.js`。Lua CAS 是第二道防线（多实例 + 锁 TTL 过期场景）。

## 1.6 Worker：独占 MySQL 落盘（咽喉点 C）

- `worker/opLogFlushWorker.js`：`XREADGROUP`（消费组 `streamConfig.consumerGroup`）批量读
  `rt:stream` → 对每条事件 `historyStore.append` + `docStore.applyX({...event, seq})`
  （用事件里的 seq，幂等靠 `(doc_id, seq)`）→ `XACK`。
- `worker/snapshotMaterializeWorker.js`：按 `SNAPSHOT_CHECKPOINT_OP_INTERVAL` /
  `TIME_WINDOW_MS` 物化 `doc.snapshot_json` + 推进 `rt:checkpoint` → `XTRIM` 保留
  checkpoint 之后 + 至少最近 `STREAM_RETAIN_COUNT` 条。
- worker 与 Gate **仅通过 stream 通信**，不共享内存、不互调函数，为将来拆进程留零成本路径。

## 1.S 影子校验后切（首切风险控制）

首切 set_cell 到纯 Redis 前，分两步降风险：

1. **影子期**：`REALTIME_STATE_DRIVER=redis` + worker 开启，但保留旧链路对拍。让 worker
   消费 stream 落 MySQL，写**对账脚本**比对 `rt:state` 与 MySQL `snapshot_json`、
   `rt:seq` 与 `doc.current_seq` 一致。
2. **切换**：对账连续无差异后，正式以 Redis 为 set_cell 唯一真相，移除旧同步落盘脚手架。
3. 回滚：关闭 flag 即回旧链路（旧链路在影子期始终可用）。

## 1.6b 恢复 / seed（`docRecoveryService`）

- `seedRealtimeFromMysql(docId)`：`docStore.getDocState` → 写 `rt:state`、`rt:seq=current_seq`、
  `rt:checkpoint=current_seq`、stream 留空（旧历史不回灌，靠 checkpoint 兜底）。
- `rebuildRealtime(docId)`：Redis 丢失/回退后，以 MySQL snapshot+`current_seq` 为
  checkpoint，回放 `history.seq > checkpoint` 重建 `rt:state/seq/stream/barrier`。
- 触发点：`getDocStateForWrite` 在 redis 模式 miss 时（仅冷启动/恢复路径读 MySQL，
  **写热路径永不触发**）。
- 并发 seed/rebuild 用 doc 锁串行，避免双写。

## 1.7 文件清单（Phase 1+2）

新增：
- `store/redis/docRealtimeStore.js`（memory + redis 双实现 + facade）
- `store/redis/docOpStreamStore.js`
- `infra/redis/realtimeLua.js` 落地正式脚本
- `service/recovery/docRecoveryService.js`（seed + 恢复重建）
- `worker/opLogFlushWorker.js`、`worker/snapshotMaterializeWorker.js`（实现消费/物化）
- 对账脚本（影子校验用，`scripts/` 下）

改造：
- `service/docsService.js`：`getDocStateForWrite` / `applyX` 增加 realtime 分支（Gate 零 MySQL）
- `service/cellOtService.js`：rebase 数据源由 `historyStore` 改为可注入 `historySource`
- `service/collabBroadcastService.js`：解除对 `STORE_DRIVER=mysql` 的耦合
- worker 侧落盘复用 `historyStore.append` + `docStore.applyX({...event, seq})`

不改：各 op 的业务规则、handler、广播协议、reply+broadcast 双消息行为。

## 1.8 验收（Phase 1+2）

- 开启 redis+stream+worker 下 11 个写操作语义与旧链路逐条一致。
- **写热路径零 MySQL**：set_cell 确认期间无任何 MySQL 访问（可用查询计数/打点验证）。
- **对账无差异**：影子期 `rt:state`↔`snapshot_json`、`rt:seq`↔`current_seq` 一致。
- **对拍测试**：rebase 读 stream 与读 MySQL history 返回等价。
- `set_cell baseSeq` stale / future、`import_sheet` barrier、`set_title` 不受 barrier
  阻断、结构变更不清栈——全部回归通过。
- Redis 原子性：`seq` / `state` / `stream` 同步成功；任一失败不留半提交（Lua 保证）。
- worker 重复消费不重复写 `history`；中断恢复后能继续推进。
- Redis 清空后经 `docRecoveryService` 可从 MySQL snapshot+history 重建在线态。
- 双实例：一实例确认，另一实例收到广播，顺序与确认序一致。
- flag 关闭时与改造前零差异。

## 1.9 开工顺序（Phase 0 → 1+2）

1. Phase 0 全部骨架 + flag（默认关）→ 跑通现有测试。
2. `docRealtimeStore` memory 实现 + 单测（先不碰 Redis）。
3. `docOpStreamStore` + `realtimeLua` redis 实现 + 单测（需本地 Redis）。
4. `docsService` 写入门面分支 + `seedRealtimeFromMysql`。
5. `cellOtService` rebase 数据源抽象 + 对拍测试。
6. `opLogFlushWorker` + `snapshotMaterializeWorker` 消费落盘 + 幂等/恢复测试。
7. 开启 redis+stream+worker，进入 set_cell **影子期**：跑对账脚本至连续无差异。
8. 正式切 set_cell 纯 Redis，移除旧落盘脚手架；再逐个验证其余 10 个写操作。



