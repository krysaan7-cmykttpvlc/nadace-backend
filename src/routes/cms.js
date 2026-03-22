const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../prisma');
const { authenticate, requireRole } = require('../middleware/auth');
const upload = require('../middleware/upload');

const router = express.Router();

// ==================== STRÁNKY ====================

// Veřejný seznam stránek
router.get('/pages', async (req, res) => {
  try {
    const pages = await prisma.page.findMany({
      where: { isPublished: true },
      select: { id: true, slug: true, title: true, sortOrder: true },
      orderBy: { sortOrder: 'asc' },
    });
    res.json(pages);
  } catch (error) {
    res.status(500).json({ error: 'Chyba při načítání stránek.' });
  }
});

// Veřejný detail stránky
router.get('/pages/:slug', async (req, res) => {
  try {
    const page = await prisma.page.findFirst({
      where: { slug: req.params.slug, isPublished: true },
    });
    if (!page) return res.status(404).json({ error: 'Stránka nenalezena.' });
    res.json(page);
  } catch (error) {
    res.status(500).json({ error: 'Chyba při načítání stránky.' });
  }
});

// Admin CRUD stránek
router.get('/pages-admin', authenticate, requireRole('ADMIN', 'CONTENT_EDITOR'), async (req, res) => {
  try {
    const pages = await prisma.page.findMany({ orderBy: { sortOrder: 'asc' } });
    res.json(pages);
  } catch (error) {
    res.status(500).json({ error: 'Chyba.' });
  }
});

router.post('/pages-admin', authenticate, requireRole('ADMIN', 'CONTENT_EDITOR'), [
  body('slug').trim().notEmpty(),
  body('title').trim().notEmpty(),
  body('content').trim().notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const page = await prisma.page.create({ data: req.body });
    res.status(201).json(page);
  } catch (error) {
    res.status(500).json({ error: 'Chyba při vytváření stránky.' });
  }
});

router.put('/pages-admin/:id', authenticate, requireRole('ADMIN', 'CONTENT_EDITOR'), async (req, res) => {
  try {
    const page = await prisma.page.update({ where: { id: req.params.id }, data: req.body });
    res.json(page);
  } catch (error) {
    res.status(500).json({ error: 'Chyba při aktualizaci stránky.' });
  }
});

router.delete('/pages-admin/:id', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    await prisma.page.delete({ where: { id: req.params.id } });
    res.json({ message: 'Stránka smazána.' });
  } catch (error) {
    res.status(500).json({ error: 'Chyba při mazání stránky.' });
  }
});

// ==================== DOKUMENTY ====================

router.get('/documents', async (req, res) => {
  try {
    const { category } = req.query;
    const where = { isPublished: true };
    if (category) where.category = category;

    const documents = await prisma.document.findMany({
      where,
      select: { id: true, title: true, description: true, originalName: true, mimeType: true, size: true, category: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(documents);
  } catch (error) {
    res.status(500).json({ error: 'Chyba při načítání dokumentů.' });
  }
});

router.get('/documents/:id/download', async (req, res) => {
  try {
    const doc = await prisma.document.findFirst({ where: { id: req.params.id, isPublished: true } });
    if (!doc) return res.status(404).json({ error: 'Dokument nenalezen.' });
    res.download(doc.path, doc.originalName);
  } catch (error) {
    res.status(500).json({ error: 'Chyba při stahování.' });
  }
});

router.post('/documents-admin', authenticate, requireRole('ADMIN', 'CONTENT_EDITOR'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Soubor je povinný.' });

    const doc = await prisma.document.create({
      data: {
        title: req.body.title,
        description: req.body.description || null,
        filename: req.file.filename,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        path: req.file.path,
        category: req.body.category || 'OTHER',
        isPublished: req.body.isPublished === 'true',
      },
    });
    res.status(201).json(doc);
  } catch (error) {
    res.status(500).json({ error: 'Chyba při nahrávání dokumentu.' });
  }
});

router.delete('/documents-admin/:id', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    await prisma.document.delete({ where: { id: req.params.id } });
    res.json({ message: 'Dokument smazán.' });
  } catch (error) {
    res.status(500).json({ error: 'Chyba při mazání dokumentu.' });
  }
});

// ==================== NOVINKY ====================

router.get('/news', async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const [articles, total] = await Promise.all([
      prisma.newsArticle.findMany({
        where: { isPublished: true },
        orderBy: { publishedAt: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
      }),
      prisma.newsArticle.count({ where: { isPublished: true } }),
    ]);
    res.json({ articles, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) });
  } catch (error) {
    res.status(500).json({ error: 'Chyba při načítání novinek.' });
  }
});

router.get('/news/:id', async (req, res) => {
  try {
    const article = await prisma.newsArticle.findFirst({ where: { id: req.params.id, isPublished: true } });
    if (!article) return res.status(404).json({ error: 'Článek nenalezen.' });
    res.json(article);
  } catch (error) {
    res.status(500).json({ error: 'Chyba.' });
  }
});

router.post('/news-admin', authenticate, requireRole('ADMIN', 'CONTENT_EDITOR'), [
  body('title').trim().notEmpty(),
  body('content').trim().notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const article = await prisma.newsArticle.create({
      data: {
        ...req.body,
        publishedAt: req.body.isPublished ? new Date() : null,
      },
    });
    res.status(201).json(article);
  } catch (error) {
    res.status(500).json({ error: 'Chyba při vytváření článku.' });
  }
});

router.put('/news-admin/:id', authenticate, requireRole('ADMIN', 'CONTENT_EDITOR'), async (req, res) => {
  try {
    const data = { ...req.body };
    if (data.isPublished && !data.publishedAt) {
      const existing = await prisma.newsArticle.findUnique({ where: { id: req.params.id } });
      if (!existing.publishedAt) data.publishedAt = new Date();
    }
    const article = await prisma.newsArticle.update({ where: { id: req.params.id }, data });
    res.json(article);
  } catch (error) {
    res.status(500).json({ error: 'Chyba při aktualizaci článku.' });
  }
});

router.delete('/news-admin/:id', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    await prisma.newsArticle.delete({ where: { id: req.params.id } });
    res.json({ message: 'Článek smazán.' });
  } catch (error) {
    res.status(500).json({ error: 'Chyba při mazání článku.' });
  }
});

module.exports = router;
