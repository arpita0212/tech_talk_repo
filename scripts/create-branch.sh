#!/usr/bin/env bash
#
# Create a new branch with a validated Jira ticket ID.
# Usage: ./scripts/create-branch.sh PINTRANET-55 add-login-page
#        → Creates branch: feature/PINTRANET-55-add-login-page
#
# Validates that the ticket exists in Jira before creating the branch.

if [ -z "$1" ]; then
    echo "" >&2
    echo "Usage: $0 <TICKET-ID> [branch-description]" >&2
    echo "  Example: $0 PINTRANET-55 add-login-page" >&2
    echo "" >&2
    exit 1
fi

TICKET_ID="$1"
DESCRIPTION="${2:-work}"

# Validate ticket ID format
TICKET_REGEX='^[A-Z][A-Z0-9]+-[0-9]+$'
if ! echo "$TICKET_ID" | grep -qE "$TICKET_REGEX"; then
    echo "" >&2
    echo "❌ Invalid ticket ID format: $TICKET_ID" >&2
    echo "   Expected format: PROJ-123 (uppercase letters, hyphen, digits)" >&2
    echo "" >&2
    exit 1
fi

# Load credentials
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -n "$PROJECT_ROOT" ] && [ -f "$PROJECT_ROOT/.env" ]; then
    export $(grep -v '^#' "$PROJECT_ROOT/.env" | grep -v '^\s*$' | xargs) 2>/dev/null
fi

if [ -z "$JIRA_BASE_URL" ] || [ -z "$JIRA_EMAIL" ] || [ -z "$JIRA_API_TOKEN" ]; then
    echo "⚠️  Jira credentials not configured. Creating branch without validation." >&2
    BRANCH_NAME="feature/${TICKET_ID}-${DESCRIPTION}"
    git checkout -b "$BRANCH_NAME"
    exit $?
fi

# Validate ticket exists in Jira
echo "[jira-hook] Validating $TICKET_ID in Jira..."

HTTP_RESPONSE=$(curl -s -w "\n%{http_code}" \
    -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
    -H "Accept: application/json" \
    "$JIRA_BASE_URL/rest/api/3/issue/$TICKET_ID?fields=summary,status" \
    --max-time 5)

HTTP_BODY=$(echo "$HTTP_RESPONSE" | head -n -1)
HTTP_STATUS=$(echo "$HTTP_RESPONSE" | tail -1)

if [ "$HTTP_STATUS" = "200" ]; then
    TICKET_SUMMARY=$(echo "$HTTP_BODY" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.fields.summary);" 2>/dev/null)
    TICKET_STATUS=$(echo "$HTTP_BODY" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.fields.status.name);" 2>/dev/null)

    echo "[jira-hook] ✅ Ticket found: $TICKET_ID - $TICKET_SUMMARY (Status: $TICKET_STATUS)"

    # Create the branch
    BRANCH_NAME="feature/${TICKET_ID}-${DESCRIPTION}"
    git checkout -b "$BRANCH_NAME"

    if [ $? -eq 0 ]; then
        echo "[jira-hook] ✅ Branch created: $BRANCH_NAME"
        echo "[jira-hook] You can now commit with: $TICKET_ID: your description"
    fi
elif [ "$HTTP_STATUS" = "404" ]; then
    echo "" >&2
    echo "❌ Branch not created: ticket $TICKET_ID does not exist in Jira." >&2
    echo "   Double-check the ticket ID and try again." >&2
    echo "" >&2
    exit 1
else
    echo "❌ Jira API error ($HTTP_STATUS). Cannot validate ticket." >&2
    exit 1
fi
