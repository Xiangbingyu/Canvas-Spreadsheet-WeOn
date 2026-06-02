// cursor 不分配 seq、不写 stream、不写 history、不写 audit。
// 统一纳入 Gate 架构治理，持久化链路不经过此处。

function buildCursorBroadcast(message) {
  return {
    docId: message.docId,
    clientId: message.clientId,
    row: message.row,
    col: message.col,
  };
}

module.exports = { buildCursorBroadcast };
