// cursor 不分配 seq、不写 stream、不写 history、不写 audit。
// 统一纳入 Gate 架构治理，持久化链路不经过此处。

function buildCursorBroadcast(message) {
  const normalizedSheetId = message.sheetId || message.sheetID || null;

  return {
    docId: message.docId,
    clientId: message.clientId,
    sheetID: normalizedSheetId,
    row: message.row,
    col: message.col,
  };
}

module.exports = { buildCursorBroadcast };
