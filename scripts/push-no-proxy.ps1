# 绕过代理推送 GitHub（不修改全局 git config）
# 用法：在项目根目录执行  .\scripts\push-no-proxy.ps1

$ErrorActionPreference = "Stop"

# 1. 清除当前会话的代理环境变量
$env:HTTP_PROXY = ""
$env:HTTPS_PROXY = ""
$env:ALL_PROXY = ""
$env:NO_PROXY = "*"

# 2. 进入项目根目录
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

# 3. 使用 SSH 远程（不走 git http.proxy）
$remoteUrl = "git@github.com:flashjose/HotHub.git"
$existing = git remote get-url origin 2>$null
if ($LASTEXITCODE -ne 0) {
    git remote add origin $remoteUrl
} elseif ($existing -ne $remoteUrl) {
    git remote set-url origin $remoteUrl
}

Write-Host "Remote: $remoteUrl"
Write-Host "Pushing via SSH (bypasses http.proxy)..."

# 4. SSH 推送，不受 http://127.0.0.1:7890 影响
git push -u origin main

if ($LASTEXITCODE -eq 0) {
    Write-Host "Done: https://github.com/flashjose/HotHub"
} else {
    Write-Host ""
    Write-Host "若提示 Repository not found，请先在 GitHub 网页创建空仓库："
    Write-Host "  https://github.com/new  -> 名称 HotHub -> 不要勾选 README"
    Write-Host "创建后重新运行本脚本即可。"
}
