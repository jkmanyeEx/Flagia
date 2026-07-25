import mysql from 'mysql2/promise';

const isProduction = process.env.NODE_ENV === 'production';

function envValue(
  primary: string,
  legacy: string | undefined,
  developmentDefault: string
): string {
  const value = process.env[primary] || (legacy ? process.env[legacy] : undefined);
  if (value) return value;
  if (isProduction) {
    throw new Error(`${primary} must be set in production`);
  }
  return developmentDefault;
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: envValue('DB_USER', 'SQL_USER', 'devmeko'),
  password: envValue('DB_PASSWORD', 'SQL_PW', ''),
  database: process.env.DB_NAME || 'flagia',
  waitForConnections: true,
  connectionLimit: 20,
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: '+09:00',
});

export default pool;
