const mongoose = require('mongoose');

// Convert JWT strings to ObjectId in ONE place so filters never mix types.
function toObjectId(value) {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (!mongoose.Types.ObjectId.isValid(value)) return null;
  return new mongoose.Types.ObjectId(value);
}

// Fail closed: missing/malformed identity means no query is allowed.
function identityFromUser(user) {
  if (!user) return null;
  const tenantId = toObjectId(user.tenantId);
  const userId = toObjectId(user.userId);
  if (!tenantId || !userId || typeof user.role !== 'string' || !user.role) return null;
  return {
    tenantId,
    userId,
    role: user.role,
    groups: Array.isArray(user.groups) ? user.groups.filter((g) => typeof g === 'string') : [],
  };
}

module.exports = { toObjectId, identityFromUser };
