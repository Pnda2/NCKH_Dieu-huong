param(
    [int]$MaxIterations = 10,
    [int]$StallLimit = 3
)

$ErrorActionPreference = "Stop"
$RepoRoot = (git rev-parse --show-toplevel 2>$null)
if (-not $RepoRoot) {
    throw "Run this script inside the WiEvac Git repository."
}
Set-Location $RepoRoot

$expectedBranch = "agent/phase1-evacuation-optimization"
$currentBranch = (git branch --show-current).Trim()
if ($currentBranch -ne $expectedBranch) {
    throw "Expected branch '$expectedBranch' but current branch is '$currentBranch'. Switch branches first."
}

if (-not (Get-Command codex -ErrorAction SilentlyContinue)) {
    throw "Codex CLI was not found. Install/sign in to Codex first, then run this script again."
}

$stateDir = Join-Path $RepoRoot ".codex-loop"
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

$protected = @(
    "AGENTS.md",
    "scripts/agent_goal.md",
    "scripts/evaluate_phase1.py",
    "scripts/codex_loop.ps1"
)

function Restore-ProtectedFiles {
    foreach ($p in $protected) {
        git cat-file -e "HEAD:$p" 2>$null
        if ($LASTEXITCODE -eq 0) {
            git restore --source=HEAD --worktree -- $p 2>$null
        }
    }

    # Existing tests are quality gates. Restore tracked test changes made by an iteration.
    $changed = @(git diff --name-only)
    foreach ($p in $changed) {
        if ($p -match '(^|/)test_[^/]*\.py$' -or $p -match '\.test\.js$') {
            git restore --source=HEAD --worktree -- $p 2>$null
        }
    }
}

function Run-Evaluator {
    & python scripts/evaluate_phase1.py
    return $LASTEXITCODE
}

function Get-Report {
    $path = Join-Path $stateDir "evaluation.json"
    if (Test-Path $path) {
        return Get-Content $path -Raw
    }
    return '{"status":"FAIL","score":0,"reason":"No evaluator report"}'
}

Write-Host "WiEvac Codex autonomous loop"
Write-Host "Branch: $currentBranch"
Write-Host "Max iterations: $MaxIterations | Stall limit: $StallLimit"
Write-Host ""

# Require setup files to be committed so protected gates can always be restored.
foreach ($p in $protected) {
    git cat-file -e "HEAD:$p" 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "'$p' is not committed. Commit the setup files once before starting the autonomous loop."
    }
}

$bestScore = -1
$stallCount = 0

for ($iteration = 0; $iteration -le $MaxIterations; $iteration++) {
    Write-Host ""
    Write-Host "========== EVALUATION $iteration =========="
    $evalExit = Run-Evaluator
    $reportText = Get-Report
    $report = $reportText | ConvertFrom-Json
    $score = [int]$report.score

    if ($evalExit -eq 0 -and $report.status -eq "PASS") {
        Write-Host ""
        Write-Host "SUCCESS: all Phase 1 quality gates passed ($score/100)."
        Write-Host "Review 'git diff' before committing/pushing."
        exit 0
    }

    if ($iteration -eq $MaxIterations) {
        Write-Host "STOP: reached MaxIterations=$MaxIterations with score $score/100."
        exit 2
    }

    if ($score -gt $bestScore) {
        $bestScore = $score
        $stallCount = 0
    } else {
        $stallCount++
        if ($stallCount -ge $StallLimit) {
            Write-Host "STOP: evaluator has not improved for $StallLimit consecutive rounds. Best score: $bestScore/100."
            exit 3
        }
    }

    $goal = Get-Content "scripts/agent_goal.md" -Raw
    $prompt = @"
You are iteration $($iteration + 1) of the WiEvac Phase 1 autonomous repair loop.

Read and obey AGENTS.md and scripts/agent_goal.md.

CURRENT EVALUATOR REPORT:
$reportText

TASK FOR THIS ITERATION:
- Diagnose the evaluator failures and inspect the relevant implementation.
- Fix root causes in production code.
- Preserve D* Lite and the scientific/Phase 1 contract.
- Do not modify protected evaluator, goal, AGENTS.md, existing Python test_*.py files, or existing *.test.js files.
- Do not push/merge/commit or rewrite Git history.
- Run focused checks as useful.
- Before returning, run: python scripts/evaluate_phase1.py
- If everything passes, report exactly what changed and why.
- If not everything passes, leave the repository in a strictly better coherent state and report remaining failures.

Do not weaken validation or tests to obtain a passing score.

GOAL:
$goal
"@

    $lastMessage = Join-Path $stateDir "codex-last-message.txt"
    Write-Host ""
    Write-Host "========== CODEX ITERATION $($iteration + 1) =========="
    $prompt | codex exec --sandbox workspace-write --output-last-message $lastMessage -
    $codexExit = $LASTEXITCODE

    Restore-ProtectedFiles

    if ($codexExit -ne 0) {
        Write-Host "Codex exited with code $codexExit. The loop will evaluate current state once more."
    }
}

exit 4
