const collabConfig = {
  historyLimit: Number(process.env.HISTORY_LIMIT || 20),
  userOpStackLimit: Number(process.env.USER_OP_STACK_LIMIT || 100),
  userOpStateTtlMs: Number(process.env.USER_OP_STATE_TTL_MS || 30 * 60 * 1000),
  enableIdempotency: process.env.ENABLE_IDEMPOTENCY !== 'false',
};

module.exports = collabConfig;
