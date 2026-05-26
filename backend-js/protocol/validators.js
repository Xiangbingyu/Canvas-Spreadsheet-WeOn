function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

module.exports = {
  isNonEmptyString,
  isPositiveInteger,
  isObject,
};
