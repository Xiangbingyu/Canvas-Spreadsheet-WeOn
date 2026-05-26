function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  deepClone,
};
