# Installiert (oder aktualisiert) den Kartengenerator unter Windows nach <Benutzerordner>\Kartengenerator
# und legt auf dem Desktop die Verknuepfung "Kartengenerator" an.
# Eigene Daten (Token, Stammliste, Schrift, Einstellungen) bleiben bei Updates erhalten.
# Nur ASCII-Zeichen verwenden: Windows PowerShell liest Dateien ohne Kennzeichnung sonst falsch.
$ErrorActionPreference = "Stop"
$quelle = $PSScriptRoot
$benutzer = [Environment]::GetFolderPath("UserProfile")
$ziel = Join-Path $benutzer "Kartengenerator"
New-Item -ItemType Directory -Force -Path $ziel | Out-Null

# Programmdateien kopieren; eigene Daten (.env, daten, .venv, .cache) bleiben unberuehrt
$ausnahmen = @(".venv", ".cache", "daten", "__pycache__", ".env")
Get-ChildItem -Path $quelle -Force | Where-Object {
    ($ausnahmen -notcontains $_.Name) -and ($_.Extension -notin @(".pdf", ".otf", ".ttf"))
} | ForEach-Object {
    $zielpfad = Join-Path $ziel $_.Name
    if (Test-Path $zielpfad) { Remove-Item -Recurse -Force $zielpfad }
    Copy-Item -Recurse -Force -Path $_.FullName -Destination $zielpfad
}

# Pinselschrift "Active" (urheberrechtlich geschuetzt, gehoert nicht ins Repository): liegt sie neben dem Installer,
# wird sie in den eigenen Datenordner uebernommen
$schrift = Get-ChildItem -Path $quelle -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "active*.otf" -or $_.Name -like "active*.ttf" } | Select-Object -First 1
if ($schrift) {
    New-Item -ItemType Directory -Force -Path (Join-Path $ziel "daten") | Out-Null
    Copy-Item -Force -Path $schrift.FullName -Destination (Join-Path $ziel ("daten\Active-Regular" + $schrift.Extension.ToLower()))
    Write-Host "Pinselschrift uebernommen: $($schrift.Name)"
}

# Dateien aus dem Internet sind in Windows "blockiert": Sperre aufheben (nur Windows)
try { Get-ChildItem -Path $ziel -Recurse -File | Unblock-File -ErrorAction SilentlyContinue } catch { }

# Verknuepfung auf dem Desktop (auch wenn der Desktop in OneDrive liegt)
if ($env:OS -eq "Windows_NT") {
    $desktop = [Environment]::GetFolderPath("Desktop")
    $verknuepfung = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desktop "Kartengenerator.lnk"))
    $verknuepfung.TargetPath = Join-Path $ziel "start.bat"
    $verknuepfung.WorkingDirectory = $ziel
    $verknuepfung.WindowStyle = 7   # minimiert: Das schwarze Fenster stoert nicht
    $verknuepfung.Description = "Kartengenerator von Munich Flavour"
    $verknuepfung.Save()
    Write-Host ""
    Write-Host "Fertig. Auf dem Desktop liegt jetzt die Verknuepfung 'Kartengenerator'."
} else {
    Write-Host ""
    Write-Host "Fertig (ohne Desktop-Verknuepfung, nur unter Windows)."
}
Write-Host "Der heruntergeladene Ordner kann nach dem ersten erfolgreichen Start geloescht werden."
Write-Host ""
$start = Read-Host "Jetzt starten? (J/N, Enter = ja)"
if ($start.Trim().ToLower() -notin @("n", "nein")) {
    & (Join-Path $ziel "start.bat")
}
