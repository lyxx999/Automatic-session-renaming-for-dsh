# 提权执行侧边栏补丁（UAC 弹窗由用户确认）。任何情况下都把结果落到 profile 目录：
# 成功 → repatch.done.json（脚本内写）；运行痕迹 → repatch.log；未运行 → 两个文件都没有。
# 路径解析：$env:DSH_HOME 或 %USERPROFILE%\.dsh。
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$root = Join-Path $dshHome 'profiles\session-autotitle'
$log = Join-Path $root 'repatch.log'
"elevated wrapper started at $(Get-Date -Format o)" | Out-File -FilePath $log -Encoding utf8
node (Join-Path $root 'scripts\repatch-sidebar.mjs') 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
"elevated wrapper finished at $(Get-Date -Format o) exit=$LASTEXITCODE" | Out-File -FilePath $log -Append -Encoding utf8
