#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Explicit existing project reference only. This script never creates a cloud project.
: "${SUPABASE_PROJECT_REF:?Set the reference of your existing Supabase project}"
if [[ ! "$SUPABASE_PROJECT_REF" =~ ^[a-z]{20}$ ]]; then
  echo 'Invalid project reference' >&2
  exit 1
fi
npx supabase link --project-ref "$SUPABASE_PROJECT_REF"
npx supabase db push --linked --dry-run
# Apply is deliberately opt-in: read the dry-run before rerunning with this flag.
if [[ "${1:-}" == '--apply' ]]; then
  npx supabase db push --linked
else
  echo 'Dry-run complete. Review migrations, then pass --apply to deploy.'
fi
