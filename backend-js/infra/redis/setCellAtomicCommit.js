const cacheConfig = require('../../config/cacheConfig');
const { createUserOpState } = require('../../domain/entities/userOpState');
const { docSeqKey, docSnapshotKey, histEntryKey } = require('../../cache/cacheKeys');
const { createRedisConnection } = require('./client');
const createUserOpStateRedisStore = require('../../store/redis/userOpStateRedisStore');

const STREAM_KEY = `${cacheConfig.keyPrefix}:async-write-stream`;
const LUA_COMMIT_SET_CELL = `
local seqKey = KEYS[1]
local snapshotKey = KEYS[2]
local historyKey = KEYS[3]
local userOpKey = KEYS[4]
local userDocClientsKey = KEYS[5]
local userGlobalKeysKey = KEYS[6]
local streamKey = KEYS[7]

local expectedSeq = tonumber(ARGV[1])
local seqPayload = ARGV[2]
local snapshotPayload = ARGV[3]
local historyPayload = ARGV[4]
local userOpPayload = ARGV[5]
local snapshotTtlMs = tonumber(ARGV[6])
local historyTtlMs = tonumber(ARGV[7])
local userOpTtlMs = tonumber(ARGV[8])
local clientId = ARGV[9]
local userRowKey = ARGV[10]
local streamType = ARGV[11]
local streamPayload = ARGV[12]
local enqueuedAt = ARGV[13]

local currentRaw = redis.call('GET', seqKey)
local currentSeq = 0

if currentRaw then
  local ok, parsed = pcall(cjson.decode, currentRaw)
  if not ok or type(parsed) ~= 'table' then
    return redis.error_reply('SEQ_STATE_INVALID')
  end
  currentSeq = tonumber(parsed.currentSeq or 0)
end

if currentSeq ~= expectedSeq then
  return redis.error_reply('SEQ_MISMATCH')
end

redis.call('SET', seqKey, seqPayload)

if snapshotTtlMs and snapshotTtlMs > 0 then
  redis.call('SET', snapshotKey, snapshotPayload, 'PX', snapshotTtlMs)
else
  redis.call('SET', snapshotKey, snapshotPayload)
end

if historyTtlMs and historyTtlMs > 0 then
  redis.call('SET', historyKey, historyPayload, 'PX', historyTtlMs)
else
  redis.call('SET', historyKey, historyPayload)
end

if userOpTtlMs and userOpTtlMs > 0 then
  redis.call('SET', userOpKey, userOpPayload, 'PX', userOpTtlMs)
else
  redis.call('SET', userOpKey, userOpPayload)
end

redis.call('SADD', userDocClientsKey, clientId)
redis.call('SADD', userGlobalKeysKey, userRowKey)
redis.call('XADD', streamKey, '*', 'type', streamType, 'payload', streamPayload, 'enqueuedAt', enqueuedAt)

return expectedSeq + 1
`;

const client = createRedisConnection('set-cell-atomic-commit');
let initPromise = null;
let closePromise = null;
let isClosing = false;

function toCachedDocView(docRecord) {
  return {
    docId: docRecord.docId,
    title: docRecord.title,
    currentSeq: docRecord.currentSeq,
    createdBy: docRecord.createdBy,
    createdAt: docRecord.createdAt,
    updatedAt: docRecord.updatedAt || new Date().toISOString(),
    snapshot: docRecord.snapshotJson,
  };
}

async function ensureReady() {
  if (isClosing) {
    return;
  }

  if (!initPromise) {
    initPromise = client.connect().catch((error) => {
      initPromise = null;
      throw error;
    });
  }

  await initPromise;
}

async function commitSetCellAtomically({
  expectedSeq,
  updatedRecord,
  historyEntry,
  userOpState,
  persistMessage,
}) {
  await ensureReady();

  if (isClosing || !client.isOpen) {
    throw new Error('REDIS_ATOMIC_COMMIT_UNAVAILABLE');
  }

  const runtimeState = createUserOpState(userOpState);
  const userOpKey = createUserOpStateRedisStore.getDocClientKey(runtimeState.docId, runtimeState.clientId);
  const userDocClientsKey = createUserOpStateRedisStore.getDocClientsKey(runtimeState.docId);
  const userGlobalKeysKey = createUserOpStateRedisStore.getGlobalDocClientsKey();

  return client.eval(LUA_COMMIT_SET_CELL, {
    keys: [
      docSeqKey(updatedRecord.docId),
      docSnapshotKey(updatedRecord.docId),
      histEntryKey(historyEntry.docId, historyEntry.seq),
      userOpKey,
      userDocClientsKey,
      userGlobalKeysKey,
      STREAM_KEY,
    ],
    arguments: [
      String(expectedSeq),
      JSON.stringify({ currentSeq: updatedRecord.currentSeq }),
      JSON.stringify(toCachedDocView(updatedRecord)),
      JSON.stringify(historyEntry),
      JSON.stringify(runtimeState),
      String(cacheConfig.docSnapshotTtlMs || 0),
      String(cacheConfig.historyTtlMs || 0),
      String(createUserOpStateRedisStore.getRetentionTtlMs() || 0),
      runtimeState.clientId,
      userOpKey,
      persistMessage.type,
      JSON.stringify(persistMessage.data ?? null),
      new Date().toISOString(),
    ],
  });
}

async function close() {
  if (!closePromise) {
    closePromise = (async () => {
      isClosing = true;

      if (initPromise) {
        await initPromise.catch(() => {});
      }

      if (client.isOpen) {
        await client.quit().catch(() => client.disconnect());
      }

      if (client.isOpen) {
        await client.disconnect().catch(() => {});
      }

      initPromise = null;
    })();
  }

  await closePromise;
}

module.exports = {
  commitSetCellAtomically,
  close,
};
