const roomUserStore = require('../store/roomUserStore');
const roomSocketStore = require('../store/roomSocketStore');
const userOpStateStore = require('../store/userOpStateStore');
const setCellAtomicCommit = require('../infra/redis/setCellAtomicCommit');

async function joinRoom(docId, socket, { clientId, name, color }) {
  // 先注册 socket 到新房间，同时取得前一个 (docId, clientId) 信息。
  const { previousEntry } = await roomSocketStore.addSocketToRoom(docId, socket, clientId);

  // 若 socket 之前在另一个 (docId, clientId)，视为显式 leave：
  // 检查旧身份是否还有其他活跃连接，没有则从 roomUser 中移除。
  let previousLeave = null;
  if (previousEntry) {
    const remaining = await roomSocketStore.listByDocIdAndClientId(previousEntry.docId, previousEntry.clientId);
    const activeRemaining = remaining.filter((r) => r.status === 'connected');
    const isFullyOffline = activeRemaining.length === 0;
    if (isFullyOffline) {
      await roomUserStore.removeRoomUser(previousEntry.docId, previousEntry.clientId);
      await userOpStateStore.deleteByDocIdAndClientId(previousEntry.docId, previousEntry.clientId);
    }
    previousLeave = { ...previousEntry, isFullyOffline };
  }

  // 旧身份清理完成后再检查新身份的在线状态，确保切房回来时能正确触发 isNewlyOnline。
  const existingUser = await roomUserStore.findByDocIdAndClientId(docId, clientId);
  const wasOnline = existingUser && existingUser.status === 'online';

  const roomUser = await roomUserStore.upsert({
    docId,
    clientId,
    name: typeof name === 'string' ? name : '',
    color: (typeof color === 'string' && color) ? color : '#3b82f6',
    status: 'online',
  });

  return { roomUser, isNewlyOnline: !wasOnline, previousLeave };
}

async function leaveRoom(socket) {
  const removedRow = await roomSocketStore.removeSocket(socket);

  if (!removedRow) {
    return null;
  }

  const { docId, clientId } = removedRow;
  const remainingSockets = await roomSocketStore.listByDocIdAndClientId(docId, clientId);
  const activeRemaining = remainingSockets.filter((row) => row.status === 'connected');
  const isFullyOffline = activeRemaining.length === 0;

  if (isFullyOffline) {
    await roomUserStore.removeRoomUser(docId, clientId);
    await userOpStateStore.deleteByDocIdAndClientId(docId, clientId);
  }

  return { docId, clientId, isFullyOffline };
}

async function getRoomUsers(docId) {
  return roomUserStore.getRoomUsers(docId);
}

async function getRoomSockets(docId) {
  return roomSocketStore.getRoomSockets(docId);
}

async function isSocketInRoom(docId, socket) {
  const membership = await roomSocketStore.findBySocket(socket);

  return Boolean(
    membership
    && membership.status === 'connected'
    && membership.docId === docId
  );
}

async function getSocketMembership(socket) {
  return roomSocketStore.findBySocket(socket);
}

async function closeRuntimeState() {
  if (typeof setCellAtomicCommit.close === 'function') {
    await setCellAtomicCommit.close();
  }

  if (typeof userOpStateStore.close === 'function') {
    await userOpStateStore.close();
  }

  if (typeof roomSocketStore.close === 'function') {
    await roomSocketStore.close();
  }

  if (typeof roomUserStore.close === 'function') {
    await roomUserStore.close();
  }
}

module.exports = {
  joinRoom,
  leaveRoom,
  getRoomUsers,
  getRoomSockets,
  isSocketInRoom,
  getSocketMembership,
  closeRuntimeState,
};
