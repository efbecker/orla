# Orla: arquitetura

Orla é um painel web para gerenciar o Nginx como proxy reverso e camada de borda,
com UX inspirada no dashboard da Cloudflare. A aplicação é um **monólito**: um
único processo Node.js (API REST + SPA + jobs em segundo plano) e o Nginx rodam no
mesmo contêiner, baseado em **Debian 13 (trixie)**.

## Princípios

1. **Banco de dados como fonte única da verdade.** Nenhum `.conf` existente é lido
   para reconstruir estado. Toda alteração parte do banco e é compilada para
   arquivos limpos e determinísticos.
2. **Pipeline transacional com rollback.** snapshot → escrita → `nginx -t` →
   `nginx -s reload` ou restauração do snapshot com o erro exato do Nginx.
   Comandos sempre via `execFile`, nunca via shell.
3. **Defesa contra config injection.** Todo valor que chega a um template passa por
   Zod + regex restritiva; `;`, `{`, `}`, `\n`, `$`, aspas e afins são rejeitados
   na borda da API e novamente no compilador.
4. **Sem privilégios.** Nginx e painel rodam como o usuário `orla`. O entrypoint
   usa root apenas para preparar volumes e depois faz `gosu orla`.

## Processo e contêiner

```
tini (PID 1, -g)
└── orla-entrypoint (bash, root)
    ├── nginx -g 'daemon off;'        (usuário orla)  → se sair, o contêiner sai
    └── loop de supervisão do painel   (usuário orla)  → reinicia o Node se cair
        └── node dist/server/index.js  (Fastify: API + SPA + jobs)
```

Uma queda do painel nunca derruba o tráfego de borda: o Nginx continua servindo com
a última configuração válida e o painel é reiniciado em 2 s.

Na inicialização o entrypoint:

1. cria os diretórios graváveis nos volumes;
2. gera um certificado autoassinado de fallback (usado apenas pelo listener QUIC
   padrão, já que o TCP recusa o handshake com `ssl_reject_handshake`);
3. inspeciona o build do Nginx e o kernel e grava em `/etc/nginx/orla/runtime/`:
   - `listen-default-http.conf` / `listen-default-https.conf` (IPv6 e QUIC só se
     suportados);
   - `capabilities.json` (`http3`, `ipv6`, `brotli`, `headersMore`, versão), lido
     pelo motor de templates para nunca gerar diretivas que o binário não suporta;
4. aplica as migrações (`prisma migrate deploy`);
5. roda `nginx -t`; se a configuração persistida estiver inválida, move os arquivos
   gerados para `/var/lib/orla/quarantine/<timestamp>/` e sobe só com os servidores
   padrão. Ao iniciar, o painel recompila tudo a partir do banco.

## Layout do Nginx

```
/etc/nginx/
├── nginx.conf                       estático (imagem): log JSON, zonas globais, defaults
├── modules-enabled/                 módulos Debian (brotli, headers-more)
├── conf.d/                          [volume] gerado
│   └── host-{id}.conf               um arquivo por Proxy Host (upstreams + servers)
└── orla/
    ├── default.d/00-default.conf    estático: servidores padrão 80/443 (ACME + 444)
    ├── snippets/                    estático: proxy-headers, websocket, acme-challenge,
    │                                block-bad-bots, edge-protection
    ├── runtime/                     gerado pelo entrypoint a cada boot
    └── generated/                   [volume] gerado pelo painel
        ├── http.d/                  limit_req_zone por regra de rate limit
        ├── ip-lists/list-{id}.conf  allow/deny reutilizáveis
        ├── htpasswd/realm-{id}      Basic Auth (bcrypt/apr1)
        ├── certs/{id}/              fullchain.pem + privkey.pem
        └── www/                     páginas de manutenção (503) por host
```

Variáveis globais definidas em `nginx.conf` e usadas pelos templates:

| Variável | Uso |
|---|---|
| `$orla_host_id` | definida com `set` em cada `server`; vai para o log JSON e permite atribuir tráfego ao host (0 = servidor padrão) |
| `$orla_upstream_connection` | `Connection` enviado ao upstream (keepalive ou `upgrade`) |
| `$orla_cache_status` | status do cache normalizado (`HIT`, `MISS`, `BYPASS`, `EXPIRED`, ..., `NONE`) |
| `$orla_cache_bypass_client`, `$orla_cache_bypass_auth` | `proxy_cache_bypass`/`proxy_no_cache` |
| `$orla_is_static` | detecção de estáticos para o modo de cache `STATIC_ONLY` |
| `$orla_bad_bot` | User-Agents de scanners conhecidos |

Zonas globais: `orla_global_req` (50 r/s por IP, usada pela proteção de borda),
`orla_global_conn`, `orla_ssl` (cache de sessão TLS) e `orla_cache` (proxy cache de
até 10 GB).

## Volumes

| Volume | Caminho | Conteúdo |
|---|---|---|
| `orla-data` | `/var/lib/orla` | SQLite (`data/orla.db`), webroot ACME, snapshots do pipeline, quarentena |
| `orla-hosts` | `/etc/nginx/conf.d` | `host-{id}.conf` |
| `orla-generated` | `/etc/nginx/orla/generated` | zonas, listas de IP, htpasswd, certificados, páginas |
| `orla-logs` | `/var/log/orla` | `nginx/access.json`, `nginx/error.log` |
| `orla-cache` | `/var/cache/orla` | proxy cache e arquivos temporários |

## Estrutura de pastas do repositório

O repositório é um único pacote npm (sem workspaces nem serviços separados). As
etapas indicam quando cada parte é entregue.

```
orla/
├── Dockerfile                       [1] imagem Debian 13: nginx + módulos + Node
├── docker-compose.yml               [1]
├── .env.example                     [1]
├── package.json                     [1] um único pacote (server + web)
├── docs/ARCHITECTURE.md             [1]
├── docker/
│   ├── entrypoint.sh                [1]
│   └── nginx/
│       ├── nginx.conf               [1]
│       └── orla/{default.d,snippets}[1]
├── prisma/
│   ├── schema.prisma                [1]
│   └── migrations/                  [1] migração inicial
├── server/                          [2][3]
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                 bootstrap (Fastify, jobs, sync inicial)
│       ├── app.ts                   registro de plugins e rotas
│       ├── config/env.ts            variáveis de ambiente validadas com Zod
│       ├── db/prisma.ts
│       ├── lib/                     crypto (AES-GCM), erros HTTP, hashing
│       ├── nginx/                   [2] motor de configuração
│       │   ├── sanitize.ts          validadores anti-injection (domínio, IP/CIDR, path, header)
│       │   ├── capabilities.ts      leitura de runtime/capabilities.json
│       │   ├── builder.ts           builder tipado de diretivas (escape e indentação)
│       │   ├── templates/           proxy, ssl, redirects, headers, rate-limit,
│       │   │                        upstreams, cache, access, maintenance
│       │   ├── compiler.ts          banco → conjunto de arquivos (determinístico)
│       │   └── executor.ts          snapshot, escrita, nginx -t, reload, rollback
│       ├── modules/                 [3] uma pasta por domínio: routes + schemas + service
│       │   ├── auth/  users/  settings/  audit/
│       │   ├── hosts/  upstreams/  locations/
│       │   ├── certificates/        ACME (acme-client: HTTP-01 e DNS-01) + upload
│       │   ├── redirects/  headers/
│       │   ├── security/            rate limits, listas de IP, Basic Auth, presets
│       │   ├── cache/               configuração e purge
│       │   ├── analytics/           métricas agregadas
│       │   └── logs/                live log viewer (SSE)
│       └── jobs/                    renovação de certificados, coletor de log JSON,
│                                    rotação de log e retenção de métricas
└── web/                             [4][5]
    ├── index.html
    ├── vite.config.ts
    └── src/
        ├── main.tsx  app/router.tsx
        ├── components/ui/           shadcn/ui
        ├── components/layout/       sidebar por domínio, topbar, tema dark/light
        ├── lib/                     cliente da API, TanStack Query, utilitários
        └── features/
            ├── auth/  dashboard/  hosts/  upstreams/       [4]
            └── ssl/  rules/  security/  caching/  logs/  audit/  settings/   [5]
```

## Modelo de dados (resumo)

| Área (aba) | Modelos |
|---|---|
| Painel | `User`, `Session`, `Setting` |
| Tráfego / DNS | `ProxyHost`, `HostDomain`, `UpstreamPool`, `UpstreamServer`, `Location` |
| SSL/TLS | `Certificate`, `CertificateDomain`, `AcmeAccount`, `DnsProvider` (campos de SSL ficam no `ProxyHost`) |
| Rules / Redirects | `RedirectRule`, `HeaderRule` |
| Security | `RateLimitRule`, `IpList`, `IpListEntry`, `HostIpList`, `LocationIpList`, `BasicAuthRealm`, `BasicAuthUser` |
| Caching & Speed | campos `cache*`, `gzip*`, `brotli*`, `clientMaxBodySizeMb` no `ProxyHost` |
| Analytics & Logs | `TrafficBucket` (por minuto), `TrafficTopEntry` (top IPs/paths por hora) |
| Auditoria | `AuditLog`, `Deployment` (histórico do pipeline) |

Decisões relevantes:

- IDs inteiros autoincrementais, porque nomeiam os arquivos (`host-{id}.conf`,
  `orla_pool_{id}`, `orla_rl_{id}`).
- Chaves privadas e credenciais de DNS são cifradas em repouso (AES-256-GCM com
  `ORLA_ENCRYPTION_KEY`) e só existem em claro no diretório de certificados do Nginx.
- Métricas usam `hostId` sem chave estrangeira para sobreviver à exclusão do host e
  contabilizar o servidor padrão (0).
- O schema evita recursos exclusivos do SQLite; migrar para PostgreSQL é trocar o
  `provider` e a `DATABASE_URL` e gerar uma nova migração.

## Modos de SSL

| Modo | Cliente → Nginx | Nginx → origem |
|---|---|---|
| Off | HTTP | conforme o pool |
| Flexible | HTTPS | HTTP |
| Full | HTTPS | HTTPS, `proxy_ssl_verify off` |
| Full (Strict) | HTTPS | HTTPS, `proxy_ssl_verify on` + `proxy_ssl_trusted_certificate` + SNI |

## Segurança de rede do painel

O painel escuta na porta 3000 do contêiner, publicada por padrão em `:81`. Em
produção, publique-o só em `127.0.0.1` ou num IP de VPN (`ORLA_PANEL_BIND`), ou
exponha-o através de um Proxy Host do próprio Orla com Basic Auth e lista de IPs.
