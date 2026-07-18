const bcrypt = require('bcryptjs');
const pool = require('../db');

const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 8;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_TIME_MS = 15 * 60 * 1000;

const loginAttempts = new Map();

function getLoginAttempts(email) {
  const data = loginAttempts.get(email);
  if (!data) return { count: 0, lockedUntil: null };
  if (data.lockedUntil && Date.now() > data.lockedUntil) {
    loginAttempts.delete(email);
    return { count: 0, lockedUntil: null };
  }
  return data;
}

function recordLoginAttempt(email) {
  const data = getLoginAttempts(email);
  const count = data.count + 1;
  const lockedUntil = count >= MAX_LOGIN_ATTEMPTS ? Date.now() + LOCKOUT_TIME_MS : null;
  loginAttempts.set(email, { count, lockedUntil });
}

function clearLoginAttempts(email) {
  loginAttempts.delete(email);
}

function validatePassword(password) {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return `Senha deve ter no mínimo ${MIN_PASSWORD_LENGTH} caracteres`;
  }
  return null;
}

const VALID_ROLES = ['user', 'admin'];

module.exports = async function (fastify) {
  // Login
  fastify.post('/api/auth/login', async (request, reply) => {
    const { email, password } = request.body || {};

    if (!email || !password) {
      return reply.status(400).send({ error: 'Email e senha são obrigatórios' });
    }

    const attempts = getLoginAttempts(email);
    if (attempts.lockedUntil) {
      const remainingMin = Math.ceil((attempts.lockedUntil - Date.now()) / 60000);
      return reply.status(429).send({ 
        error: `Conta bloqueada. Tente novamente em ${remainingMin} minuto(s)` 
      });
    }

    let user = null;
    let valid = false;

    try {
      const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      if (result.rows.length > 0) {
        user = result.rows[0];
        valid = await bcrypt.compare(password, user.password_hash);
      }
    } catch (dbErr) {
      fastify.log.error(dbErr);
      return reply.status(500).send({ error: 'Erro ao conectar com o banco de dados' });
    }

    if (!user || !valid) {
      recordLoginAttempt(email);
      return reply.status(401).send({ error: 'Credenciais inválidas' });
    }

    clearLoginAttempts(email);

    const token = fastify.jwt.sign(
      { id: user.id, email: user.email, role: user.role }, 
      { expiresIn: '24h' }
    );
    
    reply.setCookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 86400
    });

    return { 
      token, 
      user: { id: user.id, email: user.email, role: user.role } 
    };
  });

  // Registro
  fastify.post('/api/auth/register', async (request, reply) => {
    const { email, password, role } = request.body || {};

    if (!email || !password) {
      return reply.status(400).send({ error: 'Email e senha são obrigatórios' });
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return reply.status(400).send({ error: passwordError });
    }

    const userRole = VALID_ROLES.includes(role) ? role : 'user';

    try {
      const exists = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
      if (exists.rows.length > 0) {
        return reply.status(400).send({ error: 'Email já cadastrado' });
      }

      const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const result = await pool.query(
        'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id, email, role',
        [email, hash, userRole]
      );

      return result.rows[0];
    } catch (dbErr) {
      fastify.log.error(dbErr);
      return reply.status(500).send({ error: 'Erro ao criar conta' });
    }
  });

  // Verificar sessão
  fastify.get('/api/auth/me', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const result = await pool.query(
        'SELECT id, email, role, created_at FROM users WHERE id = $1',
        [request.user.id]
      );
      if (result.rows.length) return result.rows[0];
    } catch {}

    return reply.status(404).send({ error: 'Usuário não encontrado' });
  });
};
