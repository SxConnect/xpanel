const net = require('net');
const pool = require('./db');

const BASE_PORT = 8080;
const MAX_PORT = 9999;

async function findAvailablePort() {
  // Buscar portas já usadas no banco
  const result = await pool.query('SELECT port FROM workspaces WHERE port IS NOT NULL');
  const usedPorts = new Set(result.rows.map(r => r.port));

  for (let port = BASE_PORT; port <= MAX_PORT; port++) {
    if (usedPorts.has(port)) continue;

    // Verificar se a porta está livre no sistema
    const free = await isPortFree(port);
    if (free) return port;
  }

  throw new Error('Nenhuma porta disponível');
}

function isPortFree(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => { server.close(); resolve(true); });
    server.listen(port, '127.0.0.1');
  });
}

module.exports = { findAvailablePort };
