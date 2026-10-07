$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path $projectRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) { throw 'Run the setup commands in README.md first.' }
$backendPath = Join-Path $projectRoot 'backend'
$webPath = Join-Path $projectRoot 'web'
$backendProcess = Start-Process -FilePath $pythonPath -ArgumentList '-m uvicorn app.main:app --host 127.0.0.1 --port 8000' -WorkingDirectory $backendPath -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $projectRoot 'backend-server.log') -RedirectStandardError (Join-Path $projectRoot 'backend-errors.log')
$frontendProcess = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c npm.cmd run dev' -WorkingDirectory $webPath -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $projectRoot 'web-server.log') -RedirectStandardError (Join-Path $projectRoot 'web-errors.log')
Write-Host "PlantSense: http://127.0.0.1:3000 (backend PID $($backendProcess.Id), frontend launcher PID $($frontendProcess.Id))"
Write-Host 'Stop the corresponding processes after the demo. Logs are in the project root.'
