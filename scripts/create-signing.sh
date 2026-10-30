#!/usr/bin/env bash
set -euo pipefail
set +x
TOOLS="${PEDIDOS_TOOLS_DIR:-$HOME/.local/share/pedidos-stock-tools}"
SIGNING="$TOOLS/signing"
umask 077
mkdir -p "$SIGNING"
chmod 700 "$SIGNING"
if [[ -f "$SIGNING/release.env" ]]; then
  echo "Existing production signing credentials retained: $SIGNING/release.env"
  exit 0
fi
[[ ! -f "$SIGNING/pedidos-stock-release.jks" ]] || { echo 'Keystore exists without release.env. Restore its credentials; refusing to replace it.'; exit 1; }
if [[ -z "${JAVA_HOME:-}" && "$(uname -s)" == Darwin ]]; then export JAVA_HOME="$(/usr/libexec/java_home -v 17)"; fi
export PATH="${JAVA_HOME:+$JAVA_HOME/bin:}$PATH"
export PEDIDOS_KEYSTORE_FILE="$SIGNING/pedidos-stock-release.jks"
export PEDIDOS_KEYSTORE_PASSWORD="$(openssl rand -hex 32)"
export PEDIDOS_KEY_PASSWORD="$PEDIDOS_KEYSTORE_PASSWORD"
export PEDIDOS_KEY_ALIAS=pedidos-stock
keytool -genkeypair -keystore "$PEDIDOS_KEYSTORE_FILE" -storetype PKCS12 -alias "$PEDIDOS_KEY_ALIAS" -keyalg RSA -keysize 4096 -validity 10000 -storepass:env PEDIDOS_KEYSTORE_PASSWORD -keypass:env PEDIDOS_KEY_PASSWORD -dname 'CN=Pedidos Stock, OU=Release, O=Pedidos Stock, C=AR' >/dev/null 2>&1
{
  printf 'export PEDIDOS_KEYSTORE_FILE=%q\n' "$PEDIDOS_KEYSTORE_FILE"
  printf 'export PEDIDOS_KEYSTORE_PASSWORD=%q\n' "$PEDIDOS_KEYSTORE_PASSWORD"
  printf 'export PEDIDOS_KEY_ALIAS=%q\n' "$PEDIDOS_KEY_ALIAS"
  printf 'export PEDIDOS_KEY_PASSWORD=%q\n' "$PEDIDOS_KEY_PASSWORD"
} > "$SIGNING/release.env"
chmod 600 "$PEDIDOS_KEYSTORE_FILE" "$SIGNING/release.env"
unset PEDIDOS_KEYSTORE_PASSWORD PEDIDOS_KEY_PASSWORD
echo "Production keystore created outside the repository: $SIGNING"
echo 'Back up that directory securely. The same key is required for future app updates.'
