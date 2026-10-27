# Orla

Painel de controle web para Nginx (Reverse Proxy & Edge Manager), inspirado na
experiência da Cloudflare. Monólito em Node.js + React com PostgreSQL, instalado
nativamente no Debian 13.

A arquitetura completa está em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Status

Entrega iterativa em 5 etapas:

- [x] **Etapa 1:** arquitetura, `schema.prisma`, `nginx.conf` base, instalação no Debian 13
- [ ] **Etapa 2:** motor de templates, executor transacional e sanitização
- [ ] **Etapa 3:** API (Fastify, JWT, ACME, coletor de logs)
- [ ] **Etapa 4:** frontend base (layout, domínios, dashboard, proxy hosts)
- [ ] **Etapa 5:** SSL/TLS, regras, segurança, cache e live logs

## Instalação (Debian 13)

```bash
git clone https://github.com/efbecker/orla.git && cd orla
sudo ./deploy/install.sh
```

O instalador configura Nginx, PostgreSQL 17, o usuário `orla`, `/etc/orla/orla.env`
e as unidades systemd. Até a Etapa 3 ele instala o Nginx e o banco, mas o serviço do
painel só é habilitado quando o servidor existir.

Portas: `80/tcp`, `443/tcp`, `443/udp` (HTTP/3) e o painel em `81`.

## Desenvolvimento

```bash
npm install
export DATABASE_URL=postgresql://orla:senha@127.0.0.1:5432/orla?schema=public
npm run prisma:migrate:dev
```
