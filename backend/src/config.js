require('dotenv').config();

const isProd = process.env.NODE_ENV === 'production';

if (isProd && (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'change-me-in-production')) {
  throw new Error('JWT_SECRET must be set to a strong random value in production.');
}

module.exports = {
  isProd,
  port: Number(process.env.PORT) || 4000,
  databaseUrl:
    process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/opshub',
  pgSsl: process.env.PGSSL === 'true',
  jwtSecret: process.env.JWT_SECRET || require('crypto').randomBytes(32).toString('hex'),
  jwtExpiresIn: '8h',
  clientOrigins: (process.env.CLIENT_ORIGIN || 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  // Web Push (phone / desktop notifications). Generate keys with `npm run vapid`.
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    subject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
  },
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'OpsHub <no-reply@example.com>',
  },
};
