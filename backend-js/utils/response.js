function createHttpSuccess(data, message = 'ok') {
  return {
    code: 0,
    message,
    data,
  };
}

function createHttpError(code, message, data = null) {
  return {
    code,
    message,
    data,
  };
}

function createWsSuccess(type, data, message = 'ok') {
  return {
    type,
    code: 0,
    message,
    data,
  };
}

function createWsError(code, message, data = null) {
  return {
    type: 'error',
    code,
    message,
    data,
  };
}

module.exports = {
  createHttpSuccess,
  createHttpError,
  createWsSuccess,
  createWsError,
};
