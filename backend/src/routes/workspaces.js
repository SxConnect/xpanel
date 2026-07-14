const pool = require('../db');
const path = require('path');
const fs = require('fs').promises;

const VALID_TEMPLATES = ['static-html', 'node', 'nextjs', 'php', 'python'];

// Sanitiza workspace removendo dados sensíveis das respostas
function sanitizeWorkspace(ws) {
  if (!ws) return ws;
  const safe = { ...ws };
  delete safe.db_password;
  if (safe.db_password !== undefined) {
    safe.db_password = safe.db_type ? '••••••••' : null;
  }
  return safe;
}

function sanitizeWorkspaceList(rows) {
  return rows.map(sanitizeWorkspace);
}

module.exports = async function (fastify) {
  // Listar workspaces
  fastify.get('/api/workspaces', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const result = await pool.query(
        'SELECT w.*, array_agg(d.domain) as domains FROM workspaces w LEFT JOIN domains d ON w.id = d.workspace_id WHERE w.user_id = $1 GROUP BY w.id ORDER BY w.created_at DESC',
        [request.user.id]
      );
      return sanitizeWorkspaceList(result.rows);
    } catch (error) {
      return reply.status(500).send({ error: 'Erro ao listar workspaces' });
    }
  });

  // Criar workspace
  fastify.post('/api/workspaces', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { name, domain, repo_url, branch, template, env, db_type, db_name, db_user, db_password, db_host, db_port } = request.body || {};

    if (!name || !name.trim()) {
      return reply.status(400).send({ error: 'Nome é obrigatório' });
    }

    if (!repo_url || !repo_url.trim()) {
      return reply.status(400).send({ error: 'Repositório é obrigatório' });
    }

    // Validar template
    if (template && !VALID_TEMPLATES.includes(template)) {
      return reply.status(400).send({ error: `Template inválido. Opções: ${VALID_TEMPLATES.join(', ')}` });
    }

    // Validar branch (sem caracteres perigosos)
    const safeBranch = (branch || 'main').replace(/[^a-zA-Z0-9._\-\/]/g, '');
    if (!safeBranch) {
      return reply.status(400).send({ error: 'Branch inválida' });
    }

    // Validar env é JSON válido
    let envJson = '{}';
    if (env) {
      try {
        envJson = typeof env === 'string' ? env : JSON.stringify(env);
        JSON.parse(envJson);
      } catch {
        return reply.status(400).send({ error: 'Variáveis de ambiente devem ser JSON válido' });
      }
    }

    // Validar db_port
    const port = db_port ? parseInt(db_port, 10) : null;
    if (port && (isNaN(port) || port < 1 || port > 65535)) {
      return reply.status(400).send({ error: 'Porta do banco inválida' });
    }

    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
    const deployPath = `/home/xpanel/sites/${Date.now()}-${slug}`;

    try {
      const result = await pool.query(
        `INSERT INTO workspaces (user_id, name, domain, repo_url, branch, template, env, deploy_path, db_type, db_name, db_user, db_password, db_host, db_port)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
        [request.user.id, name.trim(), domain || null, repo_url.trim(), safeBranch, template || 'static-html', envJson, deployPath, db_type || null, db_name || null, db_user || null, db_password || null, db_host || null, port]
      );

      if (domain) {
        await pool.query(
          'INSERT INTO domains (workspace_id, domain, is_primary) VALUES ($1, $2, true)',
          [result.rows[0].id, domain]
        );
      }

      await fs.mkdir(deployPath, { recursive: true });

      return sanitizeWorkspace(result.rows[0]);
    } catch (error) {
      return reply.status(500).send({ error: 'Erro ao criar workspace' });
    }
  });

  // Buscar workspace por ID
  fastify.get('/api/workspaces/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const result = await pool.query(
        'SELECT w.*, array_agg(d.domain) as domains FROM workspaces w LEFT JOIN domains d ON w.id = d.workspace_id WHERE w.id = $1 AND w.user_id = $2 GROUP BY w.id',
        [request.params.id, request.user.id]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ error: 'Workspace não encontrado' });
      }

      return sanitizeWorkspace(result.rows[0]);
    } catch (error) {
      return reply.status(500).send({ error: 'Erro ao buscar workspace' });
    }
  });

  // Atualizar workspace
  fastify.put('/api/workspaces/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { name, domain, repo_url, branch, template, env, db_type, db_name, db_user, db_password, db_host, db_port } = request.body || {};

    if (!name || !name.trim()) {
      return reply.status(400).send({ error: 'Nome é obrigatório' });
    }

    if (template && !VALID_TEMPLATES.includes(template)) {
      return reply.status(400).send({ error: `Template inválido. Opções: ${VALID_TEMPLATES.join(', ')}` });
    }

    const safeBranch = (branch || 'main').replace(/[^a-zA-Z0-9._\-\/]/g, '');
    let envJson = '{}';
    if (env) {
      try {
        envJson = typeof env === 'string' ? env : JSON.stringify(env);
        JSON.parse(envJson);
      } catch {
        return reply.status(400).send({ error: 'Variáveis de ambiente devem ser JSON válido' });
      }
    }

    const port = db_port ? parseInt(db_port, 10) : null;
    if (port && (isNaN(port) || port < 1 || port > 65535)) {
      return reply.status(400).send({ error: 'Porta do banco inválida' });
    }

    try {
      const result = await pool.query(
        `UPDATE workspaces SET name = $1, domain = $2, repo_url = $3, branch = $4, template = $5, env = $6, db_type = $7, db_name = $8, db_user = $9, db_password = $10, db_host = $11, db_port = $12, updated_at = NOW()
         WHERE id = $13 AND user_id = $14 RETURNING *`,
        [name.trim(), domain || null, repo_url?.trim() || null, safeBranch, template || 'static-html', envJson, db_type || null, db_name || null, db_user || null, db_password || null, db_host || null, port, request.params.id, request.user.id]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ error: 'Workspace não encontrado' });
      }

      return sanitizeWorkspace(result.rows[0]);
    } catch (error) {
      return reply.status(500).send({ error: 'Erro ao atualizar workspace' });
    }
  });

  // Deletar workspace
  fastify.delete('/api/workspaces/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const result = await pool.query(
        'DELETE FROM workspaces WHERE id = $1 AND user_id = $2 RETURNING *',
        [request.params.id, request.user.id]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ error: 'Workspace não encontrado' });
      }

      // Tentar remover stack Docker
      try {
        const { execSync } = require('child_process');
        execSync(`docker stack rm xpanel-${result.rows[0].id}`, { stdio: 'pipe', timeout: 5000 });
      } catch {}

      // Remover diretório
      try {
        await fs.rm(result.rows[0].deploy_path, { recursive: true, force: true });
      } catch {}

      return { success: true };
    } catch (error) {
      return reply.status(500).send({ error: 'Erro ao deletar workspace' });
    }
  });

  // Gerenciar domínios
  fastify.post('/api/workspaces/:id/domains', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { domain } = request.body || {};

    if (!domain || !domain.trim()) {
      return reply.status(400).send({ error: 'Domínio é obrigatório' });
    }

    // Validar formato básico do domínio
    const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;
    if (!domainRegex.test(domain.trim())) {
      return reply.status(400).send({ error: 'Formato de domínio inválido' });
    }

    // Verificar se pertence ao workspace
    const wsCheck = await pool.query(
      'SELECT id FROM workspaces WHERE id = $1 AND user_id = $2',
      [request.params.id, request.user.id]
    );
    if (wsCheck.rows.length === 0) {
      return reply.status(404).send({ error: 'Workspace não encontrado' });
    }

    const cleanDomain = domain.trim();
    const exists = await pool.query('SELECT id FROM domains WHERE domain = $1', [cleanDomain]);
    if (exists.rows.length > 0) {
      return reply.status(400).send({ error: 'Domínio já está em uso' });
    }

    await pool.query(
      'INSERT INTO domains (workspace_id, domain) VALUES ($1, $2)',
      [request.params.id, cleanDomain]
    );

    return { success: true };
  });

  fastify.delete('/api/workspaces/:id/domains/:domain', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    // Verificar pertencimento
    const wsCheck = await pool.query(
      'SELECT id FROM workspaces WHERE id = $1 AND user_id = $2',
      [request.params.id, request.user.id]
    );
    if (wsCheck.rows.length === 0) {
      return reply.status(404).send({ error: 'Workspace não encontrado' });
    }

    await pool.query(
      'DELETE FROM domains WHERE workspace_id = $1 AND domain = $2 AND is_primary = false',
      [request.params.id, request.params.domain]
    );

    return { success: true };
  });
};
