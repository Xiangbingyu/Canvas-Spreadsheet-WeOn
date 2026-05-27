function createCellValueChange({ oldValue = '', newValue = '' } = {}) {
  return {
    oldValue,
    newValue,
  };
}

module.exports = {
  createCellValueChange,
};
