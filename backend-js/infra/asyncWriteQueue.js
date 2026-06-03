const os = require('node:os');

const storeConfig = require('../config/storeConfig');
const cacheConfig = require('../config/cacheConfig');
const lockConfig = require('../config/lockConfig');
const { withTransaction } = require('../db/mysql');
const { createRedisConnection } = require('./redis/client');
const createUserOpStateMysqlStore = require('../store/mysql/userOpStateMysqlStore');

const BATCH_SIZE = 50;
const MAX_RETRIES = 3;
const STREAM_BLOCK_MS = 1000;
const CLAIM_IDLE_MS = 5000;
const DRAIN_POLL_MS = 25;
const STREAM_KEY = `${cacheConfig.keyPrefix}:async-write-stream`;
const STREAM_GROUP = `${cacheConfig.keyPrefix}:async-write-group`;
const DEAD_LETTER_STREAM_KEY = `${cacheConfig.keyPrefix}:async-write-dlq`;
const STREAM_CONSUMER = `${process.env.SERVER_ID || os.hostname()}:${process.pid}`;
const userOpStateMysqlStore = createUserOpStateMysqlStore();

const memoryQueue = [];
let memoryRunning = false;
let memoryDrainResolvers = [];

let producerClient = null;
let consumerClient = null;
let initPromise = null;
let startPromise = null;
let closePromise = null;
let isClosing = false;
let streamLoopPromise = null;
let streamProcessing = 0;

function isMysql() {
  return storeConfig.driver === 'mysql';
}

function hasRedisConfig() {
  return cacheConfig.driver === 'redis'
    || lockConfig.driver === 'redis'
    || Boolean(process.env.REDIS_URL)
    || Boolean(process.env.REDIS_HOST);
}

function shouldUseRedisStream() {
  return isMysql() && hasRedisConfig();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeRedisValue(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (Buffer.isBuffer(value)) {
    return value.toString();
  }

  return String(value);
}

function parseRawMessageFields(fields = []) {
  const message = {};

  for (let index = 0; index < fields.length; index += 2) {
    const key = normalizeRedisValue(fields[index]);
    message[key] = normalizeRedisValue(fields[index + 1]);
  }

  return message;
}

function parseStreamEntries(rawResponse) {
  if (!Array.isArray(rawResponse)) {
    return [];
  }

  const parsed = [];

  for (const streamEntry of rawResponse) {
    const [, messages] = streamEntry;

    if (!Array.isArray(messages)) {
      continue;
    }

    for (const messageEntry of messages) {
      const [id, fields] = messageEntry;
      parsed.push({
        id: normalizeRedisValue(id),
        message: parseRawMessageFields(fields),
      });
    }
  }

  return parsed;
}

function parseAutoClaimEntries(rawResponse) {
  if (!Array.isArray(rawResponse) || !Array.isArray(rawResponse[1])) {
    return [];
  }

  return rawResponse[1].map((messageEntry) => {
    const [id, fields] = messageEntry;
    return {
      id: normalizeRedisValue(id),
      message: parseRawMessageFields(fields),
    };
  });
}

function parseQueuedItem(entry) {
  const payload = entry.message.payload ? JSON.parse(entry.message.payload) : null;
  return {
    id: entry.id,
    type: entry.message.type,
    data: payload,
  };
}

async function persistItem(conn, item) {
  if (item.type === 'persistSetCell') {
    const {
      docId,
      snapshotJson,
      seq,
      updatedAt,
      historyEntry,
      userOpState,
    } = item.data;
    await conn.execute(
      'UPDATE doc SET snapshot_json = CAST(? AS JSON), current_seq = ?, updated_at = ? WHERE doc_id = ? AND current_seq < ?',
      [JSON.stringify(snapshotJson), seq, new Date(updatedAt), docId, seq]
    );

    await conn.execute(
      `INSERT INTO history (
        doc_id, seq, base_seq, client_id, op_type, target_sheet_id,
        target_row, target_col, old_value_json, new_value_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?)
      ON DUPLICATE KEY UPDATE seq = seq`,
      [
        historyEntry.docId,
        historyEntry.seq,
        historyEntry.baseSeq ?? null,
        historyEntry.clientId,
        historyEntry.opType,
        historyEntry.targetSheetId ?? null,
        historyEntry.targetRow ?? null,
        historyEntry.targetCol ?? null,
        JSON.stringify(historyEntry.oldValueJson ?? null),
        JSON.stringify(historyEntry.newValueJson ?? null),
        new Date(historyEntry.createdAt || Date.now()),
      ]
    );

    if (userOpState) {
      await userOpStateMysqlStore.saveState(userOpState, { connection: conn });
    }
    return;
  }

  if (item.type === 'applySetCell') {
    const { docId, snapshotJson, seq, updatedAt } = item.data;
    await conn.execute(
      'UPDATE doc SET snapshot_json = CAST(? AS JSON), current_seq = ?, updated_at = ? WHERE doc_id = ? AND current_seq < ?',
      [JSON.stringify(snapshotJson), seq, new Date(updatedAt), docId, seq]
    );
    return;
  }

  if (item.type === 'appendHistory') {
    const d = item.data;
    await conn.execute(
      `INSERT INTO history (
        doc_id, seq, base_seq, client_id, op_type, target_sheet_id,
        target_row, target_col, old_value_json, new_value_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?)
      ON DUPLICATE KEY UPDATE seq = seq`,
      [
        d.docId, d.seq, d.baseSeq ?? null, d.clientId, d.opType,
        d.targetSheetId ?? null, d.targetRow ?? null, d.targetCol ?? null,
        JSON.stringify(d.oldValueJson ?? null),
        JSON.stringify(d.newValueJson ?? null),
        new Date(d.createdAt || Date.now()),
      ]
    );
    return;
  }

  if (item.type === 'upsertUserOpState') {
    await userOpStateMysqlStore.saveState(item.data, { connection: conn });
    return;
  }

  if (item.type === 'deleteUserOpState') {
    const { docId, clientId } = item.data;
    await conn.execute(
      'DELETE FROM user_op_state WHERE doc_id = ? AND client_id = ?',
      [docId, clientId]
    );
    return;
  }

  if (item.type === 'clearUserOpState') {
    await userOpStateMysqlStore.clearByDocId(item.data.docId, { connection: conn });
  }
}

async function flushMemoryQueue() {
  if (memoryRunning || memoryQueue.length === 0) {
    return;
  }

  memoryRunning = true;
  const batch = memoryQueue.splice(0, BATCH_SIZE);

  let attempts = 0;
  while (attempts < MAX_RETRIES) {
    try {
      await withTransaction(async (conn) => {
        for (const item of batch) {
          await persistItem(conn, item);
        }
      });
      break;
    } catch (err) {
      attempts += 1;
      if (attempts >= MAX_RETRIES) {
        console.error('[asyncWriteQueue] memory batch failed after retries:', err.message, batch);
      }
    }
  }

  memoryRunning = false;

  if (memoryQueue.length > 0) {
    setImmediate(flushMemoryQueue);
  } else {
    const resolvers = memoryDrainResolvers.splice(0);
    for (const resolve of resolvers) resolve();
  }
}

async function ensureRedisReady() {
  if (!shouldUseRedisStream()) {
    return;
  }

  if (!initPromise) {
    initPromise = (async () => {
      producerClient = createRedisConnection('async-write-producer');
      consumerClient = createRedisConnection('async-write-consumer');

      await Promise.all([
        producerClient.connect(),
        consumerClient.connect(),
      ]);

      try {
        await producerClient.sendCommand([
          'XGROUP',
          'CREATE',
          STREAM_KEY,
          STREAM_GROUP,
          '0',
          'MKSTREAM',
        ]);
      } catch (error) {
        if (!String(error?.message || '').includes('BUSYGROUP')) {
          throw error;
        }
      }
    })().catch((error) => {
      initPromise = null;
      throw error;
    });
  }

  await initPromise;
}

async function acknowledgeMessage(messageId) {
  if (!consumerClient || !consumerClient.isOpen) {
    return;
  }

  await consumerClient.sendCommand(['XACK', STREAM_KEY, STREAM_GROUP, messageId]);
  await consumerClient.sendCommand(['XDEL', STREAM_KEY, messageId]);
}

async function moveToDeadLetter(message, error) {
  if (!producerClient || !producerClient.isOpen) {
    return;
  }

  await producerClient.sendCommand([
    'XADD',
    DEAD_LETTER_STREAM_KEY,
    '*',
    'type',
    message.type,
    'payload',
    JSON.stringify(message.data ?? null),
    'sourceId',
    message.id,
    'error',
    String(error?.message || error || 'unknown error'),
    'failedAt',
    new Date().toISOString(),
  ]);
}

async function processStreamEntries(entries) {
  if (entries.length === 0) {
    return;
  }

  streamProcessing += entries.length;

  try {
    for (const entry of entries) {
      const message = parseQueuedItem(entry);
      let attempts = 0;

      while (attempts < MAX_RETRIES) {
        try {
          await withTransaction(async (conn) => {
            await persistItem(conn, message);
          });
          await acknowledgeMessage(message.id);
          break;
        } catch (error) {
          attempts += 1;
          if (attempts >= MAX_RETRIES) {
            console.error('[asyncWriteQueue] redis-stream message failed after retries:', error.message, message);
            await moveToDeadLetter(message, error);
            await acknowledgeMessage(message.id);
          } else {
            await sleep(50 * attempts);
          }
        }
      }
    }
  } finally {
    streamProcessing -= entries.length;
  }
}

async function readClaimedEntries() {
  if (!consumerClient || !consumerClient.isOpen) {
    return [];
  }

  const rawResponse = await consumerClient.sendCommand([
    'XAUTOCLAIM',
    STREAM_KEY,
    STREAM_GROUP,
    STREAM_CONSUMER,
    String(CLAIM_IDLE_MS),
    '0-0',
    'COUNT',
    String(BATCH_SIZE),
  ]);

  return parseAutoClaimEntries(rawResponse);
}

async function readNewEntries() {
  if (!consumerClient || !consumerClient.isOpen) {
    return [];
  }

  const rawResponse = await consumerClient.sendCommand([
    'XREADGROUP',
    'GROUP',
    STREAM_GROUP,
    STREAM_CONSUMER,
    'COUNT',
    String(BATCH_SIZE),
    'BLOCK',
    String(STREAM_BLOCK_MS),
    'STREAMS',
    STREAM_KEY,
    '>',
  ]);

  return parseStreamEntries(rawResponse);
}

async function runStreamLoop() {
  while (!isClosing) {
    try {
      const claimedEntries = await readClaimedEntries();
      if (claimedEntries.length > 0) {
        await processStreamEntries(claimedEntries);
        continue;
      }

      const newEntries = await readNewEntries();
      await processStreamEntries(newEntries);
    } catch (error) {
      if (!isClosing) {
        console.error('[asyncWriteQueue] redis-stream loop failed:', error);
        await sleep(250);
      }
    }
  }
}

async function getPendingCount() {
  if (!producerClient || !producerClient.isOpen) {
    return 0;
  }

  const response = await producerClient.sendCommand(['XPENDING', STREAM_KEY, STREAM_GROUP]);
  if (Array.isArray(response) && response.length > 0) {
    return Number(response[0]) || 0;
  }

  return Number(response) || 0;
}

async function getStreamLength() {
  if (!producerClient || !producerClient.isOpen) {
    return 0;
  }

  const response = await producerClient.sendCommand(['XLEN', STREAM_KEY]);
  return Number(response) || 0;
}

module.exports = {
  async enqueue(item) {
    if (!isMysql()) {
      return;
    }

    if (!shouldUseRedisStream()) {
      memoryQueue.push(item);
      setImmediate(flushMemoryQueue);
      return;
    }

    await this.start();
    await producerClient.sendCommand([
      'XADD',
      STREAM_KEY,
      '*',
      'type',
      item.type,
      'payload',
      JSON.stringify(item.data ?? null),
      'enqueuedAt',
      new Date().toISOString(),
    ]);
  },

  async start() {
    if (!shouldUseRedisStream() || isClosing) {
      return;
    }

    if (!startPromise) {
      startPromise = (async () => {
        await ensureRedisReady();
        if (!streamLoopPromise) {
          streamLoopPromise = runStreamLoop();
        }
      })().catch((error) => {
        startPromise = null;
        throw error;
      });
    }

    await startPromise;
  },

  async drain() {
    if (!isMysql()) {
      return;
    }

    if (!shouldUseRedisStream()) {
      if (!memoryRunning && memoryQueue.length === 0) {
        return;
      }

      return new Promise((resolve) => memoryDrainResolvers.push(resolve));
    }

    await this.start();

    while (true) {
      const [streamLength, pendingCount] = await Promise.all([
        getStreamLength(),
        getPendingCount(),
      ]);

      if (streamProcessing === 0 && streamLength === 0 && pendingCount === 0) {
        return;
      }

      await sleep(DRAIN_POLL_MS);
    }
  },

  async close() {
    if (shouldUseRedisStream()) {
      if (!closePromise) {
        closePromise = (async () => {
          isClosing = true;

          if (streamLoopPromise) {
            await Promise.race([
              streamLoopPromise.catch(() => {}),
              sleep(STREAM_BLOCK_MS + 200),
            ]);
          }

          if (producerClient?.isOpen) {
            await producerClient.quit().catch(() => producerClient.disconnect());
          }

          if (consumerClient?.isOpen) {
            await consumerClient.quit().catch(() => consumerClient.disconnect());
          }

          producerClient = null;
          consumerClient = null;
          initPromise = null;
          startPromise = null;
          streamLoopPromise = null;
          streamProcessing = 0;
        })();
      }

      await closePromise;
      return;
    }

    memoryQueue.length = 0;
    memoryRunning = false;
    const resolvers = memoryDrainResolvers.splice(0);
    for (const resolve of resolvers) resolve();
  },
};
