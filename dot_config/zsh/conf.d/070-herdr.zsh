# Report Git working-tree status to Herdr's workspace sidebar.
_herdr_git_worktree_status() {
  [[ ${HERDR_ENV:-} == 1 && -n ${HERDR_WORKSPACE_ID:-} ]] || return
  (( $+commands[herdr] && $+commands[git] )) || return

  local repo line git_state
  repo=$(command git rev-parse --show-toplevel 2>/dev/null) || {
    command herdr workspace report-metadata "$HERDR_WORKSPACE_ID" \
      --source shell:git-worktree --clear-token git_worktree >/dev/null 2>&1
    return
  }

  local -i staged=0 modified=0 untracked=0 conflicted=0
  while IFS= read -r line; do
    case ${line[1,2]} in
      '??') (( untracked++ )); continue ;;
      'DD'|'AU'|'UD'|'UA'|'DU'|'AA'|'UU') (( conflicted++ )); continue ;;
    esac
    [[ ${line[1]} != ' ' ]] && (( staged++ ))
    [[ ${line[2]} != ' ' ]] && (( modified++ ))
  done < <(command git -C "$repo" status --porcelain=v1 --untracked-files=normal 2>/dev/null)

  local -a parts
  (( conflicted )) && parts+=("=${conflicted}")
  (( staged )) && parts+=("+${staged}")
  (( modified )) && parts+=("!${modified}")
  (( untracked )) && parts+=("?${untracked}")
  git_state=${(j: :)parts}
  [[ -n $git_state ]] || git_state=clean

  command herdr workspace report-metadata "$HERDR_WORKSPACE_ID" \
    --source shell:git-worktree --token "git_worktree=$git_state" >/dev/null 2>&1
}

autoload -Uz add-zsh-hook
add-zsh-hook precmd _herdr_git_worktree_status