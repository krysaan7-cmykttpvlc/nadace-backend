const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prisma');
const { authenticate, requireRole } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { sendInterviewInviteEmail } = require('../utils/email');
const logger = require('../utils/logger');

const router = express.Router();

// ==================== NAPLÁNOVAT POHOVOR ====================
router.post('/', authenticate, requireRole('ADMIN', 'REGISTRATION_MANAGER'), [
  body('userId').notEmpty().withMessage('ID uživatele je povinné.'),
  body('scheduledDate').isISO8601().withMessage('Neplatné datum.'),
  body('interviewerName').optional().trim(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const { userId, scheduledDate, interviewerName, notes } = req.body;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'Uživatel nenalezen.' });

    const interview = await prisma.interview.create({
      data: {
        userId,
        scheduledDate: new Date(scheduledDate),
        interviewerName: interviewerName || null,
        notes: notes || null,
      },
    });

    // Změnit stav uživatele na INVITED_FOR_INTERVIEW
    await prisma.user.update({
      where: { id: userId },
      data: { registrationStatus: 'INVITED_FOR_INTERVIEW' },
    });

    // Poslat email s termínem pohovoru
    await sendInterviewInviteEmail(user.email, user.firstName, scheduledDate, interviewerName);

    await logAudit({
      userId,
      adminId: req.user.id,
      action: 'INTERVIEW_SCHEDULED',
      entity: 'Interview',
      entityId: interview.id,
      details: `Termín: ${scheduledDate}`,
      ipAddress: req.ip,
    });

    res.status(201).json({ message: 'Pohovor naplánován a pozvánka odeslána na e-mail.', interview });
  } catch (error) {
    logger.error({ err: error }, 'Schedule interview error');
    res.status(500).json({ error: 'Chyba při plánování pohovoru.' });
  }
});

// ==================== SEZNAM POHOVORŮ ====================
router.get('/', authenticate, requireRole('ADMIN', 'REGISTRATION_MANAGER'), async (req, res) => {
  try {
    const { upcoming, userId } = req.query;
    const where = {};

    if (userId) where.userId = userId;
    if (upcoming === 'true') {
      where.scheduledDate = { gte: new Date() };
      where.result = 'PENDING';
    }

    const interviews = await prisma.interview.findMany({
      where,
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: { scheduledDate: 'asc' },
    });

    res.json(interviews);
  } catch (error) {
    logger.error({ err: error }, 'List interviews error');
    res.status(500).json({ error: 'Chyba při načítání pohovorů.' });
  }
});

// ==================== AKTUALIZACE VÝSLEDKU POHOVORU ====================
router.patch('/:id', authenticate, requireRole('ADMIN', 'REGISTRATION_MANAGER'), async (req, res) => {
  try {
    const { attended, evaluation, result, notes } = req.body;
    const validResults = ['PENDING', 'RECOMMENDED', 'NOT_RECOMMENDED', 'POSTPONED'];

    if (result && !validResults.includes(result)) {
      return res.status(400).json({ error: 'Neplatný výsledek pohovoru.' });
    }

    const interview = await prisma.interview.update({
      where: { id: req.params.id },
      data: {
        attended: attended !== undefined ? attended : undefined,
        evaluation: evaluation || undefined,
        result: result || undefined,
        notes: notes || undefined,
      },
    });

    await logAudit({
      userId: interview.userId,
      adminId: req.user.id,
      action: `INTERVIEW_UPDATED_${result || 'MODIFIED'}`,
      entity: 'Interview',
      entityId: interview.id,
      details: evaluation || null,
      ipAddress: req.ip,
    });

    res.json({ message: 'Pohovor aktualizován.', interview });
  } catch (error) {
    logger.error({ err: error }, 'Update interview error');
    res.status(500).json({ error: 'Chyba při aktualizaci pohovoru.' });
  }
});

module.exports = router;
