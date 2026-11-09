# Startet den Kartengenerator unter Windows. Wird von start.bat aufgerufen.
# - sucht Python (und installiert es beim ersten Mal ueber winget, falls es fehlt)
# - richtet beim ersten Mal die Programmumgebung (.venv) ein
# - fragt beim ersten Mal den Rentman API-Token ab
# Nur ASCII-Zeichen verwenden: Windows PowerShell liest Dateien ohne Kennzeichnung sonst falsch.
$ErrorActionPreference = "Stop"
$env:PYTHONUTF8 = "1"
Set-Location -Path $PSScriptRoot
try { $Host.UI.RawUI.WindowTitle = "Kartengenerator" } catch { }

function Finde-Python {
    # Rueckgabe: voller Pfad zu einem Python ab Version 3.10, sonst $null
    $kandidaten = @()
    foreach ($name in @("py", "python", "python3")) {
        $cmd = Get-Command $name -ErrorAction SilentlyContinue
        if ($cmd -and $cmd.Source) {
            $zusatz = @()
            if ($name -eq "py") { $zusatz = @("-3") }
            $kandidaten += , @($cmd.Source, $zusatz)
        }
    }
    $orte = @("$env:LOCALAPPDATA\Programs\Python\Python3*\python.exe", "$env:ProgramFiles\Python3*\python.exe")
    foreach ($ort in $orte) {
        Get-ChildItem -Path $ort -ErrorAction SilentlyContinue | Sort-Object Name -Descending | ForEach-Object {
            $kandidaten += , @($_.FullName, @())
        }
    }
    foreach ($k in $kandidaten) {
        try {
            $argumente = @($k[1]) + @("-c", "import sys; print(sys.version_info[0] * 100 + sys.version_info[1]); print(sys.executable)")
            $ausgabe = & $k[0] @argumente 2>$null
            if ($LASTEXITCODE -eq 0 -and $ausgabe -and $ausgabe.Count -ge 2 -and [int]$ausgabe[0] -ge 310) {
                return [string]$ausgabe[1]
            }
        } catch { }   # z. B. der Platzhalter von Microsoft Store: ignorieren
    }
    return $null
}

function Installiere-Python {
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) { return }
    Write-Host ""
    Write-Host "Python wird installiert (einmalig, dauert etwa 1 bis 2 Minuten) ..."
    & winget install -e --id Python.Python.3.12 --scope user --silent --accept-package-agreements --accept-source-agreements
}

$py = Finde-Python
if (-not $py) {
    Installiere-Python
    $py = Finde-Python
}
if (-not $py) {
    Write-Host ""
    Write-Host "Python (ab Version 3.10) wurde nicht gefunden und konnte nicht automatisch installiert werden."
    Write-Host "Bitte Python von https://www.python.org/downloads/ installieren."
    Write-Host "Wichtig: Im Installationsfenster unten den Haken 'Add python.exe to PATH' setzen."
    Write-Host "Danach diesen Starter noch einmal ausfuehren."
    exit 1
}

# Programmumgebung (einmalig) und benoetigte Pakete
$venvWin = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
$venvUnix = Join-Path $PSScriptRoot ".venv/bin/python"
if (-not (Test-Path $venvWin) -and -not (Test-Path $venvUnix)) {
    Write-Host "Erster Start: Das Programm wird eingerichtet (etwa 1 bis 2 Minuten) ..."
    & $py -m venv (Join-Path $PSScriptRoot ".venv")
    if ($LASTEXITCODE -ne 0) { Write-Host "Die Programmumgebung konnte nicht angelegt werden."; exit 1 }
}
$venvPy = if (Test-Path $venvWin) { $venvWin } else { $venvUnix }

$anforderungen = Get-Content -Raw (Join-Path $PSScriptRoot "requirements.txt")
$stempel = Join-Path $PSScriptRoot ".venv\pakete.txt"
if (-not (Test-Path $stempel) -or ((Get-Content -Raw $stempel) -ne $anforderungen)) {
    Write-Host "Benoetigte Pakete werden installiert ..."
    & $venvPy -m pip install -q --disable-pip-version-check -r (Join-Path $PSScriptRoot "requirements.txt")
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Die Pakete konnten nicht installiert werden. Ist der Computer mit dem Internet verbunden?"
        exit 1
    }
    Set-Content -Path $stempel -Value $anforderungen -NoNewline
}

# Rentman API-Token und Einstellungen (einmalig)
$envDatei = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $envDatei) -and -not $env:RENTMAN_API -and -not $env:rentman_api) {
    Write-Host ""
    $token = (Read-Host "Rentman API-Token einfuegen und Enter druecken").Trim()
    if (-not $token) { Write-Host "Ohne Token kann das Programm nicht starten."; exit 1 }
    $zeilen = @("RENTMAN_API=$token")
    $antwort = Read-Host "Duerfen Mitarbeitende Karten bearbeiten und die Stammliste aendern? (J/N, Enter = ja)"
    if ($antwort.Trim().ToLower() -in @("n", "nein")) { $zeilen += "BEARBEITEN=aus" }
    Set-Content -Path $envDatei -Value $zeilen -Encoding ASCII
}

Write-Host ""
Write-Host "Der Kartengenerator laeuft. Dieses Fenster bitte offen lassen (es darf minimiert sein)."
Write-Host "Zum Beenden das Fenster schliessen."
& $venvPy (Join-Path $PSScriptRoot "app.py")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
