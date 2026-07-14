const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://xpanel:xpanel@localhost:5432/xpanel'
});

module.exports = pool;