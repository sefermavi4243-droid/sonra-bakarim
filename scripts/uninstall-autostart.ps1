# Otomatik başlatmayı kaldırır ve çalışan botu durdurur.
$vbs = Join-Path ([Environment]::GetFolderPath('Startup')) 'SonraBakarim.vbs'
Remove-Item $vbs -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.CommandLine -like '*sonra-bakarim*run.ps1*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Write-Output 'Otomatik başlatma kaldırıldı.'
