const fs = require('fs');
const path = require('path');
const pool = require('./pool');

async function init() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('Database schema is up to date.');
}

if (require.main === module) {
  init()
    .then(() => pool.end())
    .catch((err) => {
      console.error('Schema init failed:', err.message);
      process.exit(1);
    });
}

module.exports = init;
