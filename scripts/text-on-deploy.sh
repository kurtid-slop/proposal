#!/bin/zsh
# Texts a phone through Messages on this Mac once a push to main has been
# deployed to GitHub Pages. Sends as an iMessage (free), or as an SMS through
# your iPhone if iMessage isn't set up.
#
#   scripts/text-on-deploy.sh <commit sha>   wait for that commit's deploy, then text
#   scripts/text-on-deploy.sh --test         send the text right now
#
# The number lives only in this Mac's git settings, not in the (public) repo:
#   git config notify.sms "+447700900123"   (example number)
# For a one-off message on the next push only:
#   git config notify.next "Albert added a new letter!!! https://..."
# The .git/hooks/pre-push hook runs this in the background after each push.
# Log: .git/text-on-deploy.log

cd "$(dirname "$0")/.." || exit 1
NUMBER=$(git config notify.sms)
SITE='https://kurtid-slop.github.io/proposal/'
MESSAGE="Albert added something new to the website: $SITE"
NEXT=$(git config notify.next)
[[ -n $NEXT ]] && MESSAGE=$NEXT

send_text() {
  osascript - "$NUMBER" "$MESSAGE" <<'APPLESCRIPT'
on run argv
  tell application "Messages"
    -- iMessage is free (over the internet); plain SMS through the iPhone is the
    -- fallback. Some accounts can't be read, so check them one by one.
    set imAccount to missing value
    set smsAccount to missing value
    repeat with i from 1 to (count accounts)
      try
        if enabled of account i then
          if service type of account i is iMessage then set imAccount to account i
          if service type of account i is SMS then set smsAccount to account i
        end if
      end try
    end repeat
    set via to imAccount
    if via is missing value then set via to smsAccount
    if via is missing value then error "no iMessage or SMS account in Messages"
    send (item 2 of argv) to participant (item 1 of argv) of via
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
    'completed success')
      if send_text; then
        echo "$(date '+%F %T') deployed, texted $NUMBER: $MESSAGE"
        [[ -n $NEXT ]] && git config --unset notify.next # one-off message used up
      fi
      exit ;;
    completed*) echo "$(date '+%F %T') deploy finished as '${RUN#completed }', no text"; exit ;;
  esac
done
echo "$(date '+%F %T') no finished deploy for $SHA, no text"
