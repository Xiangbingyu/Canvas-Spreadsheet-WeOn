function createId(prefix = 'id') {
  return `${prefix}_${Date.now()}`;
}

module.exports = {
  createId,
};
