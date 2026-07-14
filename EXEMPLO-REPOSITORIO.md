# Exemplo de repositório para testar o Xpanel

Este é um exemplo de como estruturar um repositório para ser deployado pelo Xpanel.

## Estrutura para static-html

```
meu-site/
├── public/
│   ├── index.html
│   ├── css/
│   │   └── style.css
│   └── js/
│       └── script.js
└── README.md
```

## Estrutura para node-js

```
meu-app/
├── src/
│   └── index.js
├── package.json
├── .env (opcional)
└── README.md
```

## Variáveis de Ambiente

O Xpanel injeta automaticamente:

- `NODE_ENV=production`
- Variáveis customizadas do workspace

## Healthcheck

O Xpanel verifica se o serviço está respondendo na porta configurada.

## Deploy

1. Faça push para o GitHub
2. Crie um workspace no Xpanel
3. Configure o repositório e domínio
4. Clique em Deploy

## Rollback

Para reverter um deploy:

1. Acesse o workspace
2. Clique em Rollback
3. Selecione o commit desejado
4. Confirme

## Banco de Dados

Se configurado, o Xpanel permite:

- Testar conexão
- Visualizar tabelas
- Descrever estrutura
- Executar consultas SELECT

## Segurança

- Consultas SQL parametrizadas
- Senhas nunca expostas
- Isolamento entre workspaces
- Isolamento por usuário