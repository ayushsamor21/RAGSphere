const User = require('../models/User');
const { ROLES, KNOWN_GROUPS } = User;
const { toObjectId, identityFromUser } = require('../lib/ids');

function defaultAcl(identity) {
  return {
    visibility: 'restricted',
    allowedRoles: [...new Set(['admin', identity.role])],
    allowedGroups: [],
    allowedUsers: [identity.userId],
  };
}

// Client ACL is optional. Unknown roles/groups and cross-tenant user IDs are dropped.
async function sanitizeAcl(raw, user) {
  const identity = identityFromUser(user);
  if (!identity) return null;

  const base = defaultAcl(identity);
  if (!raw || typeof raw !== 'object') return base;

  const visibility = ['tenant', 'restricted', 'private'].includes(raw.visibility)
    ? raw.visibility
    : base.visibility;

  let allowedRoles = base.allowedRoles;
  if (Array.isArray(raw.allowedRoles)) {
    allowedRoles = [...new Set(raw.allowedRoles.filter((r) => ROLES.includes(r)))];
  }

  let allowedGroups = [];
  if (Array.isArray(raw.allowedGroups)) {
    allowedGroups = [
      ...new Set(raw.allowedGroups.filter((g) => typeof g === 'string' && KNOWN_GROUPS.includes(g))),
    ];
  }

  let allowedUsers = base.allowedUsers;
  if (Array.isArray(raw.allowedUsers)) {
    const ids = raw.allowedUsers.map(toObjectId).filter(Boolean);
    const found = await User.find({ _id: { $in: ids }, tenantId: identity.tenantId }).select('_id');
    allowedUsers = found.map((u) => u._id);
    if (!allowedUsers.some((id) => String(id) === String(identity.userId))) {
      allowedUsers.push(identity.userId);
    }
  }

  return { visibility, allowedRoles, allowedGroups, allowedUsers };
}

module.exports = { sanitizeAcl, defaultAcl };
