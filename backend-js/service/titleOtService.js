const { ERROR_CODES } = require('../protocol/errorCodes');
const { normalizeBaseSeq } = require('./cellOtService');

function createServiceError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

async function rebaseSetTitleCommand({
  command,
  currentDoc,
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
  rebaseSetTitleCommand,
};
