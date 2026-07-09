#!/usr/bin/env bash
# Bateria de regresion completa de la PWA Partes de Locomocion.
# Uso (desde WSL/Linux):  bash tests/run_tests.sh
# Requiere: node + playwright (ver tests/README.md). Sirve el repo en :8899 si no hay ya un servidor.
set -u
cd "$(dirname "$0")/.."

PW_DIR="${PW_DIR:-$HOME/scratch/pw-prueba}"
if [ ! -d "$PW_DIR/node_modules/playwright" ]; then
  echo "ERROR: no se encuentra playwright en $PW_DIR/node_modules."
  echo "Instalalo con:  mkdir -p \"$PW_DIR\" && cd \"$PW_DIR\" && npm i playwright && npx playwright install chromium"
  echo "O indica otra ruta:  PW_DIR=/ruta bash tests/run_tests.sh"
  exit 1
fi
export NODE_PATH="$PW_DIR/node_modules"
command -v node >/dev/null 2>&1 || source "$HOME/.nvm/nvm.sh" 2>/dev/null

SRV_PID=""
if ! curl -s -o /dev/null --max-time 2 http://localhost:8899/index.html; then
  python3 -m http.server 8899 --bind 127.0.0.1 >/dev/null 2>&1 &
  SRV_PID=$!
  trap '[ -n "$SRV_PID" ] && kill $SRV_PID 2>/dev/null' EXIT
  sleep 1
fi

FALLOS=0
TOTAL=0
for t in tests/test_*.js; do
  TOTAL=$((TOTAL+1))
  echo ""
  echo "########## $t ##########"
  if ! node "$t"; then FALLOS=$((FALLOS+1)); fi
done

echo ""
echo "=================================================="
if [ "$FALLOS" -eq 0 ]; then
  echo "RESULTADO GLOBAL: los $TOTAL archivos de test PASARON"
else
  echo "RESULTADO GLOBAL: $FALLOS de $TOTAL archivos de test CON FALLOS — NO desplegar"
  exit 1
fi
