const crypto = require('node:crypto');

const storeConfig = require('../config/storeConfig');
const runtimeConfig = require('../config/runtimeConfig');
const { createRedisConnection } = require('../infra/redis/client');
const { query, execute, withTransaction } = require('../db/mysql');
const docRealtimeService = require('../service/docRealtimeService');
const docsService = require('../service/docsService');
const historyStore = require('../store/historyStore');
const userOpStateStore = require('../store/userOpStateStore');
const snapshotCheckpointStore = require('../store/snapshotCheckpointStore');
const docBarrierStore = require('../store/docBarrierStore');

const CONSUMER_NAME = 'op_log_flush_worker_v1';
const LEADER_LOCK_KEY = 'collab:lock:worker:op_log_flush';
const RELEASE_LOCK_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  end
  return 0
`;

function toMysqlDateValue(value = new Date()) {
  if (value instanceof Date) {
    return value;
  }

  const normalizedDate = new Date(value);
  return Number.isNaN(normalizedDate.getTime()) ? new Date() : normalizedDate;
}

function shouldEnableWorker() {
  return storeConfig.driver === 'mysql' && runtimeConfig.driver === 'redis';
}

function createOpLogFlushWorker() {
  const redisClient = createRedisConnection('op-log-flush-worker');

  let initPromise = null;
  let closePromise = null;
  let timer = null;
  let isClosed = false;
  let isRunning = false;

  function getPollIntervalMs() {
    const rawValue = Number(process.env.OP_LOG_FLUSH_INTERVAL_MS || 100);
    return Number.isFinite(rawValue) && rawValue > 0 ? rawValue : 100;
  }

  async function ensureRedisReady() {
    if (isClosed) {
      return;
    }

    if (!initPromise) {
      initPromise = redisClient.connect().catch((error) => {
        initPromise = null;
        throw error;
      });
    }

    await initPromise;
  }

  async function acquireLeaderLock() {
    await ensureRedisReady();

    if (isClosed || !redisClient.isOpen) {
      return null;
    }

    const token = crypto.randomUUID();
    const result = await redisClient.set(LEADER_LOCK_KEY, token, {
      NX: true,
      PX: Math.max(getPollIntervalMs() * 5, 1000),
    });

    return result === 'OK' ? token : null;
  }

  async function releaseLeaderLock(token) {
    if (!token) {
      return;
    }

    await ensureRedisReady();
    if (isClosed || !redisClient.isOpen) {
      return;
    }

    await redisClient.eval(RELEASE_LOCK_SCRIPT, {
      keys: [LEADER_LOCK_KEY],
      arguments: [token],
    });
  }

  async function getCheckpoint(docId) {
    const [rows] = await query(
      `SELECT last_stream_id
      FROM worker_consumer_checkpoint
      WHERE consumer_name = ? AND doc_id = ?
      LIMIT 1`,
      [CONSUMER_NAME, docId]
    );

    return rows[0] ? rows[0].last_stream_id : null;
  }

  async function saveCheckpoint(docId, streamId) {
    await execute(
      `INSERT INTO worker_consumer_checkpoint (
        consumer_name,
        doc_id,
        last_stream_id,
        updated_at
      ) VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        last_stream_id = VALUES(last_stream_id),
        updated_at = VALUES(updated_at)`,
      [CONSUMER_NAME, docId, streamId, toMysqlDateValue(new Date())]
    );
  }

  async function persistSetTitle(op, connection) {
    return docsService.applySetTitle({
      docId: op.docId,
      title: op.newValueJson.title,
      seq: op.seq,
    }, { connection });
  }

  async function persistSetCell(op, connection) {
    const updatedDoc = await docsService.applySetCell({
      docId: op.docId,
      sheetId: op.targetSheetId,
      row: op.targetRow,
      col: op.targetCol,
      value: op.newValueJson.value,
      style: op.newValueJson.style,
      seq: op.seq,
    }, { connection });

    if (op.clientId) {
      const realtimeUserState = await docRealtimeService.getUserOpState(op.docId, op.clientId);
      if (realtimeUserState) {
        await userOpStateStore.saveState(realtimeUserState, { connection });
      }
    }

    return updatedDoc;
  }

  async function persistUndoRedo(op, connection) {
    return persistSetCell(op, connection);
  }

  async function persistImportSheet(op, connection) {
    const updatedDoc = await docsService.applyImportSheet({
      docId: op.docId,
      snapshotJson: op.payloadJson,
      seq: op.seq,
    }, { connection });

    if (op.clientId) {
      const realtimeUserState = await docRealtimeService.getUserOpState(op.docId, op.clientId);
      if (realtimeUserState) {
        await userOpStateStore.saveState(realtimeUserState, { connection });
      }
    }

    return updatedDoc;
  }

  async function persistAddSheet(op, connection) {
    return docsService.applyAddSheet({
      docId: op.docId,
      sheetName: op.payloadJson && op.payloadJson.sheet ? op.payloadJson.sheet.name : null,
      seq: op.seq,
    }, { connection });
  }

  async function persistSheetStructureChange(op, connection) {
    const updatedDoc = await docsService.applySheetStructureChange({
      docId: op.docId,
      sheetId: op.targetSheetId,
      opType: op.opType,
      row: op.targetRow,
      col: op.targetCol,
      seq: op.seq,
    }, { connection });

    await userOpStateStore.clearByDocId(op.docId, { connection });
    return updatedDoc;
  }

  async function persistCheckpointState(updatedDoc, connection) {
    if (!updatedDoc) {
      return;
    }

    await snapshotCheckpointStore.saveCheckpoint({
      docId: updatedDoc.docId,
      checkpointSeq: updatedDoc.currentSeq,
      title: updatedDoc.title,
      snapshotJson: updatedDoc.snapshotJson,
      createdAt: updatedDoc.createdAt,
      updatedAt: updatedDoc.updatedAt,
    }, { connection });
  }

  async function persistOp(entry) {
    const { op } = entry;

    await withTransaction(async (connection) => {
      const existingHistory = await historyStore.findByDocIdAndSeq(op.docId, op.seq, { connection });
      if (existingHistory) {
        return;
      }

      let updatedDoc = null;

      if (op.opType === 'set_title') {
        updatedDoc = await persistSetTitle(op, connection);
      } else if (op.opType === 'set_cell') {
        updatedDoc = await persistSetCell(op, connection);
      } else if (op.opType === 'undo' || op.opType === 'redo') {
        updatedDoc = await persistUndoRedo(op, connection);
      } else if (op.opType === 'import_sheet') {
        updatedDoc = await persistImportSheet(op, connection);
      } else if (op.opType === 'add_sheet') {
        updatedDoc = await persistAddSheet(op, connection);
      } else if (['insert_row', 'delete_row', 'insert_col', 'delete_col'].includes(op.opType)) {
        updatedDoc = await persistSheetStructureChange(op, connection);
      } else {
        return;
      }

      await historyStore.append(op, { connection });
      await persistCheckpointState(updatedDoc, connection);

      if (op.opType === 'import_sheet') {
        await docBarrierStore.saveBarrier({
          docId: op.docId,
          seq: op.seq,
          opType: 'import_sheet',
          eventId: op.eventId || null,
          payloadJson: op.payloadJson || null,
          updatedAt: op.createdAt || new Date().toISOString(),
        }, { connection });
      }
    });
  }

  async function flushDoc(docId) {
    let lastStreamId = await getCheckpoint(docId);

    while (!isClosed) {
      const entries = await docRealtimeService.listOps(docId, {
        afterId: lastStreamId,
        count: 100,
      });

      if (!entries.length) {
        return;
      }

      for (const entry of entries) {
        await persistOp(entry);
        lastStreamId = entry.id;
        await saveCheckpoint(docId, lastStreamId);
      }
    }
  }

  async function runOnce() {
    if (!shouldEnableWorker() || isClosed || isRunning) {
      return;
    }

    isRunning = true;
    const lockToken = await acquireLeaderLock().catch((error) => {
      console.error('op-log worker acquire leader lock failed:', error);
      return null;
    });

    try {
      if (!lockToken) {
        return;
      }

      const docIds = await docRealtimeService.listTrackedDocIds();
      for (const docId of docIds) {
        await flushDoc(docId);
      }
    } catch (error) {
      console.error('op-log worker flush failed:', error);
    } finally {
      await releaseLeaderLock(lockToken).catch((error) => {
        console.error('op-log worker release leader lock failed:', error);
      });
      isRunning = false;
    }
  }

  function scheduleNextRun() {
    if (isClosed || !shouldEnableWorker()) {
      return;
    }

    timer = setTimeout(async () => {
      timer = null;
      await runOnce();
      scheduleNextRun();
    }, getPollIntervalMs());
  }

  async function start() {
    if (!shouldEnableWorker() || isClosed || timer) {
      return;
    }

    await runOnce();
    scheduleNextRun();
  }

  async function close() {
    if (!closePromise) {
      closePromise = (async () => {
        isClosed = true;

        if (timer) {
          clearTimeout(timer);
          timer = null;
        }

        if (initPromise) {
          await initPromise.catch(() => {});
        }

        if (redisClient.isOpen) {
          await redisClient.quit().catch(() => redisClient.disconnect());
        }

        if (redisClient.isOpen) {
          await redisClient.disconnect().catch(() => {});
        }

        initPromise = null;
      })();
    }

    await closePromise;
  }

  return {
    start,
    close,
  };
}

module.exports = createOpLogFlushWorker();
