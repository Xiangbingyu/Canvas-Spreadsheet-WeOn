function createMemoryDocsStore() {
  // docs: Map<docId, SheetDoc>
  // SheetDoc fields:
  // - docId: business document id
  // - title: display title
  // - snapshot: current sheet snapshot { cells, styles, rowCount, colCount }
  // - seq: latest server sequence
  // - createdAt / updatedAt: timestamps
  // - history: in-memory history entries for future undo/redo
  // Future database mapping:
  // - docs current state -> sheet_docs
  // - docs.history -> sheet_doc_history
  const docs = new Map();
  let docCounter = 0;

  function nextDocId() {
    docCounter += 1;
    return `doc_${String(docCounter).padStart(3, '0')}`;
  }

  return {
    type: 'memory',
    docs,

    async createDoc() {
      // TODO: create a full SheetDoc and write it into docs.
      return {
        docId: nextDocId(),
      };
    },

    async getDocState(docId) {
      // TODO: return the current document snapshot, seq and history.
      return docs.get(docId) || null;
    },

    async applySetCell(command) {
      // TODO: apply cell update to docs and append history entry.
      return {
        docId: command.docId,
        clientId: command.clientId,
        row: command.row,
        col: command.col,
        value: command.value ?? '',
      };
    },

    async applyImportSheet(command) {
      // TODO: replace snapshot in docs and append history entry.
      return {
        docId: command.docId,
        clientId: command.clientId,
        snapshot: command.snapshot ?? null,
      };
    },
  };
}

module.exports = createMemoryDocsStore;
