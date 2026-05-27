const { WebSocketServer } = require('ws');

const dispatchMessage = require('./dispatcher');
const wsConfig = require('../config/wsConfig');
const { validateWsMessageShape } = require('../security/wsGuard');
const { createWsSuccess, createWsError } = require('../utils/response');
const roomService = require('../service/roomService');
const presenceService = require('../service/presenceService');
const auditService = require('../service/auditService');

let nextConnId = 0;

function sendToSocket(socket, payload) {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(payload));
  }
}

function createWebSocketServer(server) {
  const wss = new WebSocketServer({
    server,
    maxPayload: wsConfig.maxPayloadBytes,
  });

  async function broadcastToRoom(docId, payload) {
    const sockets = await roomService.getRoomSockets(docId);
    for (const s of sockets) {
      sendToSocket(s, payload);
    }
  }

  wss.on('connection', (socket) => {
    // 每个连接分配唯一 ID，供 join 幂等控制使用
    socket._connId = ++nextConnId;

    socket.on('message', (rawMessage) => {
      let message;

      try {
        message = JSON.parse(rawMessage.toString());
      } catch (error) {
        sendToSocket(socket, createWsError(4000, 'Invalid JSON message'));
        return;
      }

      if (!validateWsMessageShape(message)) {
        sendToSocket(socket, createWsError(4000, 'Invalid WebSocket message'));
        return;
      }

      Promise.resolve(
        dispatchMessage({
          socket,
          message,
          reply: (payload) => sendToSocket(socket, payload),
          broadcastToRoom,
        })
      ).catch((error) => {
        console.error('WebSocket dispatch error:', error);
        sendToSocket(socket, createWsError(5000, 'Internal server error'));
      });
    });

    socket.on('close', () => {
      roomService.leaveRoom(socket).then(async (result) => {
        if (!result || !result.isFullyOffline) {
          return;
        }

        const { docId } = result;
        const { users } = await presenceService.getPresence(docId);

        await broadcastToRoom(docId, createWsSuccess('presence', { docId, users }));

        await auditService.recordOperationAudit({
          type: 'leave',
          docId,
          clientId: result.clientId,
        });
      }).catch((error) => {
        console.error('WebSocket close handler error:', error);
      });
    });

    socket.on('error', (error) => {
      console.error('WebSocket connection error:', error);
    });
  });

  return wss;
}

module.exports = {
  createWebSocketServer,
};
