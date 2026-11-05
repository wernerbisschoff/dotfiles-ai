# bard: cd into the worktree `bard specify` claims.
#
# A child process cannot change the parent shell's cwd, so the CLI prints
# `WORKTREE <path>` (or `REUSED <issue> <path>`). This wrapper reads that line
# back and cds. Every other subcommand runs untouched, so long drains keep a
# real tty and stream as usual.
bard() {
  if [[ ${1:-} != specify ]]; then
    command bard "$@"
    return
  fi

  # `path` is tied to PATH in zsh; a local of that name would unset it.
  local tmp rc target
  tmp=$(mktemp) || return 1
  command bard "$@" | tee "$tmp"
  rc=${pipestatus[1]}
  # `specify` exits 1 on reuse (ALREADY_CLAIMED) even though it names the
  # worktree, so a REUSED line overrides the exit code. A blocked run also
  # names a worktree, and must not move the shell.
  target=$(sed -n -e 's/^WORKTREE //p' -e 's/^REUSED [^ ]* //p' "$tmp" | tail -1)
  if [[ -n $target && -d $target ]] && { (( rc == 0 )) || grep -q '^REUSED ' "$tmp" }; then
    cd -- "$target"
  fi
  rm -f -- "$tmp"
  return rc
}
