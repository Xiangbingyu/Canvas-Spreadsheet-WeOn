const wsConfig = {
  maxPayloadBytes: Number(process.env.WS_MAX_PAYLOAD_BYTES || 1024 * 1024),
};

module.exports = wsConfig;
