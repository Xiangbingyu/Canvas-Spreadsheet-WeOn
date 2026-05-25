const createMemoryDocsStore = require('./memory/docsMemoryStore');

function createDocsStore() {
  // Scaffold entry: first phase only wires docs store to memory implementation.
  return createMemoryDocsStore();
}

module.exports = createDocsStore();
