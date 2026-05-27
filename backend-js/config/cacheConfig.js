const cacheConfig = {
  docsTtlMs: Number(process.env.DOCS_CACHE_TTL_MS || 30000),
  historyTtlMs: Number(process.env.HISTORY_CACHE_TTL_MS || 30000),
  userOpStateTtlMs: Number(process.env.USER_OP_STATE_CACHE_TTL_MS || 30000),
  docsMaxEntries: Number(process.env.DOCS_CACHE_MAX_ENTRIES || 1000),
  historyMaxEntries: Number(process.env.HISTORY_CACHE_MAX_ENTRIES || 1000),
  userOpStateMaxEntries: Number(process.env.USER_OP_STATE_CACHE_MAX_ENTRIES || 1000),
};

module.exports = cacheConfig;
