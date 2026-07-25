const mysql = require('mysql2/promise');

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || process.env.SQL_USER,
    password: process.env.DB_PASSWORD || process.env.SQL_PW,
    database: process.env.DB_NAME || 'flagia'
  });

  const [rows] = await connection.execute(
    'SELECT events_blob FROM sessions WHERE id = ?',
    ['46e0977c-dc82-4ed3-9816-7132cbbd647e']
  );

  if (rows.length === 0) {
    console.log('Session not found');
    await connection.end();
    return;
  }

  const events = JSON.parse(rows[0].events_blob);
  console.log('Total events:', events.length);
  
  // Print keydowns with keys and cursor positions
  const keydowns = events.filter(e => e.type === 'keydown').map(e => ({
    key: e.meta?.key,
    pos: e.meta?.cursorPosition,
    mod: e.meta?.mod
  }));

  console.log('Keydowns sample:');
  console.log(keydowns.slice(0, 100));

  await connection.end();
}

main().catch(console.error);
