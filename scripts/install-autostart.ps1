# Windows oturumu açılınca botu gizli pencerede başlatır (yönetici izni gerekmez).
# Kaldırmak için: scripts\uninstall-autostart.ps1
$root = Split-Path -Parent $PSScriptRoot
$startup = [Environment]::GetFolderPath('Startup')
$vbs = Join-Path $startup 'SonraBakarim.vbs'
$run = Join-Path $root 'scripts\run.ps1'
@"
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""$run""", 0, False
"@ | Out-File -Encoding ascii $vbs
Write-Output "Otomatik başlatma kuruldu: $vbs"
