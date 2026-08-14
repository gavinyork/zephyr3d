Add-Type -AssemblyName PresentationFramework

function Show-LauncherError([string]$Message) {
  [System.Windows.MessageBox]::Show(
    $Message,
    'Zephyr3D Editor (Dev)',
    [System.Windows.MessageBoxButton]::OK,
    [System.Windows.MessageBoxImage]::Error
  ) | Out-Null
}

$editorRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$launcherPath = (Resolve-Path (Join-Path $PSScriptRoot 'launch-electron-dev.cjs')).Path
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue

if (-not $nodeCommand) {
  Show-LauncherError 'Node.js was not found in PATH. Install Node.js first, then rerun the shortcut.'
  exit 1
}

try {
  # Enable preview-window DevTools for the development desktop shortcut only.
  $env:ZEPHYR_PREVIEW_DEVTOOLS = '1'
  $process = Start-Process -FilePath $nodeCommand.Source -ArgumentList @($launcherPath) -WorkingDirectory $editorRoot -WindowStyle Hidden -PassThru
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) {
    Show-LauncherError 'The Zephyr3D Editor dev launcher failed. Check the launcher log under %LOCALAPPDATA%\Zephyr3DEditor\dev-runtime.'
    exit $process.ExitCode
  }
} catch {
  Show-LauncherError ("Failed to launch the Zephyr3D Editor dev runtime.`n`n{0}" -f $_.Exception.Message)
  exit 1
}
