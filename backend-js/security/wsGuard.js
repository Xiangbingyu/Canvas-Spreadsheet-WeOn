function validateWsMessageShape(message) {
  // TODO: centralize WebSocket message validation and size checks.
  return !!message && typeof message === 'object' && !Array.isArray(message);
}

module.exports = {
  validateWsMessageShape,
};
