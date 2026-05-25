const { WebSocketServer } = require('ws');

const dispatchMessage = require('./dispatcher');
const { createWsError } = require('../utils/response');

function sendToSocket(socket, payload) {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(payload));
  }
}

function createWebSocketServer(server) {
  const wss = new WebSocketServer({ server });

  function broadcastToRoom(docId, payload) {
    // TODO: read room sockets from roomSocketsStore and broadcast payload.
    return { docId, payload };
  }

  wss.on('connection', (socket) => {
    socket.on('message', (rawMessage) => {
      let message;

      try {
        message = JSON.parse(rawMessage.toString());
      } catch (error) {
        sendToSocket(socket, createWsError(4000, 'Invalid JSON message'));
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
      // TODO: remove socket from runtime room state and broadcast latest presence.
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
