import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: '127.0.0.1',
  user: process.env.SQL_USER || 'devmeko',
  password: process.env.SQL_PW || 'Qqqq1111!',
  database: 'flagia',
  waitForConnections: true,
  connectionLimit: 20,
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: '+09:00',
});

export default pool;
