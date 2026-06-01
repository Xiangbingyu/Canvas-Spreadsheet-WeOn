const { createRedisConnection } = require('../../infra/redis/client');
const { normalizeDocSnapshot } = require('../../domain/entities/doc');
const { createUserOpState } = require('../../domain/entities/userOpState');

const RUNTIME_PREFIX = 'collab:runtime:doc_realtime';

function cloneJsonValue(value) {
  if (value === undefined || value === null) {
    return null;
  }

  return JSON.parse(JSON.stringify(value));
}

function normalizeSeq(value) {
  const parsedValue = Number.parseInt(value, 10);
  return Number.isInteger(parsedValue) ? parsedValue : null;
}

function toDateTimeString(value = new Date()) {
  if (typeof value === 'string' && value) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const normalizedDate = new Date(value);
  return Number.isNaN(normalizedDate.getTime()) ? new Date().toISOString() : normalizedDate.toISOString();
}

function isUnknownCommandError(error) {
  return error && typeof error.message === 'string' && (
    error.message.includes('unknown command')
    || error.message.includes('ERR unknown command')
  );
}

function parseJsonString(value, fallback = null) {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value !== 'string') {
    return cloneJsonValue(value);
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

function createDocRealtimeRedisStore(options = {}) {
  const {
    persistentDocStore = null,
    persistentUserOpStateStore = null,
    persistentSnapshotCheckpointStore = null,
    persistentDocBarrierStore = null,
    runtimePrefix = RUNTIME_PREFIX,
  } = options;
  const client = createRedisConnection('doc-realtime-runtime');
  const docInitPromises = new Map();

  let initPromise = null;
  let closePromise = null;
  let isClosing = false;
  let jsonMode = 'unknown';

  function getStateKey(docId) {
    return `${runtimePrefix}:doc:${docId}:state`;
  }

  function getTrackedDocsKey() {
    return `${runtimePrefix}:docs`;
  }

  function getSeqKey(docId) {
    return `${runtimePrefix}:doc:${docId}:seq`;
  }

  function getOpsKey(docId) {
    return `${runtimePrefix}:doc:${docId}:ops`;
  }

  function getBarrierKey(docId) {
    return `${runtimePrefix}:doc:${docId}:barrier`;
  }

  function getUserOpStateKey(docId, clientId) {
    return `${runtimePrefix}:doc:${docId}:user-op:${clientId}`;
  }

  function getUserOpClientsKey(docId) {
    return `${runtimePrefix}:doc:${docId}:user-op-clients`;
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

  async function getJsonValue(key) {
    await ensureReady();
    if (isClosing || !client.isOpen) {
      return null;
    }

    if (jsonMode !== 'fallback') {
      try {
        const rawValue = await client.sendCommand(['JSON.GET', key, '$']);
        jsonMode = 'redisjson';
        const parsedValue = parseJsonString(rawValue, null);

        if (Array.isArray(parsedValue)) {
          return cloneJsonValue(parsedValue[0] ?? null);
        }

        return cloneJsonValue(parsedValue);
      } catch (error) {
        if (!isUnknownCommandError(error)) {
          throw error;
        }

        jsonMode = 'fallback';
      }
    }

    return parseJsonString(await client.get(key), null);
  }

  async function setJsonValue(key, value, options = {}) {
    const { onlyIfMissing = false } = options;
    const payload = JSON.stringify(value === undefined ? null : value);

    await ensureReady();
    if (isClosing || !client.isOpen) {
      return null;
    }

    if (jsonMode !== 'fallback') {
      try {
        const command = ['JSON.SET', key, '$', payload];
        if (onlyIfMissing) {
          command.push('NX');
        }

        const result = await client.sendCommand(command);
        jsonMode = 'redisjson';
        return result;
      } catch (error) {
        if (!isUnknownCommandError(error)) {
          throw error;
        }

        jsonMode = 'fallback';
      }
    }

    if (onlyIfMissing) {
      return client.set(key, payload, { NX: true });
    }

    return client.set(key, payload);
  }

  function normalizeRealtimeDoc(docId, state = {}) {
    return {
      docId,
      title: typeof state.title === 'string' && state.title.trim() ? state.title.trim() : 'Untitled',
      snapshotJson: normalizeDocSnapshot(state.snapshotJson, { docId }),
      currentSeq: Number.isInteger(state.currentSeq) ? state.currentSeq : 0,
      updatedAt: toDateTimeString(state.updatedAt),
    };
  }

  async function loadPersistentDoc(docId) {
    if (
      persistentSnapshotCheckpointStore
      && typeof persistentSnapshotCheckpointStore.getLatestByDocId === 'function'
    ) {
      const checkpoint = await persistentSnapshotCheckpointStore.getLatestByDocId(docId);
      if (checkpoint) {
        return normalizeRealtimeDoc(docId, {
          title: checkpoint.title,
          snapshotJson: checkpoint.snapshotJson,
          currentSeq: checkpoint.checkpointSeq,
          updatedAt: checkpoint.updatedAt,
        });
      }
    }

    if (!persistentDocStore || typeof persistentDocStore.getDocState !== 'function') {
      return null;
    }

    const doc = await persistentDocStore.getDocState(docId);
    if (!doc) {
      return null;
    }

    return normalizeRealtimeDoc(docId, {
      title: doc.title,
      snapshotJson: doc.snapshotJson,
      currentSeq: doc.currentSeq,
      updatedAt: doc.updatedAt,
    });
  }

  async function loadPersistentUserOpState(docId, clientId) {
    if (!persistentUserOpStateStore || typeof persistentUserOpStateStore.getState !== 'function') {
      return null;
    }

    const state = await persistentUserOpStateStore.getState(docId, clientId);
    return state ? createUserOpState(state) : null;
  }

  async function loadPersistentBarrier(docId) {
    if (!persistentDocBarrierStore || typeof persistentDocBarrierStore.getByDocId !== 'function') {
      return null;
    }

    return persistentDocBarrierStore.getByDocId(docId);
  }

  async function getCurrentSeq(docId) {
    await ensureReady();
    if (isClosing || !client.isOpen) {
      return null;
    }

    return normalizeSeq(await client.get(getSeqKey(docId)));
  }

  async function setCurrentSeq(docId, seq, options = {}) {
    const { onlyIfMissing = false } = options;
    const normalizedSeq = Number.isInteger(seq) ? seq : 0;

    await ensureReady();
    if (isClosing || !client.isOpen) {
      return null;
    }

    if (onlyIfMissing) {
      return client.set(getSeqKey(docId), String(normalizedSeq), { NX: true });
    }

    return client.set(getSeqKey(docId), String(normalizedSeq));
  }

  async function getState(docId) {
    const state = await getJsonValue(getStateKey(docId));
    if (!state) {
      return null;
    }

    const normalizedState = normalizeRealtimeDoc(docId, state);
    return normalizedState.snapshotJson;
  }

  async function setState(docId, snapshotJson, options = {}) {
    const current = await getRealtimeDoc(docId);
    return saveRealtimeDoc(docId, {
      title: current ? current.title : 'Untitled',
      snapshotJson,
      currentSeq: current ? current.currentSeq : 0,
      updatedAt: current ? current.updatedAt : new Date().toISOString(),
    }, options);
  }

  async function ensureDocLoaded(docId) {
    const existingState = await getState(docId);
    const existingSeq = await getCurrentSeq(docId);

    const existingRealtimeDoc = await getJsonValue(getStateKey(docId));

    if (existingRealtimeDoc && Number.isInteger(existingSeq)) {
      return normalizeRealtimeDoc(docId, {
        ...existingRealtimeDoc,
        currentSeq: existingSeq,
      });
    }

    if (!docInitPromises.has(docId)) {
      const initTask = (async () => {
        const persistentDoc = await loadPersistentDoc(docId);
        if (!persistentDoc) {
          return null;
        }

        await Promise.all([
          setJsonValue(getStateKey(docId), persistentDoc, { onlyIfMissing: true }),
          setCurrentSeq(docId, persistentDoc.currentSeq, { onlyIfMissing: true }),
          client.sAdd(getTrackedDocsKey(), docId),
        ]);

        const persistentBarrier = await loadPersistentBarrier(docId);
        if (persistentBarrier) {
          await setBarrier(docId, persistentBarrier);
        }

        const [loadedRealtimeDoc, loadedSeq] = await Promise.all([
          getJsonValue(getStateKey(docId)),
          getCurrentSeq(docId),
        ]);

        return normalizeRealtimeDoc(docId, {
          ...(loadedRealtimeDoc || persistentDoc),
          currentSeq: Number.isInteger(loadedSeq) ? loadedSeq : persistentDoc.currentSeq,
        });
      })().finally(() => {
        docInitPromises.delete(docId);
      });

      docInitPromises.set(docId, initTask);
    }

    return docInitPromises.get(docId);
  }

  async function getRealtimeDoc(docId) {
    const loadedDoc = await ensureDocLoaded(docId);
    if (loadedDoc) {
      return loadedDoc;
    }

    const [storedRealtimeDoc, currentSeq] = await Promise.all([
      getJsonValue(getStateKey(docId)),
      getCurrentSeq(docId),
    ]);

    if (!storedRealtimeDoc || !Number.isInteger(currentSeq)) {
      return null;
    }

    return normalizeRealtimeDoc(docId, {
      ...storedRealtimeDoc,
      currentSeq,
    });
  }

  async function saveRealtimeDoc(docId, nextState = {}, options = {}) {
    await ensureReady();
    if (isClosing || !client.isOpen) {
      return null;
    }

    const normalizedDoc = normalizeRealtimeDoc(docId, nextState);

    await Promise.all([
      setJsonValue(getStateKey(docId), normalizedDoc, options),
      setCurrentSeq(docId, normalizedDoc.currentSeq),
      client.sAdd(getTrackedDocsKey(), docId),
    ]);

    return normalizedDoc;
  }

  async function allocateNextSeq(docId) {
    await ensureDocLoaded(docId);
    await ensureReady();

    if (isClosing || !client.isOpen) {
      return null;
    }

    const nextSeq = await client.incr(getSeqKey(docId));
    return normalizeSeq(nextSeq);
  }

  async function listTrackedDocIds() {
    await ensureReady();
    if (isClosing || !client.isOpen) {
      return [];
    }

    return client.sMembers(getTrackedDocsKey());
  }

  async function getUserOpState(docId, clientId) {
    const key = getUserOpStateKey(docId, clientId);
    const storedState = await getJsonValue(key);

    if (storedState) {
      return createUserOpState({
        ...storedState,
        docId,
        clientId,
      });
    }

    const persistentState = await loadPersistentUserOpState(docId, clientId);
    if (!persistentState) {
      return null;
    }

    await setJsonValue(key, persistentState, { onlyIfMissing: true });
    await client.sAdd(getUserOpClientsKey(docId), clientId);
    return createUserOpState(persistentState);
  }

  async function saveUserOpState(state = {}) {
    const normalizedState = createUserOpState(state);

    await setJsonValue(
      getUserOpStateKey(normalizedState.docId, normalizedState.clientId),
      normalizedState
    );
    await client.sAdd(getUserOpClientsKey(normalizedState.docId), normalizedState.clientId);

    return normalizedState;
  }

  async function listTrackedUserClientIds(docId) {
    await ensureReady();
    if (isClosing || !client.isOpen) {
      return [];
    }

    return client.sMembers(getUserOpClientsKey(docId));
  }

  async function getBarrier(docId) {
    const barrier = await getJsonValue(getBarrierKey(docId));
    if (barrier) {
      return barrier;
    }

    const persistentBarrier = await loadPersistentBarrier(docId);
    if (!persistentBarrier) {
      return null;
    }

    await setBarrier(docId, persistentBarrier);
    return persistentBarrier;
  }

  async function setBarrier(docId, barrier) {
    if (barrier === undefined || barrier === null) {
      await ensureReady();
      if (isClosing || !client.isOpen) {
        return 0;
      }

      return client.del(getBarrierKey(docId));
    }

    return setJsonValue(getBarrierKey(docId), barrier);
  }

  async function appendOp(docId, op = {}) {
    await ensureDocLoaded(docId);
    await ensureReady();

    if (isClosing || !client.isOpen) {
      return null;
    }

    const payload = cloneJsonValue(op) || {};
    const fields = [
      'payload', JSON.stringify(payload),
      'type', typeof payload.opType === 'string' ? payload.opType : '',
      'seq', Number.isInteger(payload.seq) ? String(payload.seq) : '',
    ];

    await client.sAdd(getTrackedDocsKey(), docId);
    return client.sendCommand(['XADD', getOpsKey(docId), '*', ...fields]);
  }

  function parseStreamEntries(rawEntries) {
    if (!Array.isArray(rawEntries)) {
      return [];
    }

    return rawEntries.map((entry) => {
      if (!Array.isArray(entry) || entry.length < 2) {
        return null;
      }

      const [id, rawFields] = entry;
      const fields = {};

      if (Array.isArray(rawFields)) {
        for (let index = 0; index < rawFields.length; index += 2) {
          fields[rawFields[index]] = rawFields[index + 1];
        }
      }

      return {
        id,
        op: parseJsonString(fields.payload, null),
      };
    }).filter((entry) => entry && entry.op);
  }

  async function listOps(docId, options = {}) {
    const {
      afterId = null,
      count = 100,
    } = options;

    await ensureReady();
    if (isClosing || !client.isOpen) {
      return [];
    }

    const start = afterId ? `(${afterId}` : '-';
    const rawEntries = await client.sendCommand([
      'XRANGE',
      getOpsKey(docId),
      start,
      '+',
      'COUNT',
      String(count),
    ]);

    return parseStreamEntries(rawEntries);
  }

  return {
    type: 'redis',
    tableName: 'doc_realtime_runtime',
    runtimePrefix,

    async ensureDocLoaded(docId) {
      return ensureDocLoaded(docId);
    },

    async getRealtimeDoc(docId) {
      return getRealtimeDoc(docId);
    },

    async saveRealtimeDoc(docId, nextState = {}) {
      return saveRealtimeDoc(docId, nextState);
    },

    async getState(docId) {
      return getState(docId);
    },

    async setState(docId, snapshotJson, options = {}) {
      return setState(docId, snapshotJson, options);
    },

    async getCurrentSeq(docId) {
      return getCurrentSeq(docId);
    },

    async setCurrentSeq(docId, seq, options = {}) {
      return setCurrentSeq(docId, seq, options);
    },

    async allocateNextSeq(docId) {
      return allocateNextSeq(docId);
    },

    async appendOp(docId, op = {}) {
      return appendOp(docId, op);
    },

    async listTrackedDocIds() {
      return listTrackedDocIds();
    },

    async listOps(docId, options = {}) {
      return listOps(docId, options);
    },

    async getUserOpState(docId, clientId) {
      return getUserOpState(docId, clientId);
    },

    async saveUserOpState(state = {}) {
      return saveUserOpState(state);
    },

    async listTrackedUserClientIds(docId) {
      return listTrackedUserClientIds(docId);
    },

    async getBarrier(docId) {
      return getBarrier(docId);
    },

    async setBarrier(docId, barrier) {
      return setBarrier(docId, barrier);
    },

    async close() {
      if (!closePromise) {
        closePromise = (async () => {
          isClosing = true;
          docInitPromises.clear();

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
    },
  };
}

module.exports = createDocRealtimeRedisStore;
