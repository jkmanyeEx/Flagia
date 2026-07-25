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
    ['5684b3bd-1d38-4372-a4a4-f600a7191a53']
  );

  if (rows.length === 0) {
    console.log('Session not found');
    await connection.end();
    return;
  }

  const events = JSON.parse(rows[0].events_blob);
  console.log('Total events:', events.length);
  
  // print first 50 events
  console.log(JSON.stringify(events.slice(0, 50), null, 2));

  await connection.end();
}

main().catch(console.error);
