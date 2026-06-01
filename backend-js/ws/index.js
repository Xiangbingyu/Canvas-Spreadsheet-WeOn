const { WebSocketServer } = require('ws');

const dispatchMessage = require('./dispatcher');
const wsConfig = require('../config/wsConfig');
const { validateWsMessageShape } = require('../security/wsGuard');
const { createWsSuccess, createWsError } = require('../utils/response');
const roomService = require('../service/roomService');
const { createCollabBroadcastService } = require('../service/collabBroadcastService');
const docRealtimeService = require('../service/docRealtimeService');
const auditService = require('../audit/auditService');
const opLogFlushWorker = require('../worker/opLogFlushWorker');

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

  async function broadcastLocallyToRoom(docId, payload) {
    const sockets = await roomService.getRoomSockets(docId);
    for (const s of sockets) {
      sendToSocket(s, payload);
    }
  }

  const collabBroadcastService = createCollabBroadcastService({
    broadcastLocallyToRoom,
  });
  const readyPromise = collabBroadcastService.start().catch((error) => {
    console.error('collab broadcast service start failed:', error);
  });
  const workerReadyPromise = opLogFlushWorker.start().catch((error) => {
    console.error('op-log flush worker start failed:', error);
  });
  let resourceClosePromise = null;
  let isShuttingDown = false;

  async function closeResources() {
    if (!resourceClosePromise) {
      resourceClosePromise = Promise.all([
        collabBroadcastService.close().catch((error) => {
          console.error('collab broadcast service close failed:', error);
        }),
        opLogFlushWorker.close().catch((error) => {
          console.error('op-log flush worker close failed:', error);
        }),
        roomService.closeRuntimeState().catch((error) => {
          console.error('room runtime close failed:', error);
        }),
        docRealtimeService.closeRuntimeState().catch((error) => {
          console.error('doc realtime close failed:', error);
        }),
      ]);
    }

    await resourceClosePromise;
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
          broadcastToRoom: (docId, payload) => collabBroadcastService.broadcastToRoom(docId, payload),
        })
      ).catch((error) => {
        console.error('WebSocket dispatch error:', error);
        sendToSocket(socket, createWsError(5000, 'Internal server error'));
      });
    });

    socket.on('close', () => {
      roomService.leaveRoom(socket).then(async (result) => {
        if (!result || !result.isFullyOffline || isShuttingDown) {
          return;
        }

        const { docId } = result;
        const users = await roomService.getRoomUsers(docId);

        await collabBroadcastService.broadcastToRoom(docId, createWsSuccess('presence', { docId, users }));

        await auditService.recordAuditEvent({
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

  wss.on('close', () => {
    void closeResources();
  });

  wss.ready = readyPromise;
  wss.shutdown = async () => {
    await Promise.allSettled([readyPromise, workerReadyPromise]);
    isShuttingDown = true;

    for (const client of wss.clients) {
      if (client.readyState === 0 || client.readyState === 1) {
        client.terminate();
      }
    }

    await new Promise((resolve) => {
      wss.close(() => resolve());
    });
    await closeResources();
  };

  return wss;
}

module.exports = {
  createWebSocketServer,
};
