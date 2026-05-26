const auditRecorder = require('../audit/auditService');

function recordOperationAudit(event) {
  return auditRecorder.recordAuditEvent(event);
}

module.exports = {
  recordOperationAudit,
};
