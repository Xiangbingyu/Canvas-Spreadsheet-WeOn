'use strict';

const realtimeConfig = require('../../config/realtimeConfig');
const { createRealtimeKeys } = require('../../infra/redis/realtimeKeys');
const { createRealtimeClient } = require('../../infra/redis/realtimeClient');

function buildDocId(number) {
  return `doc_${String(number).padStart(3, '0')}`;
}

function cloneJsonValue(value) {
  if (value === undefined || value === null) {
    return null;
  }

  return JSON.parse(JSON.stringify(value));
}

function normalizePendingDocMeta(meta = {}) {
  return {
    docId: meta.docId,
    title: meta.title,
    currentSeq: Number.isInteger(meta.currentSeq) ? meta.currentSeq : 0,
    createdBy: meta.createdBy ?? null,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  };
}

function sortByUpdatedAtDesc(records) {
  return records.sort((left, right) => {
    const leftUpdatedAt = typeof left.updatedAt === 'string' ? left.updatedAt : '';
    const rightUpdatedAt = typeof right.updatedAt === 'string' ? right.updatedAt : '';
    const updatedAtCompareResult = rightUpdatedAt.localeCompare(leftUpdatedAt);

    if (updatedAtCompareResult !== 0) {
      return updatedAtCompareResult;
    }

    return String(right.docId || '').localeCompare(String(left.docId || ''));
  });
}

function createMemoryDocPendingCreateStore() {
  const metaByDocId = new Map();
  const pendingDocIds = new Set();
  const docIdsByUserId = new Map();
  let docIdCounter = null;

  function addDocIdToUserIndex(userId, docId) {
    if (typeof userId !== 'string' || !userId.trim()) {
      return;
    }

    const normalizedUserId = userId.trim();
    if (!docIdsByUserId.has(normalizedUserId)) {
      docIdsByUserId.set(normalizedUserId, new Set());
    }
    docIdsByUserId.get(normalizedUserId).add(docId);
  }

  function removeDocIdFromUserIndex(userId, docId) {
    if (typeof userId !== 'string' || !userId.trim()) {
      return;
    }

    const normalizedUserId = userId.trim();
    const docIds = docIdsByUserId.get(normalizedUserId);
    if (!docIds) {
      return;
    }

    docIds.delete(docId);
    if (docIds.size === 0) {
      docIdsByUserId.delete(normalizedUserId);
    }
  }

  return {
    type: 'memory',

    async initializeCounter(initialValue = 0) {
      if (docIdCounter === null) {
        docIdCounter = Number.isInteger(initialValue) && initialValue > 0 ? initialValue : 0;
      }
    },

    async allocateNextDocId() {
      if (docIdCounter === null) {
        docIdCounter = 0;
      }

      docIdCounter += 1;
      return buildDocId(docIdCounter);
    },

    async savePendingDoc(meta = {}) {
      const normalizedMeta = normalizePendingDocMeta(meta);
      const previousMeta = metaByDocId.get(normalizedMeta.docId);

      if (previousMeta) {
        removeDocIdFromUserIndex(previousMeta.createdBy, previousMeta.docId);
      }

      metaByDocId.set(normalizedMeta.docId, normalizedMeta);
      pendingDocIds.add(normalizedMeta.docId);
      addDocIdToUserIndex(normalizedMeta.createdBy, normalizedMeta.docId);
      return cloneJsonValue(normalizedMeta);
    },

    async getPendingDocMeta(docId) {
      return cloneJsonValue(metaByDocId.get(docId) || null);
    },

    async listPendingDocIds() {
      return Array.from(pendingDocIds);
    },

    async listByCreatedBy(userId) {
      const docIds = Array.from(docIdsByUserId.get(userId) || []);
      return sortByUpdatedAtDesc(
        docIds
          .map((docId) => metaByDocId.get(docId) || null)
          .filter(Boolean)
          .map((meta) => cloneJsonValue(meta))
      );
    },

    async removePendingDoc(docId) {
      const meta = metaByDocId.get(docId);
      if (!meta) {
        pendingDocIds.delete(docId);
        return;
      }

      pendingDocIds.delete(docId);
      metaByDocId.delete(docId);
      removeDocIdFromUserIndex(meta.createdBy, docId);
    },

    async close() {
      metaByDocId.clear();
      pendingDocIds.clear();
      docIdsByUserId.clear();
      docIdCounter = null;
    },
  };
}

function createRedisDocPendingCreateStore() {
  const connection = createRealtimeClient('doc-pending-create');
  const keys = createRealtimeKeys();

  return {
    type: 'redis',

    async initializeCounter(initialValue = 0) {
      const client = await connection.ensureReady();
      await client.set(
        keys.docIdCounterKey(),
        String(Number.isInteger(initialValue) && initialValue > 0 ? initialValue : 0),
        { NX: true }
      );
    },

    async allocateNextDocId() {
      const client = await connection.ensureReady();
      const nextNumber = await client.incr(keys.docIdCounterKey());
      return buildDocId(nextNumber);
    },

    async savePendingDoc(meta = {}) {
      const client = await connection.ensureReady();
      const normalizedMeta = normalizePendingDocMeta(meta);
      const multi = client.multi();

      multi.set(keys.pendingMetaKey(normalizedMeta.docId), JSON.stringify(normalizedMeta));
      multi.sAdd(keys.pendingCreateSetKey(), normalizedMeta.docId);

      if (typeof normalizedMeta.createdBy === 'string' && normalizedMeta.createdBy.trim()) {
        multi.sAdd(keys.createdDocsByUserKey(normalizedMeta.createdBy.trim()), normalizedMeta.docId);
      }

      await multi.exec();
      return cloneJsonValue(normalizedMeta);
    },

    async getPendingDocMeta(docId) {
      const client = await connection.ensureReady();
      const raw = await client.get(keys.pendingMetaKey(docId));
      return raw ? JSON.parse(raw) : null;
    },

    async listPendingDocIds() {
      const client = await connection.ensureReady();
      return client.sMembers(keys.pendingCreateSetKey());
    },

    async listByCreatedBy(userId) {
      const client = await connection.ensureReady();
      if (typeof userId !== 'string' || !userId.trim()) {
        return [];
      }

      const docIds = await client.sMembers(keys.createdDocsByUserKey(userId.trim()));
      if (!docIds.length) {
        return [];
      }

      const values = await client.mGet(docIds.map((docId) => keys.pendingMetaKey(docId)));
      return sortByUpdatedAtDesc(
        values
          .filter(Boolean)
          .map((value) => JSON.parse(value))
      );
    },

    async removePendingDoc(docId) {
      const client = await connection.ensureReady();
      const existingMeta = await this.getPendingDocMeta(docId);
      const multi = client.multi();

      multi.del(keys.pendingMetaKey(docId));
      multi.sRem(keys.pendingCreateSetKey(), docId);

      if (existingMeta && typeof existingMeta.createdBy === 'string' && existingMeta.createdBy.trim()) {
        multi.sRem(keys.createdDocsByUserKey(existingMeta.createdBy.trim()), docId);
      }

      await multi.exec();
    },

    async close() {
      await connection.close();
    },
  };
}

function createDocPendingCreateStore() {
  return realtimeConfig.driver === 'redis'
    ? createRedisDocPendingCreateStore()
    : createMemoryDocPendingCreateStore();
}

module.exports = createDocPendingCreateStore();
module.exports.createMemoryDocPendingCreateStore = createMemoryDocPendingCreateStore;
module.exports.createRedisDocPendingCreateStore = createRedisDocPendingCreateStore;
