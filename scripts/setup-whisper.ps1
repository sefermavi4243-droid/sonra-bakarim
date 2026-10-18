# Yerel sesi yazıya dökme sunucusunu kurar (bir kez çalıştırılır).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$venv = Join-Path $root 'tools\whisper\.venv'
if (-not (Test-Path $venv)) { python -m venv $venv }
$py = Join-Path $venv 'Scripts\python.exe'
& $py -m pip install -q --upgrade pip
& $py -m pip install -q -r (Join-Path $root 'tools\whisper\requirements.txt')
# Python, DLL bağımlılıklarını PATH'te aramaz; çalışma zamanını ctranslate2'nin yanına koy.
$ct2 = Join-Path $venv 'Lib\site-packages\ctranslate2'
foreach ($dll in 'msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll') {
  Copy-Item (Join-Path $venv "Scripts\$dll") $ct2 -Force
}
& $py -c "import faster_whisper; print('faster-whisper', faster_whisper.__version__, 'hazir')"
