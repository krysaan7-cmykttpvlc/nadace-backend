const bcrypt = require('bcryptjs');

async function main() {
  require('dotenv').config();
  const { PrismaClient } = require('../generated/prisma');
  const prisma = new PrismaClient();

  const adminPassword = await bcrypt.hash('admin123', 12);

  await prisma.user.upsert({
    where: { email: 'admin@nadace-pavelcovych.cz' },
    update: {},
    create: {
      email: 'admin@nadace-pavelcovych.cz',
      passwordHash: adminPassword,
      firstName: 'Admin',
      lastName: 'Nadace',
      dateOfBirth: new Date('1990-01-01'),
      addressStreet: 'Náměstí 1',
      addressCity: 'Vyšší Brod',
      addressZip: '38273',
      phone: '+420000000000',
      isPermanentResident: true,
      emailVerified: true,
      registrationStatus: 'APPROVED',
      role: 'ADMIN',
      trustLevel: 'ACTIVE_BENEFICIAL',
      memberSince: new Date(),
      gdprConsent: true,
      gdprConsentDate: new Date(),
      rulesConsent: true,
      rulesConsentDate: new Date(),
    },
  });

  // Výchozí stránky
  const pages = [
    { slug: 'o-nadaci', title: 'O nadaci', content: 'Historie vzniku, poslání a hodnoty nadace.', isPublished: true, sortOrder: 1 },
    { slug: 'ucel-a-cinnost', title: 'Účel a činnost', content: 'Oblasti podpory a pravidla nadace.', isPublished: true, sortOrder: 2 },
    { slug: 'organy-nadace', title: 'Orgány nadace', content: 'Správní rada a způsob rozhodování.', isPublished: true, sortOrder: 3 },
    { slug: 'kontakt', title: 'Kontakt', content: 'Kontaktní informace nadace.', isPublished: true, sortOrder: 4 },
  ];

  for (const page of pages) {
    await prisma.page.upsert({
      where: { slug: page.slug },
      update: {},
      create: page,
    });
  }

  console.log('Seed dokončen. Admin: admin@nadace-pavelcovych.cz / admin123');
  await prisma.$disconnect();
}

main().catch(console.error);
