# Botu ve yerel Whisper sunucusunu sürekli çalışır tutar: çökerse 5 sn sonra yeniden başlatır.
# Günlükler: data\logs\bot.log ve data\logs\whisper.log
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$logs = Join-Path $root 'data\logs'
New-Item -ItemType Directory -Force $logs | Out-Null

function Start-Forever($name, $file, $arguments, $log) {
  Start-Job -Name $name -ArgumentList $root, $file, $arguments, $log -ScriptBlock {
    param($root, $file, $arguments, $log)
    Set-Location $root
    # Node ve Python UTF-8 yazar; konsolun OEM kod sayfasıyla okunursa Türkçe bozulur.
    [Console]::OutputEncoding = [Text.Encoding]::UTF8
    $env:PYTHONIOENCODING = 'utf-8'
    while ($true) {
      "$(Get-Date -Format s) başlıyor" | Out-File -Append -Encoding utf8 $log
      & $file @($arguments -split ' ') 2>&1 | ForEach-Object { "$_" } | Out-File -Append -Encoding utf8 $log
      "$(Get-Date -Format s) durdu (çıkış $LASTEXITCODE), 5 sn sonra yeniden" | Out-File -Append -Encoding utf8 $log
      Start-Sleep -Seconds 5
    }
  } | Out-Null
}

$whisperPy = Join-Path $root 'tools\whisper\.venv\Scripts\python.exe'
if (Test-Path $whisperPy) {
  Start-Forever 'whisper' $whisperPy '-u tools\whisper\server.py' (Join-Path $logs 'whisper.log')
}
Start-Forever 'bot' 'npx.cmd' 'tsx src/index.ts' (Join-Path $logs 'bot.log')

# Bu pencere kapanırsa işler de kapanır; başlangıçta gizli pencerede çalıştırılır.
Wait-Job -Name bot
