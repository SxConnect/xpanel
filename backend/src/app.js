require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fastify = require('fastify')({ 
  logger: true,
  bodyLimit: 1048576
});
const pool = require('./db');

// Plugins
fastify.register(require('@fastify/cors'), { 
  origin: true, 
  credentials: true 
});
fastify.register(require('@fastify/jwt'), { 
  secret: process.env.JWT_SECRET || 'xpanel-dev-secret-change-in-production'
});
fastify.register(require('@fastify/cookie'), { 
  secret: process.env.COOKIE_SECRET || 'xpanel-dev-cookie-change-in-production'
});
fastify.register(require('@fastify/static'), {
  root: require('path').join(__dirname, '../frontend'),
  index: 'login.html'
});

// Middleware de autenticação
fastify.decorate('authenticate', async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch (err) {
    return reply.status(401).send({ error: 'Não autorizado' });
  }

  // Verificar se o usuário ainda existe no banco
  try {
    const result = await pool.query('SELECT id FROM users WHERE id = $1', [request.user.id]);
    if (result.rows.length === 0) {
      return reply.status(401).send({ error: 'Usuário não encontrado' });
    }
  } catch {
    return reply.status(401).send({ error: 'Não autorizado' });
  }
});

// Handler global de erros
fastify.setErrorHandler((error, request, reply) => {
  fastify.log.error(error);

  if (error.validation) {
    return reply.status(400).send({ error: 'Dados inválidos na requisição' });
  }

  const statusCode = error.statusCode || 500;
  
  if (process.env.NODE_ENV === 'production') {
    return reply.status(statusCode).send({ error: 'Erro interno do servidor' });
  }

  return reply.status(statusCode).send({ error: error.message });
});

// Rotas
fastify.register(require('./routes/auth'));
fastify.register(require('./routes/workspaces'));
fastify.register(require('./routes/deploy'));
fastify.register(require('./routes/settings'));
fastify.register(require('./routes/database'));

// Healthcheck
fastify.get('/api/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

// Inicializar banco
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'user',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS workspaces (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        domain VARCHAR(255),
        repo_url VARCHAR(500),
        branch VARCHAR(100) DEFAULT 'main',
        template VARCHAR(100) DEFAULT 'static-html',
        env JSONB DEFAULT '{}',
        status VARCHAR(50) DEFAULT 'idle',
        deploy_path VARCHAR(500),
        db_type VARCHAR(50),
        db_name VARCHAR(255),
        db_user VARCHAR(255),
        db_password VARCHAR(255),
        db_host VARCHAR(255),
        db_port INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS deployments (
        id SERIAL PRIMARY KEY,
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        status VARCHAR(50),
        commit VARCHAR(255),
        branch VARCHAR(100),
        started_at TIMESTAMP DEFAULT NOW(),
        finished_at TIMESTAMP,
        logs_path VARCHAR(500),
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(255) PRIMARY KEY,
        value TEXT,
        description TEXT
      );

      CREATE TABLE IF NOT EXISTS domains (
        id SERIAL PRIMARY KEY,
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        domain VARCHAR(255) UNIQUE NOT NULL,
        is_primary BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_workspaces_user_id ON workspaces(user_id);
      CREATE INDEX IF NOT EXISTS idx_workspaces_status ON workspaces(status);
      CREATE INDEX IF NOT EXISTS idx_deployments_workspace_id ON deployments(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status);
      CREATE INDEX IF NOT EXISTS idx_domains_workspace_id ON domains(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_domains_domain ON domains(domain);
    `);

    // Migration: adicionar coluna port se não existir
    const colCheck = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'workspaces' AND column_name = 'port'
    `);
    if (colCheck.rows.length === 0) {
      await client.query('ALTER TABLE workspaces ADD COLUMN port INTEGER');
      fastify.log.info('Coluna "port" adicionada à tabela workspaces');
    }

    fastify.log.info('Banco de dados inicializado com sucesso');

    // Criar admin padrão se não houver usuários
    const bcrypt = require('bcryptjs');
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@xpanel.local';
    const adminPassword = process.env.ADMIN_PASSWORD || 'xpanel1234';
    const adminResult = await client.query('SELECT id FROM users LIMIT 1');
    if (adminResult.rows.length === 0) {
      const hash = await bcrypt.hash(adminPassword, 12);
      await client.query(
        'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)',
        [adminEmail, hash, 'admin']
      );
      fastify.log.info(`Admin padrão criado: ${adminEmail}`);
    }
  } finally {
    client.release();
  }
}

const start = async () => {
  try {
    await initDB();
    await fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
