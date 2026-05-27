const docStore = require('../store/docStore');

async function applyImportSheet(command) {
  // TODO: centralize import_sheet flow, including idempotency, history, audit, and cache updates.
  return docStore.applyImportSheet(command);
}

module.exports = {
  applyImportSheet,
};


