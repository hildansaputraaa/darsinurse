
# ============================================================
# MAKEFILE
# Save as: Makefile (di root project)
# ============================================================

.PHONY: help build up down restart logs clean status health backup

help: ## Show this help message
	@echo "Darsinurse Gateway - Docker Commands"
	@echo "===================================="
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

build: ## Build all Docker images
	@echo "🔨 Building Docker images..."
	git fetch && git pull origin main
	docker compose build --no-cache
	@echo "✅ Build complete!"

up: ## Start all services
	@echo "🚀 Starting all services..."
	docker compose up -d
	@echo "✅ Services started!"
	@echo ""
	@echo "📍 Access URLs:"
	@echo "   - Rawat Jalan: http://localhost:4000"
	@echo "   - Monitoring:  http://localhost:5000"
	@echo "   - phpMyAdmin:  http://localhost:8080"
	@echo "   - Metabase:    http://localhost:3000"

down: ## Stop all services
	@echo "⏹️  Stopping all services..."
	docker compose down
	@echo "✅ Services stopped!"

restart: ## Restart all services
	@echo "🔄 Restarting services..."
	docker compose restart
	@echo "✅ Services restarted!"

restart-app: ## Restart only rawat-jalan
	docker compose restart darsinurse-app

restart-monitoring: ## Restart only monitoring
	docker compose restart darsinurse-monitoring

logs: ## Show logs (all services)
	docker compose logs -f

logs-app: ## Show logs (rawat-jalan only)
	docker compose logs -f darsinurse-app

logs-monitoring: ## Show logs (monitoring only)
	docker compose logs -f darsinurse-monitoring

logs-db: ## Show logs (database only)
	docker compose logs -f darsinurse-db

status: ## Show status of all services
	@echo "📊 Services Status:"
	@docker compose ps

health: ## Check health of all services
	@echo "🏥 Health Check:"
	@echo ""
	@echo "MySQL Database:"
	@docker exec darsinurse-db mysqladmin ping -h localhost -u root -proot123 && echo "  ✅ Healthy" || echo "  ❌ Unhealthy"
	@echo ""
	@echo "Rawat Jalan (Port 4000):"
	@curl -sf http://localhost:4000/health > /dev/null && echo "  ✅ Healthy" || echo "  ❌ Unhealthy"
	@echo ""
	@echo "Monitoring (Port 5000):"
	@curl -sf http://localhost:5000/health > /dev/null && echo "  ✅ Healthy" || echo "  ❌ Unhealthy"

clean: ## Stop and remove all containers, volumes, and images
	@echo "🧹 Cleaning up..."
	docker compose down -v --rmi all
	@echo "✅ Cleanup complete!"

backup: ## Backup MySQL database
	@echo "💾 Backing up database..."
	@mkdir -p backups
	@docker exec darsinurse-db mysqldump -u root -proot123 darsinurse > backups/darsinurse_$(shell date +%Y%m%d_%H%M%S).sql
	@echo "✅ Backup saved to: backups/darsinurse_$(shell date +%Y%m%d_%H%M%S).sql"

restore: ## Restore database from latest backup (use FILE=path/to/backup.sql to specify)
	@if [ -z "$(FILE)" ]; then \
		echo "❌ Please specify backup file: make restore FILE=backups/file.sql"; \
		exit 1; \
	fi
	@echo "📥 Restoring database from $(FILE)..."
	@docker exec -i darsinurse-db mysql -u root -proot123 darsinurse < $(FILE)
	@echo "✅ Database restored!"

shell-app: ## Open shell in rawat-jalan container
	docker exec -it darsinurse-app sh

shell-monitoring: ## Open shell in monitoring container
	docker exec -it darsinurse-monitoring sh

shell-db: ## Open MySQL shell
	docker exec -it darsinurse-db mysql -u root -proot123 darsinurse

install: ## Install dependencies locally (for development)
	@echo "📦 Installing dependencies..."
	cd rawat-jalan && npm install
	cd monitoring && npm install
	@echo "✅ Dependencies installed!"
