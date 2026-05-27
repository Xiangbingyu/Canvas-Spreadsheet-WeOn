async function applyUndo(command) {
  // TODO: implement undo flow via historyStore and userOpStateStore.
  return {
    action: 'undo',
    command,
  };
}

async function applyRedo(command) {
  // TODO: implement redo flow via historyStore and userOpStateStore.
  return {
    action: 'redo',
    command,
  };
}

module.exports = {
  applyUndo,
  applyRedo,
};
