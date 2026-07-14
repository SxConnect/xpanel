const pool = require('../db');
const { execSync } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

const VALID_TEMPLATES = ['static-html', 'node', 'nextjs', 'php', 'python'];
const VALID_STACK_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const VALID_GIT_REF_RE = /^[a-zA-Z0-9._\-\/]+$/;
const MAX_STACK_NAME_LEN = 64;

function sanitizeGitRef(ref) {
  if (!ref || typeof ref !== 'string') return null;
  const clean = ref.trim();
  if (!clean || clean.length > 255) return null;
  if (!VALID_GIT_REF_RE.test(clean)) return null;
  return clean;
}

function sanitizeRepoUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const clean = url.trim();
  if (!clean) return null;
  const validPatterns = [
    /^https:\/\/[a-zA-Z0-9._\-]+\/[a-zA-Z0-9._\-\/]+\.git$/,
    /^https:\/\/[a-zA-Z0-9._\-]+\/[a-zA-Z0-9._\-\/]+$/,
    /^git@github\.com:[a-zA-Z0-9._\-\/]+\.git$/,
    /^git@github\.com:[a-zA-Z0-9._\-\/]+$/,
    /^git@gitlab\.com:[a-zA-Z0-9._\-\/]+\.git$/,
    /^git@gitlab\.com:[a-zA-Z0-9._\-\/]+$/,
    /^git@bitbucket\.org:[a-zA-Z0-9._\-\/]+\.git$/,
    /^git@bitbucket\.org:[a-zA-Z0-9._\-\/]+$/,
  ];
  if (!validPatterns.some(p => p.test(clean))) return null;
  return clean;
}

function safeStackName(id) {
  const name = `xpanel-${id}`;
  if (!VALID_STACK_NAME_RE.test(name) || name.length > MAX_STACK_NAME_LEN) return null;
  return name;
}

module.exports = async function (fastify) {
  async function getOwnedWorkspace(id, userId) {
    const result = await pool.query(
      'SELECT * FROM workspaces WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  fastify.post('/api/workspaces/:id/validate-repo', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const workspace = await getOwnedWorkspace(request.params.id, request.user.id);
    if (!workspace) {
      return reply.status(404).send({ error: 'Workspace não encontrado' });
    }

    const repoUrl = sanitizeRepoUrl(workspace.repo_url);
    const branch = sanitizeGitRef(workspace.branch);

    if (!repoUrl) {
      return reply.status(400).send({ error: 'URL do repositório inválida' });
    }
    if (!branch) {
      return reply.status(400).send({ error: 'Nome da branch inválido' });
    }

    try {
      execSync(`git ls-remote "${repoUrl}" "${branch}"`, {
        stdio: 'pipe',
        timeout: 15000
      });
      return { valid: true, message: 'Repositório e branch acessíveis' };
    } catch (error) {
      return reply.status(400).send({ error: 'Repositório ou branch inacessível' });
    }
  });

  fastify.post('/api/workspaces/:id/deploy', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const workspace = await getOwnedWorkspace(request.params.id, request.user.id);
    if (!workspace) {
      return reply.status(404).send({ error: 'Workspace não encontrado' });
    }

    const repoUrl = sanitizeRepoUrl(workspace.repo_url);
    const branch = sanitizeGitRef(workspace.branch);
    const stackName = safeStackName(workspace.id);

    if (!repoUrl || !branch || !stackName) {
      return reply.status(400).send({ error: 'Configuração do workspace inválida' });
    }

    if (!VALID_TEMPLATES.includes(workspace.template)) {
      return reply.status(400).send({ error: 'Template inválido' });
    }

    await pool.query('UPDATE workspaces SET status = $1 WHERE id = $2', ['deploying', workspace.id]);

    const deploy = await pool.query(
      'INSERT INTO deployments (workspace_id, status, branch) VALUES ($1, $2, $3) RETURNING *',
      [workspace.id, 'running', branch]
    );

    try {
      const repoDir = workspace.deploy_path;

      try {
        await fs.access(path.join(repoDir, '.git'));
        execSync(`git -C "${repoDir}" fetch origin && git -C "${repoDir}" checkout "${branch}" && git -C "${repoDir}" pull origin "${branch}"`, {
          stdio: 'pipe',
          timeout: 60000
        });
      } catch {
        try {
          await fs.rm(repoDir, { recursive: true, force: true });
        } catch {}

        execSync(`git clone -b "${branch}" "${repoUrl}" "${repoDir}"`, {
          stdio: 'pipe',
          timeout: 120000
        });
      }

      const commit = execSync('git rev-parse HEAD', { cwd: repoDir, stdio: 'pipe' }).toString().trim();

      if (!/^[a-f0-9]{40}$/.test(commit)) {
        throw new Error('Commit hash inválido');
      }

      const templatePath = path.join(__dirname, '../../stacks', `${workspace.template}.yml`);
      const templateContent = await fs.readFile(templatePath, 'utf8');

      let stackContent = templateContent
        .replace(/\{\{WORKSPACE_ID\}\}/g, workspace.id)
        .replace(/\{\{WORKSPACE_NAME\}\}/g, workspace.name.replace(/[^a-zA-Z0-9_-]/g, ''))
        .replace(/\{\{DEPLOY_PATH\}\}/g, workspace.deploy_path)
        .replace(/\{\{DOMAIN\}\}/g, workspace.domain || '')
        .replace(/\{\{XPANEL_DOMAIN\}\}/g, process.env.XPANEL_DOMAIN || 'xpanel.localhost');

      if (workspace.env && typeof workspace.env === 'object' && Object.keys(workspace.env).length > 0) {
        const envVars = Object.entries(workspace.env)
          .filter(([key]) => /^[A-Z_][A-Z0-9_]*$/.test(key))
          .map(([key, value]) => `      - ${key}=${String(value).replace(/['"]/g, '')}`)
          .join('\n');
        stackContent = stackContent.replace('{{ENV_VARS}}', envVars);
      } else {
        stackContent = stackContent.replace('{{ENV_VARS}}', '');
      }

      const stackPath = path.join(repoDir, 'docker-stack.yml');
      await fs.writeFile(stackPath, stackContent);

      execSync(`docker stack deploy -c "${stackPath}" "${stackName}"`, {
        cwd: repoDir,
        stdio: 'pipe',
        timeout: 120000
      });

      // Healthcheck pos-deploy
      let isHealthy = false;
      for (let i = 0; i < 12; i++) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        try {
          const serviceCheck = execSync(
            `docker service ls --filter "name=${stackName}" --format "{{.Replicas}}"`,
            { encoding: 'utf8', stdio: 'pipe' }
          ).trim();

          if (serviceCheck && serviceCheck.includes('/')) {
            const [current, target] = serviceCheck.split('/');
            if (parseInt(current, 10) >= parseInt(target, 10) && parseInt(target, 10) > 0) {
              isHealthy = true;
              break;
            }
          }
        } catch {}
      }

      await pool.query(
        'UPDATE deployments SET status = $1, commit = $2, finished_at = NOW() WHERE id = $3',
        ['completed', commit, deploy.rows[0].id]
      );

      await pool.query(
        'UPDATE workspaces SET status = $1, updated_at = NOW() WHERE id = $2',
        [isHealthy ? 'active' : 'active', workspace.id]
      );

      return { success: true, commit };
    } catch (error) {
      await pool.query(
        'UPDATE deployments SET status = $1, finished_at = NOW() WHERE id = $2',
        ['failed', deploy.rows[0].id]
      );

      await pool.query(
        'UPDATE workspaces SET status = $1, updated_at = NOW() WHERE id = $2',
        ['error', workspace.id]
      );

      return reply.status(500).send({ error: 'Falha ao realizar deploy' });
    }
  });

  fastify.get('/api/workspaces/:id/logs', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const workspace = await getOwnedWorkspace(request.params.id, request.user.id);
    if (!workspace) {
      return reply.status(404).send({ error: 'Workspace não encontrado' });
    }

    const stackName = safeStackName(workspace.id);
    if (!stackName) {
      return reply.status(400).send({ error: 'Configuração inválida' });
    }

    try {
      const logs = execSync(
        `docker service logs --tail 100 ${stackName}_web`,
        { encoding: 'utf8', stdio: 'pipe' }
      );
      return { logs };
    } catch (error) {
      return { logs: 'Nenhum log disponível' };
    }
  });

  fastify.post('/api/workspaces/:id/rollback', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const workspace = await getOwnedWorkspace(request.params.id, request.user.id);
    if (!workspace) {
      return reply.status(404).send({ error: 'Workspace não encontrado' });
    }

    const { commit } = request.body || {};
    if (!commit || !/^[a-f0-9]{40}$/.test(commit)) {
      return reply.status(400).send({ error: 'Hash de commit inválido' });
    }

    const stackName = safeStackName(workspace.id);
    if (!stackName) {
      return reply.status(400).send({ error: 'Configuração inválida' });
    }

    try {
      execSync(`git -C "${workspace.deploy_path}" checkout ${commit}`, { stdio: 'pipe' });

      const stackPath = path.join(workspace.deploy_path, 'docker-stack.yml');
      execSync(`docker stack deploy -c "${stackPath}" "${stackName}"`, {
        cwd: workspace.deploy_path,
        stdio: 'pipe',
        timeout: 120000
      });

      await pool.query(
        'UPDATE workspaces SET status = $1, updated_at = NOW() WHERE id = $2',
        ['active', workspace.id]
      );

      return { success: true, commit };
    } catch (error) {
      return reply.status(500).send({ error: 'Falha ao realizar rollback' });
    }
  });

  fastify.post('/api/workspaces/:id/stop', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const workspace = await getOwnedWorkspace(request.params.id, request.user.id);
    if (!workspace) {
      return reply.status(404).send({ error: 'Workspace não encontrado' });
    }

    const stackName = safeStackName(workspace.id);
    if (!stackName) {
      return reply.status(400).send({ error: 'Configuração inválida' });
    }

    try {
      execSync(`docker stack rm "${stackName}"`, { stdio: 'pipe', timeout: 30000 });
      await pool.query('UPDATE workspaces SET status = $1 WHERE id = $2', ['stopped', workspace.id]);
      return { success: true };
    } catch (error) {
      return reply.status(500).send({ error: 'Falha ao parar workspace' });
    }
  });

  fastify.post('/api/workspaces/:id/start', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const workspace = await getOwnedWorkspace(request.params.id, request.user.id);
    if (!workspace) {
      return reply.status(404).send({ error: 'Workspace não encontrado' });
    }

    const stackName = safeStackName(workspace.id);
    if (!stackName) {
      return reply.status(400).send({ error: 'Configuração inválida' });
    }

    try {
      const stackPath = path.join(workspace.deploy_path, 'docker-stack.yml');
      await fs.access(stackPath);

      execSync(`docker stack deploy -c "${stackPath}" "${stackName}"`, {
        cwd: workspace.deploy_path,
        stdio: 'pipe',
        timeout: 120000
      });

      await pool.query('UPDATE workspaces SET status = $1 WHERE id = $2', ['active', workspace.id]);
      return { success: true };
    } catch (error) {
      return reply.status(500).send({ error: 'Falha ao iniciar workspace' });
    }
  });

  fastify.get('/api/workspaces/:id/deployments', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const workspace = await getOwnedWorkspace(request.params.id, request.user.id);
    if (!workspace) {
      return reply.status(404).send({ error: 'Workspace não encontrado' });
    }

    const result = await pool.query(
      'SELECT * FROM deployments WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 50',
      [workspace.id]
    );
    return result.rows;
  });
};
