const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prisma');
const { authenticate, requireApproved, requireRole } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

const router = express.Router();

// ==================== PŘIDAT KOMENTÁŘ ====================
router.post('/', authenticate, requireApproved, [
  body('projectId').notEmpty().withMessage('ID projektu je povinné.'),
  body('content').trim().isLength({ min: 1, max: 2000 }).withMessage('Komentář musí mít 1-2000 znaků.'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    // Kontrola, zda uživatel nemá omezené komentáře
    if (req.user.trustLevel === 'COMMENT_RESTRICTED') {
      return res.status(403).json({ error: 'Vaše možnost komentovat byla omezena.' });
    }

    const { projectId, content } = req.body;

    // Ověření, že projekt je veřejný
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        status: { in: ['PUBLISHED_FOR_VOTING', 'VOTING_ENDED', 'RECOMMENDED_FOR_REALIZATION', 'IN_REALIZATION', 'COMPLETED'] },
      },
    });

    if (!project) {
      return res.status(404).json({ error: 'Projekt nenalezen nebo není otevřen pro komentáře.' });
    }

    const comment = await prisma.comment.create({
      data: {
        userId: req.user.id,
        projectId,
        content,
      },
      include: {
        user: { select: { firstName: true, lastName: true } },
      },
    });

    await logAudit({
      userId: req.user.id,
      action: 'COMMENT_ADDED',
      entity: 'Comment',
      entityId: comment.id,
      ipAddress: req.ip,
    });

    res.status(201).json({ message: 'Komentář přidán.', comment });
  } catch (error) {
    console.error('Add comment error:', error);
    res.status(500).json({ error: 'Chyba při přidávání komentáře.' });
  }
});

// ==================== KOMENTÁŘE K PROJEKTU ====================
router.get('/project/:projectId', async (req, res) => {
  try {
    const comments = await prisma.comment.findMany({
      where: { projectId: req.params.projectId, isHidden: false },
      include: { user: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(comments);
  } catch (error) {
    console.error('List comments error:', error);
    res.status(500).json({ error: 'Chyba při načítání komentářů.' });
  }
});

// ==================== ADMIN - VŠECHNY KOMENTÁŘE (včetně skrytých) ====================
router.get('/admin/:projectId', authenticate, requireRole('ADMIN', 'COMMENT_MODERATOR'), async (req, res) => {
  try {
    const comments = await prisma.comment.findMany({
      where: { projectId: req.params.projectId },
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(comments);
  } catch (error) {
    console.error('Admin comments error:', error);
    res.status(500).json({ error: 'Chyba při načítání komentářů.' });
  }
});

// ==================== SKRÝT/SMAZAT KOMENTÁŘ ====================
router.patch('/:id/hide', authenticate, requireRole('ADMIN', 'COMMENT_MODERATOR'), async (req, res) => {
  try {
    const { reason } = req.body;

    await prisma.comment.update({
      where: { id: req.params.id },
      data: {
        isHidden: true,
        hiddenById: req.user.id,
        hiddenReason: reason || null,
      },
    });

    await logAudit({
      adminId: req.user.id,
      action: 'COMMENT_HIDDEN',
      entity: 'Comment',
      entityId: req.params.id,
      details: reason || null,
      ipAddress: req.ip,
    });

    res.json({ message: 'Komentář byl skryt.' });
  } catch (error) {
    console.error('Hide comment error:', error);
    res.status(500).json({ error: 'Chyba při skrývání komentáře.' });
  }
});

// ==================== ODKRÝT KOMENTÁŘ ====================
router.patch('/:id/unhide', authenticate, requireRole('ADMIN', 'COMMENT_MODERATOR'), async (req, res) => {
  try {
    await prisma.comment.update({
      where: { id: req.params.id },
      data: { isHidden: false, hiddenById: null, hiddenReason: null },
    });

    res.json({ message: 'Komentář byl odkryt.' });
  } catch (error) {
    console.error('Unhide comment error:', error);
    res.status(500).json({ error: 'Chyba při odkrývání komentáře.' });
  }
});

// ==================== SMAZAT KOMENTÁŘ ====================
router.delete('/:id', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    await prisma.comment.delete({ where: { id: req.params.id } });

    await logAudit({
      adminId: req.user.id,
      action: 'COMMENT_DELETED',
      entity: 'Comment',
      entityId: req.params.id,
      ipAddress: req.ip,
    });

    res.json({ message: 'Komentář byl smazán.' });
  } catch (error) {
    console.error('Delete comment error:', error);
    res.status(500).json({ error: 'Chyba při mazání komentáře.' });
  }
});

module.exports = router;
