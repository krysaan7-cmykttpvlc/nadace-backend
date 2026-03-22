const prisma = require('../prisma');

async function logAudit({ userId, adminId, action, entity, entityId, details, ipAddress }) {
  return prisma.auditLog.create({
    data: { userId, adminId, action, entity, entityId, details, ipAddress }
  });
}

module.exports = { logAudit };
