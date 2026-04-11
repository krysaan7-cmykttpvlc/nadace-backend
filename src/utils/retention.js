const prisma = require('../prisma');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const logger = require('./logger');

// Doby uchování (musí odpovídat /gdpr stránce na FE)
const AUDIT_LOG_RETENTION_DAYS = 365; // 12 měsíců
const REJECTED_PSEUDONYMIZE_DAYS = 180; // 6 měsíců

async function purgeOldAuditLogs() {
  const cutoff = new Date(Date.now() - AUDIT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = await prisma.auditLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  if (result.count > 0) {
    logger.info(`[retention] Smazáno ${result.count} starých audit logů (>12 měsíců).`);
  }
  return result.count;
}

async function pseudonymizeOldRejected() {
  const cutoff = new Date(Date.now() - REJECTED_PSEUDONYMIZE_DAYS * 24 * 60 * 60 * 1000);

  // Najdi zamítnuté uživatele starší než cutoff, kteří ještě nejsou pseudonymizováni
  const candidates = await prisma.user.findMany({
    where: {
      registrationStatus: 'REJECTED',
      updatedAt: { lt: cutoff },
      NOT: { email: { endsWith: '@deleted.local' } },
    },
    select: { id: true },
  });

  if (candidates.length === 0) return 0;

  for (const c of candidates) {
    const randomHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
    await prisma.user.update({
      where: { id: c.id },
      data: {
        email: `deleted-${c.id}@deleted.local`,
        passwordHash: randomHash,
        firstName: 'Smazaný',
        lastName: 'uživatel',
        phone: '',
        addressStreet: null,
        addressCity: '-',
        addressZip: null,
        emailVerifyToken: null,
        passwordResetToken: null,
        passwordResetExpires: null,
        twoFactorSecret: null,
        lastLoginIp: null,
        internalNote: 'Pseudonymizováno automaticky (GDPR retention – zamítnutá registrace > 6 měsíců).',
      },
    });
  }

  logger.info(`[retention] Pseudonymizováno ${candidates.length} starých zamítnutých registrací (>6 měsíců).`);
  return candidates.length;
}

async function runRetentionTasks() {
  try {
    await purgeOldAuditLogs();
  } catch (e) {
    logger.error({ err: e }, '[retention] Chyba při mazání audit logu');
  }
  try {
    await pseudonymizeOldRejected();
  } catch (e) {
    logger.error({ err: e }, '[retention] Chyba při pseudonymizaci');
  }
}

// Spustí retention tasks při startu a pak každých 24h.
// Jednoduchý in-process scheduler – pro Railway 1 instanci je to dost.
function startRetentionScheduler() {
  // První běh za 1 minutu po startu (aby se nezpomalil cold-start)
  setTimeout(runRetentionTasks, 60 * 1000);
  // Pak každých 24h
  setInterval(runRetentionTasks, 24 * 60 * 60 * 1000);
  logger.info('[retention] Scheduler spuštěn (běží denně).');
}

module.exports = { startRetentionScheduler, runRetentionTasks, purgeOldAuditLogs, pseudonymizeOldRejected };
