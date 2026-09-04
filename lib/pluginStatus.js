let lastError = null;

function setLastError(scope, err) {
  const message = err && err.message ? String(err.message) : String(err || 'unknown error');
  lastError = {
    scope: String(scope || 'plugin'),
    message: message.slice(0, 300),
    at: Date.now()
  };
}

function getLastError() {
  return lastError;
}

function clearLastError() {
  lastError = null;
}

module.exports = {
  setLastError,
  getLastError,
  clearLastError
};
