#!/bin/bash

# Xpanel - Script de Deploy
set -e

echo "=== Xpanel - Deploy ==="

# Verificar se o .env existe
if [ ! -f .env ]; then
    echo "❌ Arquivo .env não encontrado!"
    echo "Execute: cp .env.example .env"
    exit 1
fi

# Carregar variáveis do .env
source .env

# Verificar se o Docker Swarm está ativo
if ! docker info --format '{{.Swarm.LocalNodeState}}' | grep -q "active"; then
    echo "❌ Docker Swarm não está ativo!"
    echo "Execute: docker swarm init"
    exit 1
fi

# Verificar se a rede existe
if ! docker network ls | grep -q "xpanel-net"; then
    echo "🌐 Criando rede xpanel-net..."
    docker network create --driver overlay xpanel-net
fi

# Criar diretório de sites
echo "📁 Criando diretório de sites..."
sudo mkdir -p /home/xpanel/sites
sudo chmod -R 755 /home/xpanel/sites

# Deploy do Xpanel
echo "🚀 Fazendo deploy do Xpanel..."
docker stack deploy -c docker-compose.xpanel.yml xpanel

echo ""
echo "✅ Deploy concluído!"
echo ""
echo "Acesse: https://${XPANEL_DOMAIN:-xpanel.localhost}"
echo ""
echo "Para verificar o status:"
echo "docker service ls"
echo "docker stack services xpanel"