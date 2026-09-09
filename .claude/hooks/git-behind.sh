#!/usr/bin/env bash
# SessionStart hook: fetch the remote, then warn if this checkout is behind it.
#
# Why this exists: origin/main is a CACHED local ref. Without a fetch,
# `git status` reports "in sync with origin/main" on a machine that simply
# has not looked. The user works one repo from two laptops, so that false
# "in sync" is the default state on whichever laptop did not do the work.
#
# Warn only. Never pulls, never touches the working tree.

# Not a git repo, or no upstream branch: nothing to say.
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null) || exit 0
[ -n "$upstream" ] || exit 0

# Offline, or no remote: stay silent rather than nag.
git fetch --quiet origin 2>/dev/null || exit 0

behind=$(git rev-list --count "HEAD..$upstream" 2>/dev/null) || exit 0
[ "${behind:-0}" -gt 0 ] || exit 0

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)

# A pull into a dirty tree is the one way this warning could cause harm.
dirty=""
if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
  dirty=" You have uncommitted changes - commit or stash them first."
fi

printf '{"systemMessage":"BEHIND: %s is %s commit(s) behind %s. Run: git pull%s","hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"This checkout is %s commits behind %s. Work exists on the remote that this machine has not pulled - most likely from the user other laptop. Tell the user to run git pull before doing anything here, and do not describe the tree as current.%s"}}\n' \
  "$branch" "$behind" "$upstream" "$dirty" \
  "$behind" "$upstream" "$dirty"
