<#
  One release, four places that must agree.

    package.json version == npm latest == GitHub tag == GitHub Release

  Run from the repo root:

    $env:GITHUB_TOKEN = 'ghp_...'   # optional; without it the Release step is skipped
    .\release.ps1

  It refuses to continue when the tree is dirty, when the version is already
  published, or when the tag exists — a forced resync there would ship a version
  number that does not match its contents.

  The token is read from the environment, never from a parameter: an argument
  would land in the shell history and in the process list.
#>
[CmdletBinding()]
param(
  [switch]$SkipNpm,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

function Step($text) { Write-Host ""; Write-Host "== $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host $text -ForegroundColor Red; exit 1 }

# 1. Version and tag.
$version = (Get-Content ./package.json -Raw | ConvertFrom-Json).version
$tag = "v$version"
Write-Host "版本: $version" -ForegroundColor Green

# 2. Working tree must be clean: a release should be exactly what was reviewed.
$dirty = git status --porcelain
if ($dirty) {
  Write-Host $dirty
  Fail '工作区不干净，先提交'
}

# 3. Tag must not exist, and npm must not already have this version.
git rev-parse $tag *> $null
if ($LASTEXITCODE -eq 0) { Fail "tag $tag 已存在。要发新版就先改 package.json 的 version。" }

if (-not $SkipNpm) {
  npm view "dsh-one-click-polish@$version" version *> $null
  if ($LASTEXITCODE -eq 0) { Fail "npm 上已存在 $version。请先提升 package.json 的 version。" }
}

# 4. Syntax and encoding before anything leaves the machine.
Step '语法与编码'
node --check index.js
if ($LASTEXITCODE -ne 0) { Fail 'index.js 语法错误' }
node --check client.js
if ($LASTEXITCODE -ne 0) { Fail 'client.js 语法错误' }

$bad = @()
Get-ChildItem -Recurse -File |
  Where-Object { $_.FullName -notmatch '\\(\.git|node_modules)\\' -and $_.Extension -in '.js', '.json', '.md', '.yml', '.yaml', '.sh', '.ps1' } |
  ForEach-Object {
    $bytes = [System.IO.File]::ReadAllBytes($_.FullName)
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
      $bad += "BOM $($_.Name)"
    }
  }
if ($bad.Count -gt 0) { $bad | ForEach-Object { Write-Host $_ }; Fail '文件带 BOM' }
Write-Host '编码干净'

# 5. Runtime state must never be inside the package.
$leak = Get-ChildItem -File | Where-Object { $_.Name -like '.one-click-polish*.json' -or $_.Extension -eq '.tgz' }
if ($leak) {
  $leak.Name | ForEach-Object { Write-Host $_ }
  Fail '运行时文件在仓库里，先清掉'
}

if ($DryRun) {
  Write-Host ''
  Write-Host 'DryRun: 检查全部通过，没有推送或发布' -ForegroundColor Yellow
  exit 0
}

# 6. Push, tag, publish. The tag is created after the commit so it points at the
#    exact bytes npm receives.
Step '推送与发布'
git push
if ($LASTEXITCODE -ne 0) { Fail 'git push 失败' }

git tag -a $tag -m $tag
git push origin $tag
if ($LASTEXITCODE -ne 0) { Fail 'tag 推送失败' }

if ($SkipNpm) {
  Write-Host '  跳过 npm publish（-SkipNpm）'
} else {
  npm publish --access public
  if ($LASTEXITCODE -ne 0) { Fail 'npm publish 失败' }
}

Write-Host ''
Write-Host "发布完成: $tag" -ForegroundColor Green
Write-Host '  npm     https://www.npmjs.com/package/dsh-one-click-polish'

# 7. GitHub Release + tarball.
$token = $env:GITHUB_TOKEN
if (-not $token) {
  Write-Host '  release 跳过：没有设置 GITHUB_TOKEN'
  Write-Host '          用 $env:GITHUB_TOKEN = ''ghp_...''; .\release.ps1 重跑，或去网页手动创建'
  exit 0
}

$remote = git remote get-url origin
$repo = [regex]::Match($remote, '[:/]([^/]+/[^/]+?)(\.git)?$').Groups[1].Value
if (-not $repo) { Fail "无法从 origin 解析仓库名: $remote" }
Write-Host "  release $repo@$tag"

$headers = @{
  Authorization          = "token $token"
  'User-Agent'           = 'dsh-one-click-polish-release'
  Accept                 = 'application/vnd.github+json'
}

# Body from the commit subjects since the previous tag, so nobody retypes it.
$prev = git describe --tags --abbrev=0 "$tag^" 2>$null
$notes = if ($prev) {
  (git log --pretty=format:'- %s' "$prev..$tag^") -join "`n"
} else {
  (git log --pretty=format:'- %s' -n 20 "$tag^") -join "`n"
}
if (-not $notes) { $notes = "- $tag" }

$body = @{ tag_name = $tag; name = $tag; body = $notes; draft = $false; prerelease = $false } |
  ConvertTo-Json -Compress

$releaseId = $null
try {
  $existing = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/tags/$tag" -Headers $headers -TimeoutSec 30
  $releaseId = $existing.id
  Write-Host '  release 已存在，改为补传附件'
} catch {
  try {
    $created = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases" -Method Post `
      -Headers $headers -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) `
      -ContentType 'application/json' -TimeoutSec 60
    $releaseId = $created.id
    Write-Host '  release 已创建'
  } catch {
    Fail "release 创建失败: $($_.Exception.Message)"
  }
}

# Pack the same bytes npm received and attach them.
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("dsh-op-release-" + [guid]::NewGuid().ToString('n').Substring(0, 8))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
try {
  npm pack --pack-destination $tmp *> $null
  $tgz = Get-ChildItem $tmp -Filter '*.tgz' | Select-Object -First 1
  if (-not $tgz) { Fail 'npm pack 没有产出 tgz' }

  $bytes = [System.IO.File]::ReadAllBytes($tgz.FullName)
  $uploadUrl = "https://uploads.github.com/repos/$repo/releases/$releaseId/assets?name=$($tgz.Name)"
  try {
    Invoke-RestMethod -Uri $uploadUrl -Method Post `
      -Headers @{ Authorization = "token $token"; 'User-Agent' = 'dsh-one-click-polish-release' } `
      -ContentType 'application/gzip' -Body $bytes -TimeoutSec 180 | Out-Null
    Write-Host "  附件已上传: $($tgz.Name)  $($bytes.Length) bytes"
  } catch {
    if ($_.Exception.Message -match '422|already_exists') {
      Write-Host "  附件已存在: $($tgz.Name)"
    } else {
      Fail "附件上传失败: $($_.Exception.Message)"
    }
  }
} finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "  release https://github.com/$repo/releases/tag/$tag" -ForegroundColor Green
