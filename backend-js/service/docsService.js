const docStore = require('../store/docStore');

async function createDoc() {
  // TODO: orchestrate create-doc flow via docStore and domain objects.
  return docStore.createDoc();
}

async function getDocState(docId) {
  // TODO: validate docId and return current document state.
  return docStore.getDocState(docId);
}

async function applySetCell(command) {
  // TODO: add seq allocation, history append, idempotency, and cache updates.
  return docStore.applySetCell(command);
}

async function applyImportSheet(command) {
  // TODO: add snapshot replacement flow, history append, and cache updates.
  return docStore.applyImportSheet(command);
}

module.exports = {
  createDoc,
  getDocState,
  applySetCell,
  applyImportSheet,
};


