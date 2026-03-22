const jwt = require('jsonwebtoken');
const prisma = require('../prisma');

// Ověření JWT tokenu
async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Přístup odepřen. Token nebyl poskytnut.' });
  }

  try {
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });

    if (!user) {
      return res.status(401).json({ error: 'Uživatel nenalezen.' });
    }

    if (user.registrationStatus === 'BLOCKED') {
      return res.status(403).json({ error: 'Váš účet byl zablokován.' });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Neplatný token.' });
  }
}

// Ověření, že uživatel je schválený
function requireApproved(req, res, next) {
  if (req.user.registrationStatus !== 'APPROVED') {
    return res.status(403).json({ error: 'Váš účet dosud nebyl schválen.' });
  }
  next();
}

// Ověření role
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role) && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Nemáte oprávnění k této akci.' });
    }
    next();
  };
}

// Ověření minimální doby členství pro hlasování
function requireMinMembership(req, res, next) {
  if (!req.user.memberSince) {
    return res.status(403).json({ error: 'Váš účet dosud nebyl schválen.' });
  }

  const memberSince = new Date(req.user.memberSince);
  const minDays = req.user.minVotingDays || 30;
  const now = new Date();
  const diffDays = (now - memberSince) / (1000 * 60 * 60 * 24);

  if (diffDays < minDays) {
    const remaining = Math.ceil(minDays - diffDays);
    return res.status(403).json({
      error: `Musíte být členem alespoň ${minDays} dní. Zbývá ${remaining} dní.`
    });
  }
  next();
}

module.exports = { authenticate, requireApproved, requireRole, requireMinMembership };
