// Centrální pino logger.
// Použití: const logger = require('./utils/logger');
//          logger.info({ userId }, 'něco se stalo');
//          logger.error({ err }, 'rozbilo se to');
//
// V dev (NODE_ENV != 'production') se loguje pretty-printed do konzole pokud
// je nainstalovaný `pino-pretty`. V produkci jen JSON do stdoutu (Railway si ho
// zachytí a indexuje).

const pino = require('pino');

const isDev = process.env.NODE_ENV !== 'production';

const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  // Bez pretty transportu – Railway si JSON parsuje sám a v dev je čitelné dost.
  base: undefined, // nezapisuj pid/hostname do každé řádky
  timestamp: pino.stdTimeFunctions.isoTime,
});

module.exports = logger;
