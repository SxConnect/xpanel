# xpanel
# Xpanel  Painel de deploy e hospedagem de workspaces por repositório GitHub + domínio.   Roda sobre Docker Swarm com Traefik. Cada workspace é uma stack separada, sem conflitos com outros serviços da VPS.
## Funcionalidades

### Autenticação
- Registro e login com JWT
- Cookies `httpOnly`, `secure` em produção e `sameSite=strict`
- Proteção contra força-bruta com lockout temporário
- Sessão por 24h

### Workspaces
- CRUD de workspaces
- Deploy automático a partir de repositório GitHub
- Templates pré-configurados:
  - `static-html`
  - `node-js`
  - `nextjs`
  - `php`
  - `python`
- Suporte a variáveis de ambiente por workspace
- Status: idle, deploying, active, stopped, error

### Domínios
- Domínio principal por workspace
- Adição e remoção de domínios/alias sem recriar o workspace
- Roteamento automático via Traefik por labels
- Suporte a HTTPS automático com Let's Encrypt

### Deploy e Operação
- `git clone` / `git pull` automatizado
- Deploy por stack Docker separada por workspace
- Healthcheck pós-deploy
- Logs por workspace
- Stop / Start / Rollback por commit ou tag
- Isolamento entre workspaces

### Banco de Dados por Workspace
- Configuração opcional por workspace:
  - tipo, nome, usuário, senha, host, porta
- Funcionalidades de banco:
  - testar conexão
  - listar tabelas
  - descrever estrutura de tabela
  - consultar dados com paginação
  - executar consultas SELECT controladas
- Senhas nunca são expostas nas respostas

### Observabilidade
- `/api/health` do painel
- Histórico de deployments por workspace
- Logs por serviço no Docker Swarm

## Arquitetura

```
VPS/Docker Swarm
└── Traefik
    └── Xpanel (stack própria)
        ├── PostgreSQL interno do painel
        └── Backend (Node.js)
            ├── Auth
            ├── Workspaces
            ├── Deploy
            ├── Domains
            ├── Database
            └── Settings
```

Cad novo workspace gera uma stack própria:
```
xpanel-<workspace-id>
└── web (Nginx / Node / PHP / Python / Next.js)
    └── bind mount /home/xpanel/sites/<workspace-id>
```

## Requisitos

- Docker Engine 20+
- Docker Swarm ativo
- Traefik rodando com acesso às redes overlay
- Rede overlay compartilhada `xpanel-net`
- Permitir bind de `/var/run/docker.sock` e `/home/xpanel/sites`

## Variáveis de Ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `DATABASE_URL` | Sim | conexão PostgreSQL do painel |
| `JWT_SECRET` | Sim | segredo para assinar tokens |
| `COOKIE_SECRET` | Sim | segredo para cookies |
| `NODE_ENV` | Não | `production` ou `development` |
| `XPANEL_DOMAIN` | Não | domínio principal do painel |
| `DOCKER_HOST` | Sim | `unix:///var/run/docker.sock` |

## Segurança

- Isolamento por workspace e usuário
- Validação de URL de repositório e branch antes do deploy
- Nomes de stacks e comandos Docker sanitizados para evitar injeção
- Senhas de banco dos workspaces ocultas nas respostas
- Cookies com flags de segurança em produção
- Lockout por tentativas de login
- Tokens JWT com expiração e assinatura própria

## Deploy em Produção

Este projeto foi pensado para ser executado como stack no Docker Swarm.  
Veja o arquivo `docker-compose.xpanel.yml` para exemplo de deploy.

Para criar o primeiro admin, use o registro via frontend ou insira diretamente no banco do painel com `role=admin`.

## Licença

Uso interno SxConnect.
