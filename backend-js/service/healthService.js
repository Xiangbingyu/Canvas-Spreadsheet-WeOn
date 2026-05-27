const appConfig = require('../config/appConfig');

function getHealthStatus() {
  return {
    status: 'ok',
    service: appConfig.serviceName,
  };
}

module.exports = {
  getHealthStatus,
};
