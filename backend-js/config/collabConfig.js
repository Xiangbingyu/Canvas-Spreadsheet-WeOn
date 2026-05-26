const collabConfig = {
  historyLimit: Number(process.env.HISTORY_LIMIT || 20),
  enableIdempotency: process.env.ENABLE_IDEMPOTENCY !== 'false',
};

module.exports = collabConfig;
