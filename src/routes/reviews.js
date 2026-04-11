const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prisma');
const { authenticate, requireRole } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const logger = require('../utils/logger');

const router = express.Router();

// ==================== PŘIDAT RECENZI ====================
router.post('/', authenticate, requireRole('ADMIN', 'PROJECT_REVIEWER'), [
  body('projectId').notEmpty().withMessage('ID projektu je povinné.'),
  body('overallRecommendation').isIn(['APPROVE', 'REJECT', 'NEEDS_MORE_INFO', 'POSTPONE']).withMessage('Neplatné doporučení.'),
  body('statuteCompliance').optional().isInt({ min: 1, max: 5 }),
  body('publicBenefit').optional().isInt({ min: 1, max: 5 }),
  body('feasibility').optional().isInt({ min: 1, max: 5 }),
  body('budgetAdequacy').optional().isInt({ min: 1, max: 5 }),
  body('sustainability').optional().isInt({ min: 1, max: 5 }),
  body('technicalFeasibility').optional().isInt({ min: 1, max: 5 }),
  body('conflictRisk').optional().isInt({ min: 1, max: 5 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const data = req.body;

    const project = await prisma.project.findUnique({ where: { id: data.projectId } });
    if (!project) return res.status(404).json({ error: 'Projekt nenalezen.' });

    // Aplikační uniqueness: jeden reviewer = jeden review na projekt.
    // Schema nemá @@unique (kvůli Prisma data-loss varování na Railway db push),
    // takže to ošetříme tady ručně – existující review téhož reviewera updatujeme.
    const reviewPayload = {
      statuteCompliance: data.statuteCompliance ? parseInt(data.statuteCompliance) : null,
      publicBenefit: data.publicBenefit ? parseInt(data.publicBenefit) : null,
      feasibility: data.feasibility ? parseInt(data.feasibility) : null,
      budgetAdequacy: data.budgetAdequacy ? parseInt(data.budgetAdequacy) : null,
      sustainability: data.sustainability ? parseInt(data.sustainability) : null,
      technicalFeasibility: data.technicalFeasibility ? parseInt(data.technicalFeasibility) : null,
      noPersonalGain: data.noPersonalGain !== false,
      conflictRisk: data.conflictRisk ? parseInt(data.conflictRisk) : null,
      overallRecommendation: data.overallRecommendation,
      notes: data.notes || null,
    };

    const existing = await prisma.projectReview.findFirst({
      where: { projectId: data.projectId, reviewerId: req.user.id },
      select: { id: true },
    });

    const review = existing
      ? await prisma.projectReview.update({ where: { id: existing.id }, data: reviewPayload })
      : await prisma.projectReview.create({
          data: { projectId: data.projectId, reviewerId: req.user.id, ...reviewPayload },
        });

    await logAudit({
      adminId: req.user.id,
      action: `PROJECT_REVIEWED_${data.overallRecommendation}`,
      entity: 'ProjectReview',
      entityId: review.id,
      details: `Projekt: ${project.title}`,
      ipAddress: req.ip,
    });

    res.status(201).json({ message: 'Recenze uložena.', review });
  } catch (error) {
    logger.error({ err: error }, 'Add review error');
    res.status(500).json({ error: 'Chyba při ukládání recenze.' });
  }
});

// ==================== SEZNAM RECENZÍ PROJEKTU ====================
router.get('/project/:projectId', authenticate, requireRole('ADMIN', 'PROJECT_REVIEWER'), async (req, res) => {
  try {
    const reviews = await prisma.projectReview.findMany({
      where: { projectId: req.params.projectId },
      include: { reviewer: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(reviews);
  } catch (error) {
    logger.error({ err: error }, 'List reviews error');
    res.status(500).json({ error: 'Chyba při načítání recenzí.' });
  }
});

module.exports = router;
