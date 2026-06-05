const wsConfig = {
  maxPayloadBytes: Number(process.env.WS_MAX_PAYLOAD_BYTES || 1024 * 1024),
  /** WebSocket 心跳间隔（秒），用于检测 DevTools Offline / 断网导致的死连接 */
  heartbeatIntervalSeconds: Number(process.env.WS_HEARTBEAT_SECONDS || 30),
};

module.exports = wsConfig;
