# Orla

Painel de controle web para Nginx (Reverse Proxy & Edge Manager), inspirado na
experiência da Cloudflare. Monólito em Node.js + React rodando junto com o Nginx em
um único contêiner Debian 13.

A arquitetura completa está em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Status

Entrega iterativa em 5 etapas:

- [x] **Etapa 1:** arquitetura, `schema.prisma`, `nginx.conf` base, Docker
- [ ] **Etapa 2:** motor de templates, executor transacional e sanitização
- [ ] **Etapa 3:** API (Fastify, JWT, ACME, coletor de logs)
- [ ] **Etapa 4:** frontend base (layout, domínios, dashboard, proxy hosts)
- [ ] **Etapa 5:** SSL/TLS, regras, segurança, cache e live logs

A imagem Docker passa a buildar a partir da Etapa 3, quando o servidor existir.

## Execução

Requisitos: Debian 13 com Docker Engine e o plugin Compose.

```bash
cp .env.example .env    # preencha ORLA_JWT_SECRET, ORLA_ENCRYPTION_KEY e o admin
docker compose up -d --build
```

Portas: `80/tcp`, `443/tcp`, `443/udp` (HTTP/3) e o painel em `81`.

## Banco de dados

```bash
npm install
DATABASE_URL=file:./dev.db npm run prisma:migrate:dev
```
