#!/bin/bash

# Xpanel - Script de Setup
set -e

echo "=== Xpanel - Setup ==="

# Verificar Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker não encontrado. Instale o Docker primeiro."
    exit 1
fi

# Verificar Docker Swarm
if ! docker info --format '{{.Swarm.LocalNodeState}}' | grep -q "active"; then
    echo "🔧 Inicializando Docker Swarm..."
    docker swarm init
fi

# Criar rede overlay se não existir
if ! docker network ls | grep -q "xpanel-net"; then
    echo "🌐 Criando rede xpanel-net..."
    docker network create --driver overlay xpanel-net
fi

# Copiar .env se não existir
if [ ! -f .env ]; then
    echo "📋 Criando arquivo .env..."
    cp .env.example .env
    echo "⚠️  Edite o arquivo .env com suas configurações!"
fi

# Criar diretório de sites
echo "📁 Criando diretório de sites..."
sudo mkdir -p /home/xpanel/sites
sudo chmod -R 755 /home/xpanel/sites

echo ""
echo "✅ Setup concluído!"
echo ""
echo "Próximos passos:"
echo "1. Edite o arquivo .env com suas configurações"
echo "2. Execute: docker stack deploy -c docker-compose.xpanel.yml xpanel"
echo "3. Acesse: https://${XPANEL_DOMAIN:-xpanel.localhost}"
echo ""
echo "Documentação completa: README.md"