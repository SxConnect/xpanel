const pool = require('../db');

const SENSITIVE_KEYS = ['jwt_secret', 'cookie_secret', 'db_password'];

module.exports = async function (fastify) {
  // Listar configurações (apenas admin)
  fastify.get('/api/settings', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      return reply.status(403).send({ error: 'Acesso negado' });
    }

    const result = await pool.query(
      "SELECT key, description, CASE WHEN key = ANY($1) THEN '••••••••' ELSE value END as value FROM settings ORDER BY key",
      [SENSITIVE_KEYS]
    );
    return result.rows;
  });

  // Atualizar configuração (apenas admin)
  fastify.put('/api/settings/:key', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      return reply.status(403).send({ error: 'Acesso negado' });
    }

    const { value, description } = request.body || {};

    if (!value) {
      return reply.status(400).send({ error: 'Valor é obrigatório' });
    }

    // Validar key
    const key = request.params.key.replace(/[^a-zA-Z0-9_.]/g, '');
    if (!key) {
      return reply.status(400).send({ error: 'Chave inválida' });
    }

    await pool.query(
      `INSERT INTO settings (key, value, description) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET value = $2, description = $3`,
      [key, value, description || null]
    );

    return { success: true };
  });
};
