const { WebSocketServer } = require('ws');

const dispatchMessage = require('./dispatcher');
const wsConfig = require('../config/wsConfig');
const { validateWsMessageShape } = require('../security/wsGuard');
const { createWsSuccess, createWsError } = require('../utils/response');
const roomService = require('../service/roomService');
const { createCollabBroadcastService } = require('../service/collabBroadcastService');
const auditService = require('../audit/auditService');

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
  let resourceClosePromise = null;
  let isShuttingDown = false;

  async function closeResources() {
    if (!resourceClosePromise) {
      resourceClosePromise = Promise.all([
        collabBroadcastService.close().catch((error) => {
          console.error('collab broadcast service close failed:', error);
        }),
        roomService.closeRuntimeState().catch((error) => {
          console.error('room runtime close failed:', error);
        }),
      ]);
    }

    await resourceClosePromise;
  }

  wss.on('connection', (socket) => {
    // 每个连接分配唯一 ID，供 join 幂等控制使用
    socket._connId = ++nextConnId;

    // WebSocket 心跳：标记存活，收到 pong 后恢复
    socket._isAlive = true
    socket.on('pong', () => {
      socket._isAlive = true
    })

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

  // 心跳检测：定期 ping，无响应的死连接会被终止并触发 presence 广播
  const heartbeatMs = wsConfig.heartbeatIntervalSeconds * 1000
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((socket) => {
      if (!socket._isAlive) {
        socket.terminate()
        return
      }
      socket._isAlive = false
      socket.ping()
    })
  }, heartbeatMs)

  wss.on('close', () => {
    clearInterval(heartbeatInterval)
    void closeResources();
  });

  wss.ready = readyPromise;
  wss.shutdown = async () => {
    await readyPromise.catch(() => {});
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
