function createDocRequestKey(eventId) {
  return eventId ? `doc:${eventId}` : null;
}

function createJoinRequestKey(eventId) {
  return eventId ? `join:${eventId}` : null;
}

function createImportSheetRequestKey(eventId) {
  return eventId ? `import_sheet:${eventId}` : null;
}

module.exports = {
  createDocRequestKey,
  createJoinRequestKey,
  createImportSheetRequestKey,
};
