const auditConfig = {
  enabled: process.env.AUDIT_ENABLED !== 'false',
  maxEntries: Number(process.env.AUDIT_MAX_ENTRIES || 1000),
};

module.exports = auditConfig;
