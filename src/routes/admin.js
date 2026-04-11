const express = require('express');
const prisma = require('../prisma');
const { authenticate, requireRole } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// ==================== DASHBOARD STATISTIKY ====================
router.get('/stats', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    const [
      totalUsers, pendingRegistrations, approvedUsers,
      totalProjects, projectsByStatus,
      totalVotes, totalComments,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { registrationStatus: 'PENDING_REVIEW' } }),
      prisma.user.count({ where: { registrationStatus: 'APPROVED' } }),
      prisma.project.count(),
      prisma.project.groupBy({ by: ['status'], _count: true }),
      prisma.vote.count(),
      prisma.comment.count(),
    ]);

    res.json({
      users: { total: totalUsers, pending: pendingRegistrations, approved: approvedUsers },
      projects: { total: totalProjects, byStatus: projectsByStatus },
      votes: totalVotes,
      comments: totalComments,
    });
  } catch (error) {
    logger.error({ err: error }, 'Stats error');
    res.status(500).json({ error: 'Chyba při načítání statistik.' });
  }
});

// ==================== AUDIT LOG ====================
router.get('/audit-log', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    const { action, entity, userId, page = 1, limit = 50 } = req.query;
    const where = {};

    if (action) where.action = { contains: action };
    if (entity) where.entity = entity;
    if (userId) where.userId = userId;

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: {
          user: { select: { firstName: true, lastName: true, email: true } },
          admin: { select: { firstName: true, lastName: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({ logs, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) });
  } catch (error) {
    logger.error({ err: error }, 'Audit log error');
    res.status(500).json({ error: 'Chyba při načítání audit logu.' });
  }
});

// ==================== EXPORT UŽIVATELŮ (JSON) ====================
router.get('/export/users', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true, email: true, firstName: true, lastName: true,
        dateOfBirth: true, addressStreet: true, addressCity: true, addressZip: true,
        phone: true, isPermanentResident: true, registrationStatus: true,
        trustLevel: true, role: true, memberSince: true,
        emailVerified: true, createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=uzivatele_export.json');
    res.json(users);
  } catch (error) {
    logger.error({ err: error }, 'Export users error');
    res.status(500).json({ error: 'Chyba při exportu.' });
  }
});

// ==================== EXPORT PROJEKTŮ (JSON) ====================
router.get('/export/projects', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    const projects = await prisma.project.findMany({
      include: {
        author: { select: { firstName: true, lastName: true, email: true } },
        _count: { select: { votes: true, comments: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=projekty_export.json');
    res.json(projects);
  } catch (error) {
    logger.error({ err: error }, 'Export projects error');
    res.status(500).json({ error: 'Chyba při exportu.' });
  }
});

// ==================== EXPORT HLASOVÁNÍ (JSON) ====================
router.get('/export/votes', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    const { projectId } = req.query;
    const where = projectId ? { projectId } : {};

    const votes = await prisma.vote.findMany({
      where,
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
        project: { select: { title: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=hlasovani_export.json');
    res.json(votes);
  } catch (error) {
    logger.error({ err: error }, 'Export votes error');
    res.status(500).json({ error: 'Chyba při exportu.' });
  }
});

// ==================== NOTIFIKACE ====================
router.get('/notifications', authenticate, async (req, res) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(notifications);
  } catch (error) {
    logger.error({ err: error }, 'Notifications error');
    res.status(500).json({ error: 'Chyba při načítání notifikací.' });
  }
});

router.patch('/notifications/:id/read', authenticate, async (req, res) => {
  try {
    await prisma.notification.update({
      where: { id: req.params.id, userId: req.user.id },
      data: { isRead: true },
    });
    res.json({ message: 'Notifikace označena jako přečtená.' });
  } catch (error) {
    logger.error({ err: error }, 'Mark notification read error');
    res.status(500).json({ error: 'Chyba.' });
  }
});

module.exports = router;
