const { normalizeDocSnapshot } = require('../../domain/entities/doc');
const { createUserOpState } = require('../../domain/entities/userOpState');

const DEFAULT_RUNTIME_PREFIX = 'collab:runtime:doc_realtime';

function cloneJsonValue(value) {
  if (value === undefined || value === null) {
    return null;
  }

  return JSON.parse(JSON.stringify(value));
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

function normalizeRealtimeDoc(docId, state = {}) {
  return {
    docId,
    title: typeof state.title === 'string' && state.title.trim() ? state.title.trim() : 'Untitled',
    snapshotJson: normalizeDocSnapshot(state.snapshotJson, { docId }),
    currentSeq: Number.isInteger(state.currentSeq) ? state.currentSeq : 0,
    updatedAt: toDateTimeString(state.updatedAt),
  };
}

function createDocRealtimeMemoryStore(options = {}) {
  const {
    persistentDocStore = null,
    persistentUserOpStateStore = null,
    persistentSnapshotCheckpointStore = null,
    persistentDocBarrierStore = null,
    runtimePrefix = DEFAULT_RUNTIME_PREFIX,
  } = options;
  const docsById = new Map();
  const userOpStateByKey = new Map();
  const userOpClientsByDocId = new Map();
  const barriersByDocId = new Map();
  const opsByDocId = new Map();
  const opCountersByDocId = new Map();

  function getUserStateKey(docId, clientId) {
    return `${docId}:${clientId}`;
  }

  function trackUserClientId(docId, clientId) {
    if (!userOpClientsByDocId.has(docId)) {
      userOpClientsByDocId.set(docId, new Set());
    }

    userOpClientsByDocId.get(docId).add(clientId);
  }

  async function ensureDocLoaded(docId) {
    if (docsById.has(docId)) {
      return cloneJsonValue(docsById.get(docId));
    }

    if (
      persistentSnapshotCheckpointStore
      && typeof persistentSnapshotCheckpointStore.getLatestByDocId === 'function'
    ) {
      const checkpoint = await persistentSnapshotCheckpointStore.getLatestByDocId(docId);
      if (checkpoint) {
        const normalizedDoc = normalizeRealtimeDoc(docId, {
          title: checkpoint.title,
          snapshotJson: checkpoint.snapshotJson,
          currentSeq: checkpoint.checkpointSeq,
          updatedAt: checkpoint.updatedAt,
        });
        docsById.set(docId, normalizedDoc);

        if (persistentDocBarrierStore && typeof persistentDocBarrierStore.getByDocId === 'function') {
          const barrier = await persistentDocBarrierStore.getByDocId(docId);
          if (barrier) {
            barriersByDocId.set(docId, cloneJsonValue(barrier));
          }
        }

        return cloneJsonValue(normalizedDoc);
      }
    }

    if (!persistentDocStore || typeof persistentDocStore.getDocState !== 'function') {
      return null;
    }

    const doc = await persistentDocStore.getDocState(docId);
    if (!doc) {
      return null;
    }

    const normalizedDoc = normalizeRealtimeDoc(docId, {
      title: doc.title,
      snapshotJson: doc.snapshotJson,
      currentSeq: doc.currentSeq,
      updatedAt: doc.updatedAt,
    });
    docsById.set(docId, normalizedDoc);

    if (persistentDocBarrierStore && typeof persistentDocBarrierStore.getByDocId === 'function') {
      const barrier = await persistentDocBarrierStore.getByDocId(docId);
      if (barrier) {
        barriersByDocId.set(docId, cloneJsonValue(barrier));
      }
    }

    return cloneJsonValue(normalizedDoc);
  }

  function getStoredOps(docId) {
    if (!opsByDocId.has(docId)) {
      opsByDocId.set(docId, []);
    }

    return opsByDocId.get(docId);
  }

  return {
    type: 'memory',
    tableName: 'doc_realtime_runtime_memory',
    runtimePrefix,

    async ensureDocLoaded(docId) {
      return ensureDocLoaded(docId);
    },

    async getRealtimeDoc(docId) {
      const loadedDoc = await ensureDocLoaded(docId);
      return loadedDoc ? cloneJsonValue(loadedDoc) : null;
    },

    async saveRealtimeDoc(docId, nextState = {}) {
      const normalizedDoc = normalizeRealtimeDoc(docId, nextState);
      docsById.set(docId, normalizedDoc);
      return cloneJsonValue(normalizedDoc);
    },

    async getState(docId) {
      const doc = await ensureDocLoaded(docId);
      return doc ? cloneJsonValue(doc.snapshotJson) : null;
    },

    async setState(docId, snapshotJson) {
      const current = await ensureDocLoaded(docId);
      const nextDoc = normalizeRealtimeDoc(docId, {
        title: current ? current.title : 'Untitled',
        snapshotJson,
        currentSeq: current ? current.currentSeq : 0,
        updatedAt: current ? current.updatedAt : new Date().toISOString(),
      });
      docsById.set(docId, nextDoc);
      return 'OK';
    },

    async getCurrentSeq(docId) {
      const doc = await ensureDocLoaded(docId);
      return doc ? doc.currentSeq : null;
    },

    async setCurrentSeq(docId, seq, options = {}) {
      const current = await ensureDocLoaded(docId);

      if (options.onlyIfMissing && current && Number.isInteger(current.currentSeq)) {
        return null;
      }

      const nextDoc = normalizeRealtimeDoc(docId, {
        title: current ? current.title : 'Untitled',
        snapshotJson: current ? current.snapshotJson : null,
        currentSeq: seq,
        updatedAt: current ? current.updatedAt : new Date().toISOString(),
      });
      docsById.set(docId, nextDoc);
      return 'OK';
    },

    async allocateNextSeq(docId) {
      const current = await ensureDocLoaded(docId);
      const nextSeq = (current ? current.currentSeq : 0) + 1;
      await this.setCurrentSeq(docId, nextSeq);
      return nextSeq;
    },

    async appendOp(docId, op = {}) {
      const nextCounter = (opCountersByDocId.get(docId) || 0) + 1;
      opCountersByDocId.set(docId, nextCounter);

      const id = `${nextCounter}-0`;
      getStoredOps(docId).push({
        id,
        op: cloneJsonValue(op) || {},
      });
      return id;
    },

    async listTrackedDocIds() {
      return Array.from(docsById.keys());
    },

    async listOps(docId, options = {}) {
      const { afterId = null, count = 100 } = options;
      const entries = getStoredOps(docId);
      const startIndex = afterId
        ? entries.findIndex((entry) => entry.id === afterId) + 1
        : 0;

      return entries
        .slice(startIndex < 0 ? 0 : startIndex, (startIndex < 0 ? 0 : startIndex) + count)
        .map((entry) => cloneJsonValue(entry));
    },

    async getUserOpState(docId, clientId) {
      const userStateKey = getUserStateKey(docId, clientId);

      if (userOpStateByKey.has(userStateKey)) {
        return createUserOpState(userOpStateByKey.get(userStateKey));
      }

      if (!persistentUserOpStateStore || typeof persistentUserOpStateStore.getState !== 'function') {
        return null;
      }

      const state = await persistentUserOpStateStore.getState(docId, clientId);
      if (!state) {
        return null;
      }

      const normalizedState = createUserOpState(state);
      userOpStateByKey.set(userStateKey, normalizedState);
      trackUserClientId(docId, clientId);
      return createUserOpState(normalizedState);
    },

    async saveUserOpState(state = {}) {
      const normalizedState = createUserOpState(state);
      trackUserClientId(normalizedState.docId, normalizedState.clientId);
      userOpStateByKey.set(
        getUserStateKey(normalizedState.docId, normalizedState.clientId),
        normalizedState
      );
      return createUserOpState(normalizedState);
    },

    async listTrackedUserClientIds(docId) {
      return Array.from(userOpClientsByDocId.get(docId) || []);
    },

    async getBarrier(docId) {
      if (barriersByDocId.has(docId)) {
        return cloneJsonValue(barriersByDocId.get(docId));
      }

      if (persistentDocBarrierStore && typeof persistentDocBarrierStore.getByDocId === 'function') {
        const barrier = await persistentDocBarrierStore.getByDocId(docId);
        if (barrier) {
          barriersByDocId.set(docId, cloneJsonValue(barrier));
          return cloneJsonValue(barrier);
        }
      }

      return null;
    },

    async setBarrier(docId, barrier) {
      if (barrier === undefined || barrier === null) {
        barriersByDocId.delete(docId);
        return 1;
      }

      barriersByDocId.set(docId, cloneJsonValue(barrier));
      return 'OK';
    },

    async close() {
      docsById.clear();
      userOpStateByKey.clear();
      barriersByDocId.clear();
      opsByDocId.clear();
      opCountersByDocId.clear();
      userOpClientsByDocId.clear();
    },
  };
}

module.exports = createDocRealtimeMemoryStore;
