require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { PrismaClient } = require('../generated/prisma');

const prisma = new PrismaClient();

module.exports = prisma;
