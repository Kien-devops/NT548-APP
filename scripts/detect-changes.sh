#!/bin/bash
# ==============================================================================
# detect-changes.sh — Git-based change detection for NT548-APP monorepo
#
# Identifies which microservices / components changed between commits.
# Compatible with local git, bare clones, and AWS CodeBuild environments.
# ==============================================================================
set -euo pipefail

TARGET_COMMIT="${1:-${CODEBUILD_RESOLVED_SOURCE_VERSION:-HEAD}}"
BASE_COMMIT="${2:-}"
OUTPUT_JSON="${3:-changed_components.json}"
OUTPUT_ENV="${4:-changed_components.env}"

echo "=================================================="
echo "🔍 [CHANGE-DETECTOR] Monorepo Change Detection"
echo "Target Commit : $TARGET_COMMIT"
echo "Base Commit   : ${BASE_COMMIT:-<auto-detect>}"
echo "=================================================="

# Default all components to false
FRONTEND_CHANGED=false
USER_CHANGED=false
PRODUCT_CHANGED=false
ORDER_CHANGED=false
DATABASE_CHANGED=false
SHARED_CHANGED=false
DOCS_ONLY=true
DIFF_SUCCESS=false
CHANGED_FILES=""

# Helper function to inspect git diff
get_changed_files() {
    # 1. Inside existing working tree with .git
    if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        if [ -n "$BASE_COMMIT" ]; then
            git diff --name-only "$BASE_COMMIT" "$TARGET_COMMIT" 2>/dev/null && return 0
        fi

        # Check if target commit has a parent commit
        if git rev-parse "${TARGET_COMMIT}~1" >/dev/null 2>&1; then
            # Handle merge commits with -m or standard commit diff
            git diff-tree --no-commit-id --name-only -r -m "$TARGET_COMMIT" 2>/dev/null && return 0
        fi

        # If it's a branch or HEAD without parent, check against origin/main or origin/dev if available
        for base_branch in origin/main origin/dev main dev; do
            if git rev-parse "$base_branch" >/dev/null 2>&1 && [ "$(git rev-parse "$base_branch")" != "$(git rev-parse "$TARGET_COMMIT")" ]; then
                git diff --name-only "$base_branch" "$TARGET_COMMIT" 2>/dev/null && return 0
            fi
        done

        # Single commit root / initial commit
        git diff-tree --no-commit-id --name-only -r --root "$TARGET_COMMIT" 2>/dev/null && return 0
    fi

    # 2. Outside git working tree (e.g. CodePipeline artifact extraction)
    # Clone shallow bare repository to inspect commit metadata
    local repo_url="https://github.com/Kien-devops/NT548-APP.git"
    local temp_git_dir="/tmp/nt548_app_git"
    rm -rf "$temp_git_dir"
    mkdir -p "$temp_git_dir"

    if git clone --bare --depth=10 "$repo_url" "$temp_git_dir" >/dev/null 2>&1; then
        if [ -n "$BASE_COMMIT" ]; then
            git --git-dir="$temp_git_dir" diff --name-only "$BASE_COMMIT" "$TARGET_COMMIT" 2>/dev/null && return 0
        fi

        if git --git-dir="$temp_git_dir" rev-parse "${TARGET_COMMIT}~1" >/dev/null 2>&1; then
            git --git-dir="$temp_git_dir" diff-tree --no-commit-id --name-only -r -m "$TARGET_COMMIT" 2>/dev/null && return 0
        fi

        git --git-dir="$temp_git_dir" diff-tree --no-commit-id --name-only -r --root "$TARGET_COMMIT" 2>/dev/null && return 0
    fi

    return 1
}

if CHANGED_FILES=$(get_changed_files); then
    DIFF_SUCCESS=true
else
    echo "⚠️ [CHANGE-DETECTOR] Could not determine commit diff safely. Falling back to rebuilding all components."
    DIFF_SUCCESS=false
fi

if [ "$DIFF_SUCCESS" = "true" ] && [ -n "$CHANGED_FILES" ]; then
    echo "📂 [CHANGE-DETECTOR] Detected changed files:"
    echo "$CHANGED_FILES" | sed 's/^/   • /'

    while IFS= read -r file; do
        [ -z "$file" ] && continue

        case "$file" in
            frontend/*)
                FRONTEND_CHANGED=true
                DOCS_ONLY=false
                ;;
            be-user-service/*)
                USER_CHANGED=true
                DOCS_ONLY=false
                ;;
            be-product-service/*)
                PRODUCT_CHANGED=true
                DOCS_ONLY=false
                ;;
            be-order-service/*)
                ORDER_CHANGED=true
                DOCS_ONLY=false
                ;;
            database/*)
                DATABASE_CHANGED=true
                DOCS_ONLY=false
                ;;
            buildspec/*|scripts/*|docker-compose.yml|.env.example)
                SHARED_CHANGED=true
                DOCS_ONLY=false
                ;;
            README.md|*.md|docs/*)
                # Documentation change only
                ;;
            *)
                SHARED_CHANGED=true
                DOCS_ONLY=false
                ;;
        esac
    done <<< "$CHANGED_FILES"

    # If shared CI/CD scripts or pipeline configurations change, rebuild/test all services
    if [ "$SHARED_CHANGED" = "true" ]; then
        echo "🔄 [CHANGE-DETECTOR] Shared CI/CD files changed. Triggering all application components."
        FRONTEND_CHANGED=true
        USER_CHANGED=true
        PRODUCT_CHANGED=true
        ORDER_CHANGED=true
        DATABASE_CHANGED=true
    fi
elif [ "$DIFF_SUCCESS" = "false" ]; then
    # Safe fallback: rebuild all
    FRONTEND_CHANGED=true
    USER_CHANGED=true
    PRODUCT_CHANGED=true
    ORDER_CHANGED=true
    DATABASE_CHANGED=true
    DOCS_ONLY=false
else
    # Diff succeeded but changed files list is empty (e.g. empty commit or same tree)
    echo "ℹ️ [CHANGE-DETECTOR] No files changed in this revision."
    DOCS_ONLY=true
fi

# Print status summary
echo "--------------------------------------------------"
echo "📋 [CHANGE-DETECTOR] Component Status:"
echo "   frontend        : $FRONTEND_CHANGED"
echo "   user-service    : $USER_CHANGED"
echo "   product-service : $PRODUCT_CHANGED"
echo "   order-service   : $ORDER_CHANGED"
echo "   database        : $DATABASE_CHANGED"
echo "   docs-only       : $DOCS_ONLY"
echo "--------------------------------------------------"

# Write JSON output
cat <<EOF > "$OUTPUT_JSON"
{
  "targetCommit": "$TARGET_COMMIT",
  "baseCommit": "$BASE_COMMIT",
  "docsOnly": $DOCS_ONLY,
  "sharedChanged": $SHARED_CHANGED,
  "components": {
    "frontend": $FRONTEND_CHANGED,
    "user": $USER_CHANGED,
    "product": $PRODUCT_CHANGED,
    "order": $ORDER_CHANGED,
    "database": $DATABASE_CHANGED
  }
}
EOF

# Write environment file for sourcing in bash
cat <<EOF > "$OUTPUT_ENV"
export FRONTEND_CHANGED=$FRONTEND_CHANGED
export USER_CHANGED=$USER_CHANGED
export PRODUCT_CHANGED=$PRODUCT_CHANGED
export ORDER_CHANGED=$ORDER_CHANGED
export DATABASE_CHANGED=$DATABASE_CHANGED
export DOCS_ONLY=$DOCS_ONLY
export SHARED_CHANGED=$SHARED_CHANGED
EOF

echo "✅ [CHANGE-DETECTOR] Output written to $OUTPUT_JSON and $OUTPUT_ENV"
