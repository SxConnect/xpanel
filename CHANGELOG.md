# Changelog

## [1.0.0] - 2024-01-01

### Adicionado

- Sistema de autenticação com JWT
- CRUD completo de workspaces
- Deploy via Docker Swarm
- Templates: static-html, node-js, nextjs, php, python
- Gerenciamento de domínios
- Rollback por commit
- Logs por workspace
- Banco de dados opcional por workspace
- Visualização de estrutura e tabelas
- Consultas controladas
- Healthcheck automático
- Integração com Traefik

### Melhorado

- Validação de repositório/branch
- Tratamento de erros
- Performance do deploy
- Isolamento entre workspaces

### Corrigido

- Caminhos de volumes nos templates
- Labels do Traefik
- Conexão com banco de dados