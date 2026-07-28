#!/bin/sh
# LB-33-B2 — live proof that the approval inbox RENDERS what it must.
#
# The API test proves the payload carries every question and answer. It cannot
# prove a human can read them, and "the data is in the response" is exactly the
# kind of proof-by-adjacency this project argues against. This drives a real
# browser at a real served page and asserts the text is on screen.
#
# Requires: agent-browser, and LOOPBREAKER_INBOX_URL pointing at a running
# server whose substrate has at least one premise awaiting approval.
set -e

URL="${LOOPBREAKER_INBOX_URL:?LOOPBREAKER_INBOX_URL is not set}"

command -v agent-browser >/dev/null 2>&1 || { echo "agent-browser is not installed"; exit 1; }

agent-browser open "$URL" >/dev/null
agent-browser wait 2000 >/dev/null

TEXT=$(agent-browser eval 'document.body.innerText' 2>/dev/null)

fail() { echo "FAIL: $1"; echo "--- rendered text ---"; echo "$TEXT" | head -40; exit 1; }

# The heading a founder needs to know what is being asked of them.
echo "$TEXT" | grep -qi "premise approval" || fail "no approval heading rendered"

# Every required shape field must be legible, not just present in JSON.
for FIELD in problem appetite "smallest slice" "non goals" "success signal" reversibility "decision owner" risks; do
  echo "$TEXT" | grep -qi "$FIELD" || fail "field '$FIELD' is not rendered"
done

# The question matters as much as the answer: an answer you cannot judge against
# its question is not reviewable.
echo "$TEXT" | grep -qi "what is\|who is\|how much\|what should" || fail "no interview question rendered"

# The act itself must be reachable.
echo "$TEXT" | grep -qi "approve the premise" || fail "no approve control rendered"

echo "inbox renders: heading, all eight fields, questions, and the approve control"
