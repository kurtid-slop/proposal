#!/bin/zsh
# Texts a phone through Messages on this Mac (SMS via your iPhone) once a push
# to main has been deployed to GitHub Pages.
#
#   scripts/text-on-deploy.sh <commit sha>   wait for that commit's deploy, then text
#   scripts/text-on-deploy.sh --test         send the text right now
#
# The number lives only in this Mac's git settings, not in the (public) repo:
#   git config notify.sms "+447700900123"
# The .git/hooks/pre-push hook runs this in the background after each push.
# Log: .git/text-on-deploy.log

cd "$(dirname "$0")/.." || exit 1
NUMBER=$(git config notify.sms)
SITE='https://kurtid-slop.github.io/proposal/'
MESSAGE="Albert added something new to the website: $SITE"

send_text() {
  osascript - "$NUMBER" "$MESSAGE" <<'APPLESCRIPT'
on run argv
  tell application "Messages"
    -- some accounts can't be read, so look for the SMS one one by one
    set sms to missing value
    repeat with i from 1 to (count accounts)
      try
        if service type of account i is SMS and enabled of account i then set sms to account i
      end try
    end repeat
    if sms is missing value then error "no SMS account in Messages (turn on Text Message Forwarding on your iPhone)"
    send (item 2 of argv) to participant (item 1 of argv) of sms
  end tell
end run
APPLESCRIPT
}

if [[ -z $NUMBER ]]; then
  echo "no number set: git config notify.sms \"+44...\""
  exit 1
fi

if [[ $1 == --test ]]; then
  send_text && echo "sent to $NUMBER"
  exit
fi

SHA=$1
echo "$(date '+%F %T') waiting for the deploy of $SHA"
# give the push a moment to land, then wait up to ~10 minutes for the deploy
for _ in {1..60}; do
  sleep 10
  RUN=$(gh run list --workflow deploy.yml --commit "$SHA" --limit 1 --json status,conclusion --jq '.[0] | "\(.status) \(.conclusion)"' 2>/dev/null)
  case $RUN in
    'completed success') send_text && echo "$(date '+%F %T') deployed, texted $NUMBER"; exit ;;
    completed*) echo "$(date '+%F %T') deploy finished as '${RUN#completed }', no text"; exit ;;
  esac
done
echo "$(date '+%F %T') no finished deploy for $SHA, no text"
