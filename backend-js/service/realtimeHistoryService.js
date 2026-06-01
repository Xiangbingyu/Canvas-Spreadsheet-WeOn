const historyStore = require('../store/historyStore');
const docRealtimeService = require('./docRealtimeService');
const { createHistory } = require('../domain/entities/history');

function deduplicateBySeq(entries = []) {
  const map = new Map();

  for (const entry of entries) {
    if (!entry || !Number.isInteger(entry.seq)) {
      continue;
    }

    map.set(entry.seq, entry);
  }

  return Array.from(map.values()).sort((left, right) => left.seq - right.seq);
}

function hasCompleteSeqCoverage(entries = [], startExclusiveSeq, endInclusiveSeq) {
  const expectedCount = endInclusiveSeq - startExclusiveSeq;

  if (expectedCount <= 0) {
    return true;
  }

  if (entries.length !== expectedCount) {
    return false;
  }

  for (let index = 0; index < entries.length; index += 1) {
    if (entries[index].seq !== startExclusiveSeq + index + 1) {
      return false;
    }
  }

  return true;
}

async function listRealtimeEntriesByDocIdSeqRange(
  realtimeDocStateService,
  docId,
  startExclusiveSeq,
  endInclusiveSeq
) {
  const realtimeEntries = [];
  let afterId = null;

  while (true) {
    const streamEntries = await realtimeDocStateService.listOps(docId, {
      afterId,
      count: 100,
    });

    if (!streamEntries.length) {
      break;
    }

    for (const entry of streamEntries) {
      const historyEntry = createHistory(entry.op);

      if (historyEntry.seq > endInclusiveSeq) {
        return realtimeEntries;
      }

      if (historyEntry.seq > startExclusiveSeq && historyEntry.seq <= endInclusiveSeq) {
        realtimeEntries.push(historyEntry);
      }
    }

    afterId = streamEntries[streamEntries.length - 1].id;
  }

  return realtimeEntries;
}

async function listRealtimeHistoryByDocIdSeqRange(
  docId,
  startExclusiveSeq,
  endInclusiveSeq,
  options = {}
) {
  const {
    persistedHistoryStore = historyStore,
    realtimeDocStateService = docRealtimeService,
  } = options;
  const realtimeEntries = deduplicateBySeq(
    await listRealtimeEntriesByDocIdSeqRange(
      realtimeDocStateService,
      docId,
      startExclusiveSeq,
      endInclusiveSeq
    )
  );

  if (hasCompleteSeqCoverage(realtimeEntries, startExclusiveSeq, endInclusiveSeq)) {
    return realtimeEntries;
  }

  const persistedEntries = await persistedHistoryStore.listByDocIdSeqRange(
    docId,
    startExclusiveSeq,
    endInclusiveSeq
  );

  return deduplicateBySeq([...persistedEntries, ...realtimeEntries]);
}

function createRealtimeHistoryStore(options = {}) {
  return {
    async listByDocIdSeqRange(docId, startExclusiveSeq, endInclusiveSeq) {
      return listRealtimeHistoryByDocIdSeqRange(
        docId,
        startExclusiveSeq,
        endInclusiveSeq,
        options
      );
    },
  };
}

module.exports = {
  hasCompleteSeqCoverage,
  listRealtimeEntriesByDocIdSeqRange,
  listRealtimeHistoryByDocIdSeqRange,
  createRealtimeHistoryStore,
};
