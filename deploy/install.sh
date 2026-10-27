#!/usr/bin/env bash
# Orla installer for Debian 13 (trixie). Idempotent: run it again to upgrade.
#
#   git clone https://github.com/efbecker/orla.git && cd orla
#   sudo ./deploy/install.sh
#
# Installs Nginx (+ brotli / headers-more modules), Node.js and PostgreSQL 17
# from the Debian repositories, creates the `orla` system user, the database,
# /etc/orla/orla.env with generated secrets, the Nginx base configuration, the
# systemd units, sudoers and logrotate rules, and builds the panel into
# /opt/orla.
set -Eeuo pipefail

readonly SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly DEPLOY_DIR="${SRC_DIR}/deploy"
readonly APP_DIR="/opt/orla"
readonly ETC_DIR="/etc/orla"
readonly ENV_FILE="${ETC_DIR}/orla.env"
readonly LIB_DIR="/usr/lib/orla"
readonly ORLA_USER="orla"
readonly DB_NAME="orla"
readonly DB_USER="orla"

log() {
    printf '\n==> %s\n' "$*"
}

die() {
    printf 'erro: %s\n' "$*" >&2
    exit 1
}

require_root() {
    [[ "${EUID}" -eq 0 ]] || die "execute como root (sudo ./deploy/install.sh)"
}

check_os() {
    # shellcheck source=/dev/null
    . /etc/os-release
    if [[ "${ID:-}" != "debian" || "${VERSION_ID:-}" != "13" ]]; then
        if [[ "${ORLA_SKIP_OS_CHECK:-0}" != "1" ]]; then
            die "Orla é suportado no Debian 13 (detectado: ${PRETTY_NAME:-desconhecido}). Use ORLA_SKIP_OS_CHECK=1 para ignorar."
        fi
    fi
}

install_packages() {
    log "Instalando pacotes do Debian"
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        nginx \
        libnginx-mod-http-brotli-filter \
        libnginx-mod-http-brotli-static \
        libnginx-mod-http-headers-more-filter \
        nodejs \
        npm \
        postgresql \
        openssl \
        ca-certificates \
        sudo \
        rsync \
        logrotate
}

create_user() {
    log "Criando usuário de sistema ${ORLA_USER}"
    if ! getent group "${ORLA_USER}" >/dev/null; then
        groupadd --system "${ORLA_USER}"
    fi
    if ! id -u "${ORLA_USER}" >/dev/null 2>&1; then
        useradd --system --gid "${ORLA_USER}" --home-dir /var/lib/orla \
            --no-create-home --shell /usr/sbin/nologin "${ORLA_USER}"
    fi
    # Nginx workers read the ACME webroot, htpasswd files and pages.
    usermod -a -G "${ORLA_USER}" www-data
}

setup_database() {
    log "Configurando PostgreSQL"
    systemctl enable --now postgresql

    local db_password=""
    if [[ -f "${ENV_FILE}" ]] && grep -q '^DATABASE_URL=' "${ENV_FILE}"; then
        if runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
            echo "Role ${DB_USER} e ${ENV_FILE} já existem; mantendo credenciais."
            ensure_database
            return
        fi
    fi

    db_password="$(openssl rand -hex 24)"
    if runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
        runuser -u postgres -- psql -v ON_ERROR_STOP=1 -v pw="${db_password}" <<SQL
ALTER ROLE ${DB_USER} WITH LOGIN PASSWORD :'pw';
SQL
    else
        runuser -u postgres -- psql -v ON_ERROR_STOP=1 -v pw="${db_password}" <<SQL
CREATE ROLE ${DB_USER} WITH LOGIN PASSWORD :'pw';
SQL
    fi
    ensure_database
    write_env_file "${db_password}"
}

ensure_database() {
    if ! runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
        runuser -u postgres -- createdb --owner="${DB_USER}" --encoding=UTF8 "${DB_NAME}"
    fi
}

write_env_file() {
    local db_password="$1"
    install -d -o root -g "${ORLA_USER}" -m 0750 "${ETC_DIR}"

    if [[ -f "${ENV_FILE}" ]]; then
        log "Atualizando DATABASE_URL em ${ENV_FILE}"
        sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://${DB_USER}:${db_password}@127.0.0.1:5432/${DB_NAME}?schema=public|" "${ENV_FILE}"
        return
    fi

    log "Gerando ${ENV_FILE}"
    local admin_password
    admin_password="$(openssl rand -base64 18 | tr -d '/+=')"
    umask 027
    sed \
        -e "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://${DB_USER}:${db_password}@127.0.0.1:5432/${DB_NAME}?schema=public|" \
        -e "s|^ORLA_JWT_SECRET=.*|ORLA_JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')|" \
        -e "s|^ORLA_ENCRYPTION_KEY=.*|ORLA_ENCRYPTION_KEY=$(openssl rand -base64 32 | tr -d '\n')|" \
        -e "s|^ORLA_ADMIN_PASSWORD=.*|ORLA_ADMIN_PASSWORD=${admin_password}|" \
        "${DEPLOY_DIR}/env/orla.env.example" >"${ENV_FILE}"
    chown root:"${ORLA_USER}" "${ENV_FILE}"
    chmod 0640 "${ENV_FILE}"

    printf '\nAdministrador inicial: %s\nSenha inicial:         %s\n(também em %s; troque após o primeiro login)\n' \
        "$(sed -n 's/^ORLA_ADMIN_EMAIL=//p' "${ENV_FILE}")" "${admin_password}" "${ENV_FILE}"
}

install_nginx_config() {
    log "Instalando configuração base do Nginx"
    if [[ ! -f /etc/nginx/nginx.conf.orla-original ]]; then
        cp -a /etc/nginx/nginx.conf /etc/nginx/nginx.conf.orla-original
    fi
    install -o root -g root -m 0644 "${DEPLOY_DIR}/nginx/nginx.conf" /etc/nginx/nginx.conf
    install -d -o root -g root -m 0755 /etc/nginx/orla /etc/nginx/orla/default.d /etc/nginx/orla/snippets
    rsync -a --delete --chown=root:root --chmod=D0755,F0644 \
        "${DEPLOY_DIR}/nginx/orla/default.d/" /etc/nginx/orla/default.d/
    rsync -a --delete --chown=root:root --chmod=D0755,F0644 \
        "${DEPLOY_DIR}/nginx/orla/snippets/" /etc/nginx/orla/snippets/
    # Orla's nginx.conf does not include sites-enabled; remove Debian's demo
    # site so nobody expects it to be served.
    rm -f /etc/nginx/sites-enabled/default
}

install_system_files() {
    log "Instalando unidades systemd, sudoers e logrotate"
    install -d -o root -g root -m 0755 "${LIB_DIR}" "${LIB_DIR}/bin"
    install -o root -g root -m 0755 "${DEPLOY_DIR}/bin/orla-nginx-prepare" "${LIB_DIR}/bin/orla-nginx-prepare"
    install -o root -g root -m 0755 "${DEPLOY_DIR}/bin/orla-cache-purge" "${LIB_DIR}/bin/orla-cache-purge"

    install -d -o root -g root -m 0755 /etc/systemd/system/nginx.service.d
    install -o root -g root -m 0644 "${DEPLOY_DIR}/systemd/nginx.service.d/orla.conf" \
        /etc/systemd/system/nginx.service.d/orla.conf
    install -o root -g root -m 0644 "${DEPLOY_DIR}/systemd/orla.service" /etc/systemd/system/orla.service

    local sudoers_tmp
    sudoers_tmp="$(mktemp)"
    cp "${DEPLOY_DIR}/sudoers/orla" "${sudoers_tmp}"
    visudo -cf "${sudoers_tmp}" >/dev/null || die "sudoers inválido"
    install -o root -g root -m 0440 "${sudoers_tmp}" /etc/sudoers.d/orla
    rm -f "${sudoers_tmp}"

    install -o root -g root -m 0644 "${DEPLOY_DIR}/logrotate/orla" /etc/logrotate.d/orla
    systemctl daemon-reload
}

build_app() {
    log "Instalando o painel em ${APP_DIR}"
    install -d -o root -g root -m 0755 "${APP_DIR}"
    rsync -a --delete \
        --exclude '.git' --exclude 'node_modules' --exclude 'dist' --exclude '.env' \
        "${SRC_DIR}/" "${APP_DIR}/"
    (
        cd "${APP_DIR}"
        npm ci --no-audit --no-fund
        npx prisma generate
        npm run build --if-present
        npm prune --omit=dev --no-audit --no-fund
    )
    chown -R root:root "${APP_DIR}"
    chmod -R u=rwX,go=rX "${APP_DIR}"
}

migrate_database() {
    log "Aplicando migrações do banco"
    (
        set -a
        # shellcheck source=/dev/null
        . "${ENV_FILE}"
        set +a
        cd "${APP_DIR}"
        runuser -u "${ORLA_USER}" -- ./node_modules/.bin/prisma migrate deploy
    )
}

start_services() {
    log "Iniciando serviços"
    systemctl enable nginx
    systemctl restart nginx

    if [[ -f "${APP_DIR}/dist/server/index.js" ]]; then
        systemctl enable orla
        systemctl restart orla
        echo "Painel: http://<ip-do-servidor>:$(sed -n 's/^ORLA_PANEL_PORT=//p' "${ENV_FILE}")"
    else
        echo "O servidor do painel ainda não foi compilado (dist/server/index.js ausente);"
        echo "orla.service será habilitado quando o build existir. Nginx já está ativo."
    fi
}

main() {
    require_root
    check_os
    install_packages
    create_user
    setup_database
    install_nginx_config
    install_system_files
    build_app
    migrate_database
    start_services
    log "Instalação concluída"
}

main "$@"
