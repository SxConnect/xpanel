const pool = require('../db');
const { Client } = require('pg');

const VALID_DB_TYPES = ['postgres'];
const VALID_PORT_RANGE = { min: 1, max: 65535 };

// Sanitiza nome de tabela (apenas alfanumérico e underscore)
function sanitizeTableName(name) {
  if (!name || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    return null;
  }
  return name;
}

module.exports = async function (fastify) {
  // Helper para criar conexão com banco do workspace
  async function getWorkspaceDb(workspace) {
    if (!workspace.db_type || !workspace.db_host) {
      throw new Error('Banco de dados não configurado para este workspace');
    }

    if (!VALID_DB_TYPES.includes(workspace.db_type)) {
      throw new Error('Tipo de banco não suportado');
    }

    const port = parseInt(workspace.db_port, 10) || 5432;
    if (port < VALID_PORT_RANGE.min || port > VALID_PORT_RANGE.max) {
      throw new Error('Porta do banco inválida');
    }

    if (workspace.db_type === 'postgres') {
      const client = new Client({
        host: workspace.db_host,
        port: port,
        database: workspace.db_name,
        user: workspace.db_user,
        password: workspace.db_password,
        connectionTimeoutMillis: 5000,
        statement_timeout: 10000
      });
      await client.connect();
      return client;
    }

    throw new Error('Tipo de banco não suportado');
  }

  // Helper seguro para queries do workspace
  async function safeWorkspaceQuery(workspace, sql, params = []) {
    const client = await getWorkspaceDb(workspace);
    try {
      const result = await client.query(sql, params);
      return result;
    } finally {
      await client.end().catch(() => {});
    }
  }

  // Buscar workspace com verificação de owner
  async function getOwnedWorkspace(id, userId) {
    const result = await pool.query(
      'SELECT * FROM workspaces WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  // Testar conexão com banco
  fastify.post('/api/workspaces/:id/db/test', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const workspace = await getOwnedWorkspace(request.params.id, request.user.id);
    if (!workspace) {
      return reply.status(404).send({ error: 'Workspace não encontrado' });
    }

    if (!workspace.db_type) {
      return reply.status(400).send({ error: 'Banco de dados não configurado' });
    }

    try {
      const client = await getWorkspaceDb(workspace);
      await client.query('SELECT 1');
      await client.end();
      return { success: true, message: 'Conexão estabelecida com sucesso' };
    } catch (error) {
      return reply.status(500).send({ error: 'Falha ao conectar com o banco' });
    }
  });

  // Listar tabelas
  fastify.get('/api/workspaces/:id/db/tables', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const workspace = await getOwnedWorkspace(request.params.id, request.user.id);
    if (!workspace) {
      return reply.status(404).send({ error: 'Workspace não encontrado' });
    }

    try {
      const res = await safeWorkspaceQuery(workspace, `
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `);
      return { tables: res.rows.map(r => r.table_name) };
    } catch (error) {
      return reply.status(500).send({ error: 'Erro ao listar tabelas' });
    }
  });

  // Descrever tabela
  fastify.get('/api/workspaces/:id/db/tables/:table', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const workspace = await getOwnedWorkspace(request.params.id, request.user.id);
    if (!workspace) {
      return reply.status(404).send({ error: 'Workspace não encontrado' });
    }

    const tableName = sanitizeTableName(request.params.table);
    if (!tableName) {
      return reply.status(400).send({ error: 'Nome de tabela inválido' });
    }

    try {
      const res = await safeWorkspaceQuery(workspace, `
        SELECT 
          column_name,
          data_type,
          character_maximum_length,
          is_nullable,
          column_default
        FROM information_schema.columns
        WHERE table_name = $1 AND table_schema = 'public'
        ORDER BY ordinal_position
      `, [tableName]);

      return { table: tableName, columns: res.rows };
    } catch (error) {
      return reply.status(500).send({ error: 'Erro ao descrever tabela' });
    }
  });

  // Consultar dados (com paginação)
  fastify.get('/api/workspaces/:id/db/tables/:table/data', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const workspace = await getOwnedWorkspace(request.params.id, request.user.id);
    if (!workspace) {
      return reply.status(404).send({ error: 'Workspace não encontrado' });
    }

    const tableName = sanitizeTableName(request.params.table);
    if (!tableName) {
      return reply.status(400).send({ error: 'Nome de tabela inválido' });
    }

    const limit = Math.min(Math.max(parseInt(request.query.limit, 10) || 100, 1), 1000);
    const offset = Math.max(parseInt(request.query.offset, 10) || 0, 0);

    try {
      const dataRes = await safeWorkspaceQuery(
        workspace, 
        `SELECT * FROM "${tableName}" LIMIT $1 OFFSET $2`, 
        [limit, offset]
      );
      
      const countRes = await safeWorkspaceQuery(
        workspace, 
        `SELECT COUNT(*) FROM "${tableName}"`
      );
      
      return { 
        data: dataRes.rows, 
        total: parseInt(countRes.rows[0].count, 10),
        limit,
        offset
      };
    } catch (error) {
      return reply.status(500).send({ error: 'Erro ao consultar dados' });
    }
  });

  // Executar consulta controlada (SELECT apenas)
  fastify.post('/api/workspaces/:id/db/query', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const workspace = await getOwnedWorkspace(request.params.id, request.user.id);
    if (!workspace) {
      return reply.status(404).send({ error: 'Workspace não encontrado' });
    }

    const { query: sqlQuery, params } = request.body || {};

    if (!sqlQuery || typeof sqlQuery !== 'string') {
      return reply.status(400).send({ error: 'Consulta SQL é obrigatória' });
    }

    // Validar que é apenas SELECT
    const normalizedQuery = sqlQuery.trim().toLowerCase();
    if (!normalizedQuery.startsWith('select')) {
      return reply.status(400).send({ error: 'Apenas consultas SELECT são permitidas' });
    }

    // Bloquear palavras-chave perigosas
    const forbidden = ['insert', 'update', 'delete', 'drop', 'alter', 'create', 'truncate', 'grant', 'revoke', 'exec', 'execute'];
    for (const word of forbidden) {
      if (normalizedQuery.includes(word)) {
        return reply.status(400).send({ error: 'Consulta contém operação não permitida' });
      }
    }

    // Limitar tamanho da query
    if (sqlQuery.length > 5000) {
      return reply.status(400).send({ error: 'Consulta muito longa (máx. 5000 caracteres)' });
    }

    try {
      const safeParams = Array.isArray(params) ? params.map(p => {
        if (typeof p === 'object' && p !== null) return null;
        return p;
      }) : [];

      const res = await safeWorkspaceQuery(workspace, sqlQuery, safeParams);
      return { data: res.rows };
    } catch (error) {
      return reply.status(500).send({ error: 'Erro ao executar consulta' });
    }
  });
};
