#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MOBILE_DIR="${ROOT_DIR}/apps/unisat-wallet-mobile"

if [ -x "/opt/homebrew/opt/node@20/bin/node" ]; then
  export PATH="/opt/homebrew/opt/node@20/bin:${PATH}"
elif [ -x "/usr/local/opt/node@20/bin/node" ]; then
  export PATH="/usr/local/opt/node@20/bin:${PATH}"
fi

if [ ! -f "${MOBILE_DIR}/package.json" ]; then
  echo "Missing mobile repo at ${MOBILE_DIR}"
  echo "Clone the mobile repository into apps/unisat-wallet-mobile and re-run this script."
  exit 1
fi

echo "Installing workspace dependencies from ${ROOT_DIR}"
pnpm install

echo "Checking mobile build prerequisites"
"${MOBILE_DIR}/scripts/doctor.sh" --fix

echo "Bootstrap complete"
