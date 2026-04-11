#!/usr/bin/env bash
# Oracle 서버에서 1회만 실행하는 Nginx + Let's Encrypt 초기 설정 스크립트
# 사용법: bash setup-nginx.sh
set -euo pipefail

DOMAIN="api-battlehamster.cuteshrew.com"
EMAIL="${CERTBOT_EMAIL:-admin@cuteshrew.com}"  # 인증서 만료 알림 수신 이메일
NGINX_CONF_SRC="$(dirname "$0")/nginx-api.conf"
NGINX_CONF_DST="/etc/nginx/sites-available/api-battlehamster"

echo "=== [1/5] Nginx + Certbot 설치 ==="
sudo apt-get update -y
sudo apt-get install -y nginx certbot python3-certbot-nginx

echo "=== [2/5] Nginx 설정 배포 ==="
sudo cp "$NGINX_CONF_SRC" "$NGINX_CONF_DST"
sudo ln -sf "$NGINX_CONF_DST" /etc/nginx/sites-enabled/api-battlehamster
sudo rm -f /etc/nginx/sites-enabled/default   # 기본 사이트 비활성화

echo "=== [3/5] Nginx 문법 검사 ==="
sudo nginx -t

echo "=== [4/5] HTTP 상태로 Nginx 시작 (ACME 챌린지용) ==="
sudo systemctl enable nginx
sudo systemctl restart nginx

echo "=== [5/5] Let's Encrypt 인증서 발급 ==="
sudo certbot --nginx \
  -d "$DOMAIN" \
  --non-interactive \
  --agree-tos \
  -m "$EMAIL" \
  --redirect

echo ""
echo "✅ 완료! 아래 URL 로 접근 가능합니다:"
echo "   https://${DOMAIN}/health"
echo "   wss://${DOMAIN}/ws"
echo ""
echo "인증서는 90일마다 자동 갱신됩니다 (certbot 타이머 확인: systemctl status certbot.timer)"
