// Xpanel Frontend - JavaScript Principal

const API_BASE = '';

// Gerar token CSRF simples (muda a cada sessão)
let csrfToken = sessionStorage.getItem('csrf_token');
if (!csrfToken) {
  csrfToken = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  sessionStorage.setItem('csrf_token', csrfToken);
}

// Verificar autenticação
function checkAuth() {
  const token = localStorage.getItem('token');
  if (!token) {
    window.location.href = 'login.html';
    return null;
  }
  return token;
}

// Headers de autenticação + CSRF
function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${localStorage.getItem('token')}`,
    'X-CSRF-Token': csrfToken
  };
}

// Logout
function logout() {
  localStorage.removeItem('token');
  sessionStorage.removeItem('csrf_token');
  window.location.href = 'login.html';
}

// Sanitizar string para inserção segura no HTML
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Carregar workspaces
async function loadWorkspaces() {
  const token = checkAuth();
  if (!token) return;

  try {
    const response = await fetch(`${API_BASE}/api/workspaces`, {
      headers: authHeaders()
    });

    if (response.status === 401) {
      logout();
      return;
    }

    const workspaces = await response.json();
    const container = document.getElementById('workspacesList');

    if (!Array.isArray(workspaces) || workspaces.length === 0) {
      container.innerHTML = '<p class="empty">Nenhum workspace encontrado. Crie seu primeiro workspace!</p>';
      return;
    }

    container.innerHTML = workspaces.map(ws => `
      <div class="card workspace-card" onclick="window.location.href='workspace.html?id=${ws.id}'">
        <div class="card-header">
          <h3>${escapeHtml(ws.name)}</h3>
          <span class="status status-${escapeHtml(ws.status)}">${escapeHtml(ws.status)}</span>
        </div>
        <p class="domain">${escapeHtml(ws.domain || 'Sem domínio')}</p>
        <p class="template">${escapeHtml(ws.template)}</p>
      </div>
    `).join('');
  } catch (error) {
    console.error('Erro ao carregar workspaces');
  }
}

// Criar workspace
document.getElementById('createForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const envRaw = document.getElementById('env').value;
  let envParsed = {};
  if (envRaw) {
    try {
      envParsed = JSON.parse(envRaw);
    } catch {
      alert('Variáveis de ambiente devem ser JSON válido');
      return;
    }
  }

  const data = {
    name: document.getElementById('name').value,
    repo_url: document.getElementById('repo_url').value,
    branch: document.getElementById('branch').value,
    template: document.getElementById('template').value,
    domain: document.getElementById('domain').value,
    env: envParsed,
    db_type: document.getElementById('db_type').value || null,
    db_name: document.getElementById('db_name').value || null,
    db_user: document.getElementById('db_user').value || null,
    db_password: document.getElementById('db_password').value || null,
    db_host: document.getElementById('db_host').value || null,
    db_port: document.getElementById('db_port').value ? parseInt(document.getElementById('db_port').value) : null
  };

  try {
    const response = await fetch(`${API_BASE}/api/workspaces`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(data)
    });

    if (response.ok) {
      hideCreateModal();
      loadWorkspaces();
    } else {
      const error = await response.json();
      alert(error.error || 'Erro ao criar workspace');
    }
  } catch (error) {
    alert('Erro de conexão');
  }
});

// Carregar workspace específico
async function loadWorkspace(id) {
  const token = checkAuth();
  if (!token) return;

  try {
    const response = await fetch(`${API_BASE}/api/workspaces/${id}`, {
      headers: authHeaders()
    });

    if (response.status === 401) {
      logout();
      return;
    }

    const ws = await response.json();

    document.getElementById('workspaceName').textContent = ws.name || '';
    document.getElementById('workspaceStatus').textContent = ws.status || '';
    document.getElementById('workspaceStatus').className = `status status-${ws.status || 'idle'}`;
    document.getElementById('repoUrl').textContent = ws.repo_url || '';
    document.getElementById('branch').textContent = ws.branch || '';
    document.getElementById('template').textContent = ws.template || '';
    document.getElementById('domain').textContent = ws.domain || '';

    loadDomains(id);
  } catch (error) {
    console.error('Erro ao carregar workspace');
  }
}

// Deploy
async function deploy() {
  const id = new URLSearchParams(window.location.search).get('id');

  try {
    const response = await fetch(`${API_BASE}/api/workspaces/${id}/deploy`, {
      method: 'POST',
      headers: authHeaders()
    });

    if (response.ok) {
      alert('Deploy iniciado com sucesso!');
      loadWorkspace(id);
      loadDeployments(id);
    } else {
      const error = await response.json();
      alert(error.error || 'Erro ao fazer deploy');
    }
  } catch (error) {
    alert('Erro de conexão');
  }
}

// Stop
async function stop() {
  const id = new URLSearchParams(window.location.search).get('id');

  if (!confirm('Tem certeza que deseja parar o workspace?')) return;

  try {
    const response = await fetch(`${API_BASE}/api/workspaces/${id}/stop`, {
      method: 'POST',
      headers: authHeaders()
    });

    if (response.ok) {
      alert('Workspace parado!');
      loadWorkspace(id);
    }
  } catch (error) {
    alert('Erro de conexão');
  }
}

// Carregar deploys
async function loadDeployments(id) {
  try {
    const response = await fetch(`${API_BASE}/api/workspaces/${id}/deployments`, {
      headers: authHeaders()
    });

    const deployments = await response.json();
    const container = document.getElementById('deploymentsList');

    if (!Array.isArray(deployments)) {
      container.innerHTML = '<p class="empty">Erro ao carregar deploys</p>';
      return;
    }

    container.innerHTML = deployments.map(d => `
      <div class="deployment-item">
        <span class="status status-${escapeHtml(d.status)}">${escapeHtml(d.status)}</span>
        <span class="commit">${escapeHtml(d.commit?.substring(0, 7) || 'N/A')}</span>
        <span class="date">${new Date(d.created_at).toLocaleString('pt-BR')}</span>
      </div>
    `).join('');

    const rollbackSelect = document.getElementById('rollbackCommit');
    if (rollbackSelect) {
      rollbackSelect.innerHTML = deployments.map(d =>
        `<option value="${escapeHtml(d.commit)}">${escapeHtml(d.commit?.substring(0, 7))} - ${new Date(d.created_at).toLocaleString('pt-BR')}</option>`
      ).join('');
    }
  } catch (error) {
    console.error('Erro ao carregar deploys');
  }
}

// Carregar logs
async function loadLogs() {
  const id = new URLSearchParams(window.location.search).get('id');

  try {
    const response = await fetch(`${API_BASE}/api/workspaces/${id}/logs`, {
      headers: authHeaders()
    });

    const data = await response.json();
    document.getElementById('logsContent').textContent = data.logs || 'Nenhum log disponível';
  } catch (error) {
    document.getElementById('logsContent').textContent = 'Erro ao carregar logs';
  }
}

// Rollback
async function rollback() {
  const id = new URLSearchParams(window.location.search).get('id');
  const commit = document.getElementById('rollbackCommit').value;

  if (!commit || !confirm('Tem certeza que deseja reverter para este commit?')) return;

  try {
    const response = await fetch(`${API_BASE}/api/workspaces/${id}/rollback`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ commit })
    });

    if (response.ok) {
      alert('Rollback realizado!');
      hideRollbackModal();
      loadWorkspace(id);
    } else {
      const error = await response.json();
      alert(error.error || 'Erro ao fazer rollback');
    }
  } catch (error) {
    alert('Erro de conexão');
  }
}

// Carregar domínios
async function loadDomains(id) {
  try {
    const response = await fetch(`${API_BASE}/api/workspaces/${id}`, {
      headers: authHeaders()
    });

    const ws = await response.json();
    const domains = Array.isArray(ws.domains) ? ws.domains.filter(Boolean) : [];

    document.getElementById('domainsList').innerHTML = domains.length > 0
      ? domains.map(d => `<li>${escapeHtml(d)}</li>`).join('')
      : '<li class="empty">Nenhum domínio configurado</li>';

    document.getElementById('modalDomainsList').innerHTML = domains.map(d => `
      <li>
        ${escapeHtml(d)}
        <button onclick="removeDomain('${escapeHtml(d)}')" class="btn btn-danger btn-small">Remover</button>
      </li>
    `).join('');
  } catch (error) {
    console.error('Erro ao carregar domínios');
  }
}

// Adicionar domínio
async function addDomain() {
  const id = new URLSearchParams(window.location.search).get('id');
  const domain = document.getElementById('newDomain').value;

  if (!domain) {
    alert('Informe o domínio');
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/api/workspaces/${id}/domains`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ domain })
    });

    if (response.ok) {
      document.getElementById('newDomain').value = '';
      loadDomains(id);
    } else {
      const error = await response.json();
      alert(error.error || 'Erro ao adicionar domínio');
    }
  } catch (error) {
    alert('Erro de conexão');
  }
}

// Remover domínio
async function removeDomain(domain) {
  const id = new URLSearchParams(window.location.search).get('id');

  if (!confirm(`Remover domínio ${domain}?`)) return;

  try {
    await fetch(`${API_BASE}/api/workspaces/${id}/domains/${encodeURIComponent(domain)}`, {
      method: 'DELETE',
      headers: authHeaders()
    });

    loadDomains(id);
  } catch (error) {
    alert('Erro de conexão');
  }
}

// Modal functions
function showCreateModal() {
  document.getElementById('createModal').style.display = 'block';
}

function hideCreateModal() {
  document.getElementById('createModal').style.display = 'none';
}

function showRollbackModal() {
  document.getElementById('rollbackModal').style.display = 'block';
}

function hideRollbackModal() {
  document.getElementById('rollbackModal').style.display = 'none';
}

function showDomainsModal() {
  document.getElementById('domainsModal').style.display = 'block';
}

function hideDomainsModal() {
  document.getElementById('domainsModal').style.display = 'none';
}
