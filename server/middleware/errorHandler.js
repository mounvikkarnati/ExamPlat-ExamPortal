/** 404 handler for unknown routes. */
function notFound(req, res, next) {
  res.status(404).json({ success: false, error: 'not-found', message: `Route ${req.method} ${req.originalUrl} not found.` });
}

/** Central error handler - never leaks stack traces. */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  console.error('[error]', err);
  const status = err.status || 500;
  const message = status === 500 ? 'Internal server error. Please try again later.' : err.message;
  return res.status(status).json({ success: false, error: 'server', message });
}

module.exports = { notFound, errorHandler };