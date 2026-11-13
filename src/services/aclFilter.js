const { identityFromUser } = require('../lib/ids');

/**
 * ACL clause for Atlas $vectorSearch.filter.
 * Built only from verified JWT identity. Returns null so callers fail closed.
 *
 * Atlas pre-filters support $and / $or / $in / equality. Empty $in is omitted
 * because it would match nothing and could drop legitimate tenant-wide hits.
 */
function buildAclFilter(user) {
  const identity = identityFromUser(user);
  if (!identity) return null;

  const { tenantId, userId, role, groups } = identity;

  const or = [
    { 'acl.visibility': { $in: ['tenant'] } },
    { 'acl.allowedRoles': { $in: [role] } },
    { 'acl.allowedUsers': { $in: [userId] } },
  ];

  if (groups.length > 0) {
    or.push({ 'acl.allowedGroups': { $in: groups } });
  }

  return {
    $and: [{ tenantId: { $eq: tenantId } }, { $or: or }],
  };
}

function buildDocumentAclQuery(user) {
  return buildAclFilter(user);
}

module.exports = { buildAclFilter, buildDocumentAclQuery };
