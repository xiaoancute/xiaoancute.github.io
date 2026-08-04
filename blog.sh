#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$repo_dir"

if ! command -v node >/dev/null 2>&1; then
	echo "未找到 Node.js，请先安装 Node.js 22 或更高版本。"
	exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
	echo "未找到 pnpm，请先安装 pnpm。"
	exit 1
fi

if [[ ! -d node_modules ]]; then
	echo "首次运行，正在安装依赖..."
	pnpm install --frozen-lockfile
fi

exec node scripts/blog-helper.js "$@"
