# mecom-runner.ps1
# Drives the original MECOM v2.07 game in DOSBox to play N periods with given
# per-firm price decisions, exporting + parsing the text report after each period.
#
# Usage:
#   $scenario = @(
#       @(50, 65),   # period 1: firm1=50, firm2=65
#       @(50, 75),   # period 2
#       @(50, 85)    # period 3
#   )
#   .\mecom-runner.ps1 -LeagueName "claud1" -Scenario $scenario -OutCsv "claud1_results.csv"
#
# Only price is overridden per firm; production/marketing/investment/NIOKR accept
# whatever the game shows as default (previous period's value).

param(
    [string]$LeagueName = "claud1",
    [string]$GameDir = "C:\Users\serge.DESKTOP-FQG7BEU\OneDrive\Рабочий стол\MECOM v2.07",
    [Parameter(Mandatory=$true)] $Scenario,
    [string]$OutCsv = "$PSScriptRoot\results.csv",
    # The ACTUAL in-game period number the first scenario entry corresponds to.
    # Must match the league's real "сыгран N период" + 1 shown on the main menu -
    # this is not auto-detected, since OCR-ing the menu isn't implemented. Passing
    # the wrong value makes the script read/parse the wrong (stale) .Z0N export.
    [Parameter(Mandatory=$true)] [int]$StartPeriod
)

Add-Type -AssemblyName Microsoft.VisualBasic
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;

public struct KEYBDINPUT_M { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
[StructLayout(LayoutKind.Explicit, Size = 32)]
public struct InputUnion_M { [FieldOffset(0)] public KEYBDINPUT_M ki; }
public struct INPUT_M { public uint type; public InputUnion_M u; }

public class MecomInput {
    public const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
    public const uint KEYEVENTF_KEYUP = 0x0002;
    public const uint KEYEVENTF_SCANCODE = 0x0008;

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint nInputs, INPUT_M[] pInputs, int cbSize);
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    public static void SendScanKey(ushort scan, bool extended) {
        uint flag = extended ? (KEYEVENTF_SCANCODE | KEYEVENTF_EXTENDEDKEY) : KEYEVENTF_SCANCODE;
        INPUT_M[] inp = new INPUT_M[2];
        inp[0] = new INPUT_M { type = 1, u = new InputUnion_M { ki = new KEYBDINPUT_M { wVk = 0, wScan = scan, dwFlags = flag } } };
        inp[1] = new INPUT_M { type = 1, u = new InputUnion_M { ki = new KEYBDINPUT_M { wVk = 0, wScan = scan, dwFlags = flag | KEYEVENTF_KEYUP } } };
        SendInput(2, inp, Marshal.SizeOf(typeof(INPUT_M)));
    }
}
"@

$Script:Proc = Get-Process -Name DOSBox -ErrorAction Stop
$Script:Hwnd = $Script:Proc.MainWindowHandle
$Script:ScreenshotDir = "$PSScriptRoot\screenshots"
New-Item -ItemType Directory -Force -Path $Script:ScreenshotDir | Out-Null

function Assert-Focus {
    [MecomInput]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
    [MecomInput]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 100
    [Microsoft.VisualBasic.Interaction]::AppActivate($Script:Proc.Id)
    Start-Sleep -Milliseconds 250
    $fg = [MecomInput]::GetForegroundWindow()
    if ($fg -ne $Script:Hwnd) { throw "FOCUS MISMATCH: could not bring DOSBox to foreground" }
}

function Send-Text([string]$text) {
    Assert-Focus
    [System.Windows.Forms.SendKeys]::SendWait($text)
    Start-Sleep -Milliseconds 350
}

function Send-Scan($scan, [bool]$extended = $true) {
    Assert-Focus
    [MecomInput]::SendScanKey([uint16]$scan, $extended)
    Start-Sleep -Milliseconds 350
}

function Send-TabKey { Send-Scan 0x0F $false }
function Send-UpKey { Send-Scan 0x48 $true }
function Send-DownKey { Send-Scan 0x50 $true }

function Save-Screenshot([string]$name) {
    Assert-Focus
    $rect = New-Object MecomInput+RECT
    [MecomInput]::GetWindowRect($Script:Hwnd, [ref]$rect) | Out-Null
    $width = $rect.Right - $rect.Left; $height = $rect.Bottom - $rect.Top
    $bmp = New-Object System.Drawing.Bitmap $width, $height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bmp.Size)
    $path = Join-Path $Script:ScreenshotDir $name
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    return $path
}

function Enter-FirmPrice([int]$price) {
    Send-Text "{ENTER}"                 # select highlighted firm in "Остались"
    Send-Text "$price"
    Send-Text "{ENTER}"                 # commit price
    for ($i = 0; $i -lt 4; $i++) {
        Send-Text "{ENTER}"             # accept default: production/marketing/investment/NIOKR
    }
    Send-Text "{ENTER}"                 # safety: activates "Закончить ввод решений" button if it appeared
    Send-Text " "                       # expand Да/Нет toggle
    Send-UpKey                          # select "Да" (raw scancode - VK/SendKeys don't register here)
    Send-Text "{ENTER}"                 # confirm firm
}

function Enter-PeriodDecisions([int[]]$prices) {
    # Pass 1: fill every firm's decisions
    Send-Text "{F2}"
    foreach ($p in $prices) { Enter-FirmPrice $p }
    Send-Text "{ESC}"                   # exit - decisions persist across this exit

    # Pass 2: MECOM requires going through F2 twice before it actually computes
    # the period (confirmed by the human player, not an automation bug).
    Send-Text "{F2}"
    Send-TabKey                         # move focus from firm list down to "Закончить ввод" button
    Send-Text "{ENTER}"                 # activates it -> industry report screen appears
    Start-Sleep -Milliseconds 800
    Send-Text "{ESC}"                   # back to main menu; period counter now incremented
}

function Export-PeriodReport([int]$period) {
    Send-Text "{F1}"
    Send-UpKey                          # from default Esc-focus, one Up selects the "Z: S,I,A" bundle row
    Send-Text "{ENTER}"                 # save-to-file (Z bundle's device column is already set to file)
    Start-Sleep -Milliseconds 1200
    Send-Text "{ESC}"                   # dismiss the "file saved" confirmation
    Start-Sleep -Milliseconds 400
    Send-Text "{ESC}"                   # back to main menu from the reports menu

    $upper = $LeagueName.ToUpper()
    $fileName = "$upper.Z{0:D2}" -f $period
    return Join-Path $GameDir "Outgoing\$upper\$fileName"
}

function Read-ReportText([string]$path) {
    for ($attempt = 0; $attempt -lt 10; $attempt++) {
        if (Test-Path $path) { break }
        Start-Sleep -Milliseconds 300
    }
    if (-not (Test-Path $path)) { throw "Report file not found: $path" }
    $fs = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    $ms = New-Object System.IO.MemoryStream
    $fs.CopyTo($ms)
    $fs.Close()
    $bytes = $ms.ToArray()
    $enc = [System.Text.Encoding]::GetEncoding(866)
    return $enc.GetString($bytes)
}

function Parse-Report([string]$text, [int]$period) {
    $lines = $text -split "`r`n|`n"
    $headerIdx = -1
    for ($i = 0; $i -lt $lines.Length; $i++) {
        if ($lines[$i] -match '(Фирма\s+\d+\s*){2,}') { $headerIdx = $i; break }
    }
    if ($headerIdx -lt 0) { throw "Could not find firm header line in report" }

    $firmNames = [regex]::Matches($lines[$headerIdx], 'Фирма\s+\d+') | ForEach-Object { $_.Value.Trim() }
    $nFirms = $firmNames.Count

    # rows: skip header + the "------ -------- --------" separator line
    $rowStart = $headerIdx + 2
    $seenLabels = @{}
    $records = @{}
    foreach ($name in $firmNames) { $records[$name] = [ordered]@{ Period = $period; Firm = $name } }

    for ($i = $rowStart; $i -lt $lines.Length; $i++) {
        $line = $lines[$i]
        if ($line.Trim() -eq "") { continue }
        # label = everything before the first run of digits/$-sign that starts a numeric column
        if ($line -notmatch '^(?<label>\S.{0,8}?)\s{1,}(?<rest>[\$\-\d].*)$') { continue }
        $label = $Matches['label'].Trim()
        $rest = $Matches['rest']
        $nums = [regex]::Matches($rest, '-?\$?\s*[\d,]+(\.\d+)?%?') | ForEach-Object { $_.Value }
        if ($nums.Count -lt $nFirms) { continue }
        if ($seenLabels.ContainsKey($label)) {
            $seenLabels[$label]++
            $label = "$label#$($seenLabels[$label])"
        } else {
            $seenLabels[$label] = 1
        }
        for ($f = 0; $f -lt $nFirms; $f++) {
            $raw = $nums[$f]
            $clean = ($raw -replace '[\$,%\s]', '')
            $records[$firmNames[$f]][$label] = $clean
        }
        # stop once we've passed the RIF line (end of per-firm table)
        if ($label -like 'РИФ*') { break }
    }
    return $records.Values
}

# ---- Main ----
$allResults = @()
$period = $StartPeriod - 1
foreach ($periodPrices in $Scenario) {
    $period++
    Write-Host "=== Period $period : prices = $($periodPrices -join ', ') ==="
    $upper = $LeagueName.ToUpper()
    $expectedFile = Join-Path $GameDir ("Outgoing\$upper\$upper.Z{0:D2}" -f $period)
    if (Test-Path $expectedFile) {
        throw "Refusing to continue: $expectedFile already exists. StartPeriod is probably wrong for this league's actual current period - check the main menu's 'сыгран N период' before retrying."
    }
    Enter-PeriodDecisions -prices $periodPrices
    Save-Screenshot "period_${period}_done.png" | Out-Null
    $reportPath = Export-PeriodReport -period $period
    Start-Sleep -Milliseconds 400
    $text = Read-ReportText $reportPath
    if ($text -notmatch "за\s+$period\s+период") {
        throw "Sanity check failed: exported report for '$reportPath' does not mention period $period. The period likely never advanced (double-pass finalize failed) - check screenshots\period_${period}_done.png before retrying."
    }
    $rows = Parse-Report -text $text -period $period
    $allResults += $rows
    Write-Host "Period $period parsed OK ($($rows.Count) firm rows)"
}

$flat = $allResults | ForEach-Object {
    $o = [ordered]@{}
    foreach ($k in $_.Keys) { $o[$k] = $_[$k] }
    [PSCustomObject]$o
}
$flat | Export-Csv -Path $OutCsv -NoTypeInformation -Encoding UTF8
Write-Host "Saved results to $OutCsv"
