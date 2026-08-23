# Claude Code Validation Hooks

This directory contains progressive validation hooks for Claude Code that improve agentic workflow reliability, reduce errors, and optimize context usage.

## Hook Scripts

### 1. validate-file-exists.sh
**Trigger:** `Read` operations

**What it does:**
- Checks if a file exists before attempting to read it
- Provides helpful suggestions when file is not found:
  - Lists similar files in the same directory
  - Suggests case-corrected filenames (e.g., `.JSON` vs `.json`)
  - Shows exact alternatives when available

**Benefits:**
- ✅ **Saves tokens** - Prevents failed Read operations that consume tokens
- ✅ **Saves time** - No waiting for error messages from failed reads
- ✅ **Better UX** - Immediate, actionable feedback with file suggestions
- ✅ **Reduces context noise** - Fewer error messages cluttering the conversation

**Example error prevented:**
```
❌ File not found: src/components/Button.tsx

💡 Similar files found:
   - src/components/button.tsx
   - src/components/Button.ts
```

---

### 2. warn-large-files.sh
**Trigger:** `Read` operations

**What it does:**
- Warns when reading files larger than 500 KB (configurable)
- Blocks files larger than 5 MB (configurable)
- Provides optimization suggestions for large files
- Detects non-human-readable file types (minified, lockfiles, logs)

**Configuration:**
Set environment variables to customize thresholds:
- `CLAUDE_FILE_SIZE_WARNING_KB` - Warning threshold (default: 500 KB)
- `CLAUDE_FILE_SIZE_ERROR_MB` - Blocking threshold (default: 5 MB)

```bash
export CLAUDE_FILE_SIZE_WARNING_KB=1000  # Warn at 1 MB
export CLAUDE_FILE_SIZE_ERROR_MB=10      # Block at 10 MB
```

**Benefits:**
- ✅ **Reduces token costs** - Large files consume massive amounts of tokens
- ✅ **Improves latency** - Smaller context = faster responses
- ✅ **Encourages efficiency** - Suggests better alternatives (grep, offset/limit)
- ✅ **Prevents bloat** - Stops accidental reads of massive files
- ✅ **Flexible** - Customize thresholds per project via environment

**Example warning:**
```
⚠️  Large file detected:
   File: package-lock.json
   Size: 1250 KB (1 MB)
   Lines: 45,000

💡 Consider:
   1. Reading specific sections using Read tool with offset/limit
   2. Using Grep tool to search for specific patterns
   3. These are auto-generated and rarely need manual inspection
```

---

### 3. validate-git-state.sh
**Trigger:** `Bash` operations (git commands)

**What it does:**
- Detects dangerous git operations (force push, reset --hard, clean -fd)
- Provides context-specific safety warnings
- Suggests safer alternatives for each dangerous command
- Warns about uncommitted changes before branch switching/merging

**Benefits:**
- ✅ **Prevents data loss** - Catches potentially destructive commands
- ✅ **Better practices** - Educates about safer alternatives (force-with-lease)
- ✅ **Workflow safety** - Warns about uncommitted changes before risky operations
- ✅ **Peace of mind** - Guardrails against common mistakes

**Example warning:**
```
⚠️  Potentially destructive command detected:
   git push --force origin main

Risk: Overwriting remote history, losing commits

💡 Safer alternatives:
   - git push --force-with-lease (respects remote changes)
   - git revert (create new commit to undo changes)

To proceed, re-run the command without hooks or confirm you understand the risk.
```

---

### 4. validate-path.sh
**Trigger:** `Write`, `Edit`, `MultiEdit` operations

**What it does:**
- Validates file paths for common mistakes:
  - Double slashes (`//`)
  - Leading/trailing spaces
  - Excessive parent directory references (`../../../..`)
- Checks if parent directories exist before writing
- Suggests similar directories when path is invalid

**Benefits:**
- ✅ **Prevents typos** - Catches path mistakes before execution
- ✅ **Saves time** - No cryptic "No such file or directory" errors
- ✅ **Helpful guidance** - Shows similar directories when path is wrong
- ✅ **Reduces frustration** - Clear error messages with actionable suggestions

**Example error prevented:**
```
❌ Directory does not exist: src/components/button

💡 Similar directories found:
   - src/components/Button
   - src/components/buttons

💡 To create the directory, run:
   mkdir -p src/components/button
```

---

### 5. validate-dependencies.sh
**Trigger:** `Bash` operations (make, npm, cargo, go, python)

**What it does:**
- Checks for project configuration files before build/test commands
- Verifies `node_modules` exists for npm/pnpm/yarn/bun commands
- Validates Makefile targets before running `make <target>`
- Validates npm/pnpm scripts exist before running

**Benefits:**
- ✅ **Prevents confusing errors** - Catches missing dependencies upfront
- ✅ **Saves debugging time** - Clear error messages instead of cryptic build failures
- ✅ **Validates commands** - Ensures Makefile targets and npm scripts exist
- ✅ **Helpful suggestions** - Shows available targets/scripts when requested one doesn't exist

**Example error prevented:**
```
⚠️  node_modules directory not found

💡 Run install first:
   pnpm install
```

```
⚠️  Makefile target not found: deploy

💡 Available targets:
   build
   test
   lint
   dev

Run 'make help' or 'make' without arguments to see all targets.
```

---

## Performance Impact

All hooks are optimized for speed:
- **Typical execution time:** 5-50ms per hook
- **Total overhead:** < 100ms per operation (well below threshold)
- **Timeout values:** Set to 3-5 seconds to prevent hangs

### Performance Debugging

Enable performance logging to track hook execution times:
```bash
export CLAUDE_HOOK_DEBUG=1
```

When enabled, each hook logs its execution time in milliseconds:
```
[PERF] validate-file-exists.sh executed in 12ms
[PERF] warn-large-files.sh executed in 8ms
```

This helps identify slow hooks and optimize workflow performance.

## Maintenance

### Adding new hooks
1. Create script in `~/.claude/hooks/`
2. Make it executable: `chmod +x script.sh`
3. Add entry to `settings.json` under appropriate `matcher`

### Testing hooks
Test hooks manually by setting `CLAUDE_TOOL_INPUT`:
```bash
export CLAUDE_TOOL_INPUT='{"file_path":"test.txt"}'
~/.claude/hooks/validate-file-exists.sh
```

### Disabling hooks temporarily
Comment out the hook entry in `settings.json` or remove the entire matcher block.

### Shared Utility Libraries

Hooks use shared libraries in `lib/` to reduce duplication and maintain consistency:

#### `lib/suggestions.sh`
Provides fuzzy matching and suggestion utilities:
- `suggest_similar_files()` - Find similar files by name
- `suggest_similar_directories()` - Find similar directories by name
- `check_extension_variants()` - Check for case mismatches in file extensions
- `format_suggestions()` - Format suggestions for display

#### `lib/performance.sh`
Provides performance tracking utilities:
- `init_performance_tracking()` - Start timing hook execution
- `log_performance()` - Log execution time on exit
- `log_checkpoint()` - Log intermediate checkpoints

These utilities are automatically sourced by hooks and include fallback implementations if the library is unavailable.

## Future Enhancements

Potential additions to consider:
- Context compression hooks (summarize frequently-read files)
- Workflow orchestration (phase validation for plan:implement)
- Custom project-specific validations
- Analytics and observability (track error patterns)

## Troubleshooting

### Hook not executing
- Check file permissions: `ls -la ~/.claude/hooks/`
- Verify path in `settings.json` matches actual location
- Check hook timeout value (may be too low)

### Hook blocking valid operations
- Review hook logic for false positives
- Add exceptions for specific cases
- Adjust thresholds (e.g., file size limits)

### Hook performance issues
- Profile execution time: `time ~/.claude/hooks/hook-name.sh`
- Optimize expensive operations (find, jq, etc.)
- Increase timeout if needed (but avoid > 5 seconds)
