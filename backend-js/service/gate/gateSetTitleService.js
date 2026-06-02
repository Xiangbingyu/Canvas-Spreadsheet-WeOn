const { ERROR_CODES } = require('../../protocol/errorCodes');
const docsService = require('../docsService');
const { rebaseSetTitleCommand } = require('../titleOtService');

function createServiceError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

// Gate 路径：读 Redis 状态 → rebase → 计算 nextSnapshot（仅改 title）→ Lua 原子提交。
// 返回 { seq, oldTitle, rebaseResult }
async function commitSetTitle(normalizedCommand) {
  const currentDoc = await docsService.getDocStateForWrite(normalizedCommand.docId);
  if (!currentDoc) {
    throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedCommand.docId}`);
  }

  const otResult = await rebaseSetTitleCommand({ command: normalizedCommand, currentDoc });
  const rebaseResult = otResult.rebaseResult;

  const oldTitle = currentDoc.snapshotJson && currentDoc.snapshotJson.title != null
    ? currentDoc.snapshotJson.title
    : null;

  const nextSnapshot = {
    ...JSON.parse(JSON.stringify(currentDoc.snapshotJson || {})),
    title: normalizedCommand.title,
  };

  const event = {
    opType: 'set_title',
    oldValueJson: { title: oldTitle },
    newValueJson: { title: normalizedCommand.title },
    clientId: normalizedCommand.clientId,
    baseSeq: rebaseResult.baseSeq,
  };

  const commitResult = await docsService.commitRealtimeOp(normalizedCommand.docId, {
    expectedBaseSeq: rebaseResult.baseSeq,
    snapshotJson: nextSnapshot,
    event,
  });

  if (!commitResult.ok) {
    throw createServiceError(ERROR_CODES.CONFLICT, 'concurrent modification, please retry', {
      docId: normalizedCommand.docId, currentSeq: commitResult.currentSeq,
    });
  }

  return { seq: commitResult.seq, oldTitle, rebaseResult };
}

module.exports = { commitSetTitle };
