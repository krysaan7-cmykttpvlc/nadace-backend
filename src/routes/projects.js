const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prisma');
const { authenticate, requireApproved, requireRole } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { logAudit } = require('../utils/audit');

const router = express.Router();

// ==================== VEŘEJNÝ SEZNAM PROJEKTŮ (publikované) ====================
router.get('/public', async (req, res) => {
  try {
    const { category, status, page = 1, limit = 12 } = req.query;
    const where = {
      status: { in: ['PUBLISHED_FOR_VOTING', 'VOTING_ENDED', 'RECOMMENDED_FOR_REALIZATION', 'IN_REALIZATION', 'COMPLETED', 'ARCHIVED'] },
    };

    if (category) where.category = category;
    if (status) where.status = status;

    const [projects, total] = await Promise.all([
      prisma.project.findMany({
        where,
        select: {
          id: true, title: true, summary: true, benefitForCity: true,
          estimatedBudget: true, location: true, category: true, budgetSize: true,
          status: true, votingStartDate: true, votingEndDate: true,
          votesFor: true, votesAgainst: true, foundationComment: true,
          createdAt: true,
          attachments: { select: { id: true, originalName: true, mimeType: true } },
          author: { select: { firstName: true, lastName: true } },
          _count: { select: { comments: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
      }),
      prisma.project.count({ where }),
    ]);

    res.json({ projects, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) });
  } catch (error) {
    console.error('Public projects error:', error);
    res.status(500).json({ error: 'Chyba při načítání projektů.' });
  }
});

// ==================== VEŘEJNÝ DETAIL PROJEKTU ====================
router.get('/public/:id', async (req, res) => {
  try {
    // Check if user is authenticated (optional - to allow author to see their own project)
    let userId = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET);
        userId = decoded.userId;
      } catch {}
    }

    // First try: public statuses
    let project = await prisma.project.findFirst({
      where: {
        id: req.params.id,
        status: { in: ['PUBLISHED_FOR_VOTING', 'VOTING_ENDED', 'RECOMMENDED_FOR_REALIZATION', 'IN_REALIZATION', 'COMPLETED', 'ARCHIVED'] },
      },
      include: {
        attachments: { select: { id: true, originalName: true, mimeType: true } },
        author: { select: { id: true, firstName: true, lastName: true } },
        comments: {
          where: { isHidden: false },
          include: { user: { select: { firstName: true, lastName: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    // If not found publicly, allow the author to see their own project in any status
    if (!project && userId) {
      project = await prisma.project.findFirst({
        where: { id: req.params.id, authorId: userId },
        include: {
          attachments: { select: { id: true, originalName: true, mimeType: true } },
          author: { select: { id: true, firstName: true, lastName: true } },
          comments: {
            where: { isHidden: false },
            include: { user: { select: { firstName: true, lastName: true } } },
            orderBy: { createdAt: 'desc' },
          },
        },
      });
    }

    if (!project) return res.status(404).json({ error: 'Projekt nenalezen.' });
    res.json(project);
  } catch (error) {
    console.error('Public project detail error:', error);
    res.status(500).json({ error: 'Chyba při načítání projektu.' });
  }
});

// ==================== PODÁNÍ NÁVRHU PROJEKTU ====================
router.post('/', authenticate, requireApproved, upload.array('attachments', 10), [
  body('title').trim().notEmpty().withMessage('Název projektu je povinný.'),
  body('summary').trim().notEmpty().withMessage('Shrnutí je povinné.'),
  body('description').trim().notEmpty().withMessage('Popis je povinný.'),
  body('benefitForCity').trim().notEmpty().withMessage('Přínos pro město je povinný.'),
  body('requestedSupport').isFloat({ min: 0 }).withMessage('Požadovaná podpora musí být kladné číslo.'),
  body('realizationDate').trim().notEmpty().withMessage('Termín realizace je povinný.'),
  body('declaration').equals('true').withMessage('Čestné prohlášení je povinné.'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const data = req.body;

    const project = await prisma.project.create({
      data: {
        authorId: req.user.id,
        title: data.title,
        summary: data.summary,
        description: data.description,
        benefitForCity: data.benefitForCity,
        requestedSupport: parseFloat(data.requestedSupport),
        realizationDate: data.realizationDate,
        isLongTerm: data.isLongTerm === 'true',
        declaration: true,
        publicInterest: data.publicInterest !== 'false',
        category: data.category || 'OTHER',
        budgetSize: data.budgetSize || 'MEDIUM',
        status: 'SUBMITTED',
      },
    });

    // Uložit přílohy
    if (req.files && req.files.length > 0) {
      await prisma.attachment.createMany({
        data: req.files.map(file => ({
          projectId: project.id,
          filename: file.filename,
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          path: file.path,
        })),
      });
    }

    // Historie stavů
    await prisma.projectStatusHistory.create({
      data: {
        projectId: project.id,
        toStatus: 'SUBMITTED',
        changedBy: req.user.id,
        note: 'Projekt podán.',
      },
    });

    await logAudit({
      userId: req.user.id,
      action: 'PROJECT_SUBMITTED',
      entity: 'Project',
      entityId: project.id,
      ipAddress: req.ip,
    });

    res.status(201).json({ message: 'Projekt byl úspěšně podán.', projectId: project.id });
  } catch (error) {
    console.error('Submit project error:', error);
    res.status(500).json({ error: 'Chyba při podávání projektu.' });
  }
});

// ==================== MOJE PROJEKTY ====================
router.get('/my', authenticate, async (req, res) => {
  try {
    const projects = await prisma.project.findMany({
      where: { authorId: req.user.id },
      include: {
        attachments: { select: { id: true, originalName: true, mimeType: true } },
        _count: { select: { votes: true, comments: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(projects);
  } catch (error) {
    console.error('My projects error:', error);
    res.status(500).json({ error: 'Chyba při načítání projektů.' });
  }
});

// ==================== ADMIN - SEZNAM VŠECH PROJEKTŮ ====================
router.get('/admin', authenticate, requireRole('ADMIN', 'PROJECT_REVIEWER'), async (req, res) => {
  try {
    const { status, category, search, page = 1, limit = 20 } = req.query;
    const where = {};

    if (status) where.status = status;
    if (category) where.category = category;
    if (search) {
      where.OR = [
        { title: { contains: search } },
        { summary: { contains: search } },
      ];
    }

    const [projects, total] = await Promise.all([
      prisma.project.findMany({
        where,
        include: {
          author: { select: { id: true, firstName: true, lastName: true, email: true } },
          attachments: { select: { id: true, originalName: true, mimeType: true } },
          _count: { select: { votes: true, comments: true, reviews: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
      }),
      prisma.project.count({ where }),
    ]);

    res.json({ projects, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) });
  } catch (error) {
    console.error('Admin projects error:', error);
    res.status(500).json({ error: 'Chyba při načítání projektů.' });
  }
});

// ==================== ADMIN DETAIL PROJEKTU ====================
router.get('/admin/:id', authenticate, requireRole('ADMIN', 'PROJECT_REVIEWER'), async (req, res) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: {
        author: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        attachments: true,
        reviews: {
          include: { reviewer: { select: { firstName: true, lastName: true } } },
        },
        statusHistory: { orderBy: { createdAt: 'desc' } },
        comments: {
          include: { user: { select: { firstName: true, lastName: true } } },
          orderBy: { createdAt: 'desc' },
        },
        _count: { select: { votes: true } },
      },
    });

    if (!project) return res.status(404).json({ error: 'Projekt nenalezen.' });
    res.json(project);
  } catch (error) {
    console.error('Admin project detail error:', error);
    res.status(500).json({ error: 'Chyba při načítání projektu.' });
  }
});

// ==================== ZMĚNA STAVU PROJEKTU ====================
router.patch('/:id/status', authenticate, requireRole('ADMIN', 'PROJECT_REVIEWER'), async (req, res) => {
  try {
    const { status, note, foundationComment, votingStartDate, votingEndDate } = req.body;
    const validStatuses = [
      'SUBMITTED', 'FORMAL_REVIEW', 'WAITING_FOR_COMPLETION', 'REJECTED_UNSUITABLE',
      'SENT_FOR_INTERVIEW', 'APPROVED_FOR_PUBLICATION', 'PUBLISHED_FOR_VOTING',
      'VOTING_ENDED', 'RECOMMENDED_FOR_REALIZATION', 'POSTPONED', 'REJECTED',
      'IN_REALIZATION', 'COMPLETED', 'ARCHIVED',
    ];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Neplatný stav projektu.' });
    }

    const project = await prisma.project.findUnique({ where: { id: req.params.id } });
    if (!project) return res.status(404).json({ error: 'Projekt nenalezen.' });

    const updateData = {
      status,
      adminNote: note || undefined,
    };

    if (foundationComment) updateData.foundationComment = foundationComment;
    if (votingStartDate) updateData.votingStartDate = new Date(votingStartDate);
    if (votingEndDate) updateData.votingEndDate = new Date(votingEndDate);

    const updated = await prisma.project.update({
      where: { id: req.params.id },
      data: updateData,
    });

    await prisma.projectStatusHistory.create({
      data: {
        projectId: req.params.id,
        fromStatus: project.status,
        toStatus: status,
        changedBy: req.user.id,
        note: note || null,
      },
    });

    await logAudit({
      userId: project.authorId,
      adminId: req.user.id,
      action: `PROJECT_STATUS_CHANGED_TO_${status}`,
      entity: 'Project',
      entityId: req.params.id,
      details: note || null,
      ipAddress: req.ip,
    });

    res.json({ message: `Stav projektu změněn na ${status}.`, project: { id: updated.id, status: updated.status } });
  } catch (error) {
    console.error('Project status change error:', error);
    res.status(500).json({ error: 'Chyba při změně stavu projektu.' });
  }
});

// ==================== VYŽÁDÁNÍ DOPLNĚNÍ ====================
router.post('/:id/request-completion', authenticate, requireRole('ADMIN', 'PROJECT_REVIEWER'), async (req, res) => {
  try {
    const { message } = req.body;
    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: { author: { select: { id: true, email: true, firstName: true } } },
    });

    if (!project) return res.status(404).json({ error: 'Projekt nenalezen.' });

    await prisma.project.update({
      where: { id: req.params.id },
      data: { status: 'WAITING_FOR_COMPLETION', adminNote: message },
    });

    await prisma.projectStatusHistory.create({
      data: {
        projectId: req.params.id,
        fromStatus: project.status,
        toStatus: 'WAITING_FOR_COMPLETION',
        changedBy: req.user.id,
        note: message,
      },
    });

    // Notifikace autorovi
    await prisma.notification.create({
      data: {
        userId: project.authorId,
        type: 'PROJECT_COMPLETION_REQUESTED',
        title: 'Vyžádáno doplnění projektu',
        message: message || 'Prosíme o doplnění vašeho návrhu projektu.',
        link: `/projects/${project.id}`,
      },
    });

    res.json({ message: 'Žádost o doplnění odeslána.' });
  } catch (error) {
    console.error('Request completion error:', error);
    res.status(500).json({ error: 'Chyba při žádosti o doplnění.' });
  }
});

// ==================== ADMIN - INTERNÍ ÚDAJE PROJEKTU ====================
router.patch('/:id/internal', authenticate, requireRole('ADMIN', 'PROJECT_REVIEWER'), async (req, res) => {
  try {
    const project = await prisma.project.findUnique({ where: { id: req.params.id } });
    if (!project) return res.status(404).json({ error: 'Projekt nenalezen.' });

    const {
      targetGroup, location, estimatedBudget, implementedBy,
      operatingCosts, maintainedBy, mainRisks, previouslyDiscussed, estimatedBeneficiaries,
    } = req.body;

    const updated = await prisma.project.update({
      where: { id: req.params.id },
      data: {
        targetGroup: targetGroup || null,
        location: location || null,
        estimatedBudget: estimatedBudget ? parseFloat(estimatedBudget) : null,
        implementedBy: implementedBy || null,
        operatingCosts: operatingCosts || null,
        maintainedBy: maintainedBy || null,
        mainRisks: mainRisks || null,
        previouslyDiscussed: previouslyDiscussed || null,
        estimatedBeneficiaries: estimatedBeneficiaries ? parseInt(estimatedBeneficiaries) : null,
      },
    });

    await logAudit({
      userId: project.authorId,
      adminId: req.user.id,
      action: 'PROJECT_INTERNAL_UPDATED',
      entity: 'Project',
      entityId: req.params.id,
      ipAddress: req.ip,
    });

    res.json({ message: 'Interní údaje projektu uloženy.', project: { id: updated.id } });
  } catch (error) {
    console.error('Update project internal error:', error);
    res.status(500).json({ error: 'Chyba při ukládání interních údajů.' });
  }
});

module.exports = router;
