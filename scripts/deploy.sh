#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE="deploy/deploy.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "設定ファイルが見つかりません: $ENV_FILE" >&2
  echo "deploy/deploy.env.example をコピーして値を埋めてください。" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${PI_HOST:?deploy/deploy.env に PI_HOST を設定してください}"
: "${PI_USER:?deploy/deploy.env に PI_USER を設定してください}"
: "${PI_PATH:?deploy/deploy.env に PI_PATH を設定してください}"

npm run package
rsync -avz release/ "${PI_USER}@${PI_HOST}:${PI_PATH}/"
