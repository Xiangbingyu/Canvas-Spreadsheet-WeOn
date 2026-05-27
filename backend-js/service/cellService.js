const docStore = require('../store/docStore');

async function applySetCell(command) {
  // TODO: centralize set_cell flow, including history, audit, and cache updates.
  return docStore.applySetCell(command);
}

module.exports = {
  applySetCell,
};


