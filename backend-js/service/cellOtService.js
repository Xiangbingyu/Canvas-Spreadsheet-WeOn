const { ERROR_CODES } = require('../protocol/errorCodes');

function createServiceError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function isValidBaseSeq(value) {
  return Number.isInteger(value) && value >= 0;
}

function normalizeBaseSeq(baseSeq) {
  return isValidBaseSeq(baseSeq) ? baseSeq : null;
}

function shouldTreatAsOtBarrier(historyEntry) {
  return historyEntry && historyEntry.opType === 'import_sheet';
}

async function rebaseSetCellCommand({
  command,
  currentDoc,
  historyStore,
  connection = null,
}) {
  const normalizedBaseSeq = normalizeBaseSeq(command.baseSeq);

  if (normalizedBaseSeq === null) {
    return {
      command: {
        ...command,
        baseSeq: null,
      },
      rebaseResult: {
        enabled: false,
        rebased: false,
        baseSeq: null,
        conflictSeq: null,
      },
    };
  }

  if (normalizedBaseSeq > currentDoc.currentSeq) {
    throw createServiceError(ERROR_CODES.CONFLICT, 'baseSeq is ahead of current document version', {
      docId: command.docId,
      baseSeq: normalizedBaseSeq,
      currentSeq: currentDoc.currentSeq,
    });
  }

  if (normalizedBaseSeq === currentDoc.currentSeq) {
    return {
      command: {
        ...command,
        baseSeq: normalizedBaseSeq,
      },
      rebaseResult: {
        enabled: true,
        rebased: false,
        baseSeq: normalizedBaseSeq,
        conflictSeq: null,
      },
    };
  }

  const historyEntries = await historyStore.listByDocIdSeqRange(
    command.docId,
    normalizedBaseSeq,
    currentDoc.currentSeq,
    { connection }
  );
  const barrierEntry = historyEntries.find((entry) => shouldTreatAsOtBarrier(entry));

  if (barrierEntry) {
    throw createServiceError(ERROR_CODES.CONFLICT, 'document changed by import_sheet, please refresh and retry', {
      docId: command.docId,
      baseSeq: normalizedBaseSeq,
      currentSeq: currentDoc.currentSeq,
      conflictSeq: barrierEntry.seq,
      conflictOpType: barrierEntry.opType,
    });
  }

  return {
    command: {
      ...command,
      baseSeq: normalizedBaseSeq,
    },
    rebaseResult: {
      enabled: true,
      rebased: true,
      baseSeq: normalizedBaseSeq,
      conflictSeq: null,
    },
  };
}

module.exports = {
  normalizeBaseSeq,
  shouldTreatAsOtBarrier,
  rebaseSetCellCommand,
};
