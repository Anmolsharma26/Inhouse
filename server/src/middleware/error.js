export function notFound(req, res) {
  res.status(404).json({ message: `Not found: ${req.originalUrl}` });
}

export function errorHandler(err, req, res, _next) {
  if (!err.status) console.error(err);
  let status = err.status || 500;
  let message = err.message || 'Server error';
  if (err.name === 'SequelizeUniqueConstraintError') { status = 409; message = 'That value already exists (e.g. email is taken)'; }
  else if (err.name === 'SequelizeValidationError') { status = 400; message = err.errors.map((e) => e.message).join(', '); }
  res.status(status).json({ message });
}

export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
