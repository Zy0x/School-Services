@echo off
chcp 65001 >nul
title INJECT WEB SERVER - CLOUDFLARE TUNNEL DEPLOYER
setlocal enabledelayedexpansion

:: =====================================================
:: CORE SETTINGS & SECURITY
:: =====================================================
set "ACCESS_KEY=@admin01"
set "ENV_FILE=C:\newappraporsd2025\wwwroot\.env"
set "PORT=5774"
set "LOG_FILE=%TEMP%\cloudflare_tunnel.log"
set "LINK_FILE=%TEMP%\cf_link.txt"
set "PS=C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"

:: =====================================================
:: ANSI COLORS
:: =====================================================
for /F "delims=#" %%E in ('"prompt #$E# & for %%a in (1) do rem"') do set "ESC=%%E"
set "cGRN=%ESC%[92m"
set "cCYN=%ESC%[96m"
set "cRED=%ESC%[91m"
set "cYLW=%ESC%[93m"
set "cMGN=%ESC%[95m"
set "cWHT=%ESC%[97m"
set "cGRY=%ESC%[90m"
set "cRST=%ESC%[0m"

:: Mendapatkan lebar window untuk kalkulasi rata tengah
for /f %%a in ('powershell -command "$Host.UI.RawUI.WindowSize.Width"') do set /a "winWidth=%%a"

:: =====================================================
:: 1. DISPLAY SPLASH SCREEN (TAMPIL PERTAMA)
:: =====================================================
cls
echo.
call :PrintCentered "%cMGN%███╗   ██╗██╗   ██╗███████╗ █████╗ ███╗   ██╗████████╗ █████╗ ██████╗  █████╗ "
call :PrintCentered "%cMGN%████╗  ██║██║   ██║██╔════╝██╔══██╗████╗  ██║╚══██╔══╝██╔══██╗██╔══██╗██╔══██╗"
call :PrintCentered "%cMGN%██╔██╗ ██║██║   ██║███████╗███████║██╔██╗ ██║   ██║   ███████║██████╔╝███████║"
call :PrintCentered "%cMGN%██║╚██╗██║██║   ██║╚════██║██╔══██║██║╚██╗██║   ██║   ██╔══██║██╔══██╗██╔══██║"
call :PrintCentered "%cMGN%██║ ╚████║╚██████╔╝███████║██║  ██║██║ ╚████║   ██║   ██║  ██║██║  ██║██║  ██║"
call :PrintCentered "%cMGN%╚═╝  ╚═══╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝"
call :PrintCentered "%cMGN%██████╗ ██████╗  ██████╗      ██╗███████╗ ██████╗████████╗"
call :PrintCentered "%cMGN%██╔══██╗██╔══██╗██╔═══██╗     ██║██╔════╝██╔════╝╚══██╔══╝"
call :PrintCentered "%cMGN%██████╔╝██████╔╝██║   ██║     ██║█████╗  ██║        ██║   "
call :PrintCentered "%cMGN%██╔═══╝ ██╔══██╗██║   ██║██   ██║██╔══╝  ██║        ██║   "
call :PrintCentered "%cMGN%██║     ██║  ██║╚██████╔╝╚█████╔╝███████╗╚██████╗   ██║   "
call :PrintCentered "%cMGN%╚═╝     ╚═╝  ╚═╝ ╚═════╝  ╚════╝ ╚══════╝ ╚═════╝   ╚═╝   "
echo.
call :PrintCentered "%cWHT%[ DEVELOPED BY : %cMGN%Zy0x %cWHT%| ELITE NETWORK ARCHITECT ]%cRST%"
echo.
timeout /t 2 /nobreak >nul

:: =====================================================
:: GATEKEEPER - TERMUX STYLE FINAL (NO BUG)
:: =====================================================
:AUTH_GATE
cls

:: Hitung lebar window
for /f "tokens=2 delims=:" %%A in ('mode con ^| findstr /i "Columns"') do (
    set /a "winWidth=%%A" & goto :got_width
)
:got_width
if not defined winWidth set /a "winWidth=80"
set /a "w=winWidth-2"

:: Build garis horizontal
set "line="
for /l %%i in (1,1,%w%) do set "line=!line!─"

:: ── RENDER FRAME PENUH ───────────────────────────────────────────
cls
echo %cGRY%┌!line!┐%cRST%
call :GKLine "  CRITICAL SYSTEM ACCESS" "WHT"
call :GKLine "  IDENTITY VERIFICATION REQUIRED" "WHT"
echo %cGRY%├!line!┤%cRST%
call :GKLine "  SCANNING HARDWARE SIGNATURE..." "YLW"
call :GKLine "  " "RST"
call :GKLine "  ENTER ENCRYPTION KEY" "CYN"
call :GKLine "  KEY : " "GRY"

call :GKLine "  " "RST"
echo %cGRY%├!line!┤%cRST%
call :GKLine "  STATUS : AWAITING INPUT..." "GRY"
echo %cGRY%└!line!┘%cRST%

:: ── ANIMASI PROGRESS BAR baris 5 ────────────────────────────────
set "bar="
set /a "bar_max=w-6"
if %bar_max% GTR 50 set "bar_max=50"

for /l %%i in (1,1,%bar_max%) do (
    set "bar=!bar!█"
    <nul set /p ="%ESC%[5;3H%cGRN%!bar!%cRST%"
    timeout /t 0 /nobreak >nul
)
call :UpdateLine 5 "  HARDWARE SIGNATURE VERIFIED" "GRN"

:: ── SEMBUNYIKAN CURSOR ───────────────────────────────────────────
<nul set /p ="%ESC%[?25l"

:: ── POSISI CURSOR KE DALAM BRACKET BARIS 8 ──────────────────────
:: Kolom 10 = tepat setelah "  KEY : ["
<nul set /p ="%ESC%[8;10H"

:: ── SET WARNA TEKS = EXACT CMD BACKGROUND COLOR ──────────────────
:: Windows 10/11 CMD default background: RGB(12,12,12)
:: ESC[38;2;12;12;12m = foreground exact match → invisible
:: ESC[48;2;12;12;12m = background sama → double insurance
<nul set /p ="%ESC%[38;2;12;12;12m%ESC%[48;2;12;12;12m"

:: ── BACA INPUT (teks invisible karena warna sama dengan BG) ──────
set "input_pass="
set /p "input_pass="

:: ── RESTORE WARNA SEGERA ─────────────────────────────────────────
<nul set /p ="%ESC%[0m"

:: ── TAMPILKAN CURSOR KEMBALI ─────────────────────────────────────
<nul set /p ="%ESC%[?25h"

:: ── HITUNG PANJANG PASSWORD → BUILD BINTANG ──────────────────────
set "sc=0"
set "st=!input_pass!"
:star_len
if not "!st!"=="" (
    set /a sc+=1
    set "st=!st:~1!"
    goto star_len
)

set "stars="
for /l %%i in (1,1,%sc%) do set "stars=!stars!*"

:: ── TIMPA BARIS 8 DENGAN MASK BINTANG ────────────────────────────
call :UpdateLine 8 "  KEY : !stars!" "CYN"

timeout /t 1 /nobreak >nul

:: ── VALIDASI ─────────────────────────────────────────────────────
if "!input_pass!"=="%ACCESS_KEY%" (
    call :UpdateLine 11 "  STATUS : ACCESS GRANTED  - WELCOME ZY0X 😝" "GRN"
    timeout /t 2 /nobreak >nul
    cls
    goto :SYSTEM_INIT
) else (
    call :UpdateLine 11 "  STATUS : ACCESS DENIED   - TERMINATING SESSION" "RED"
    timeout /t 3 /nobreak >nul
    exit
)

:: =====================================================
:: HELPER: UPDATE BARIS SPESIFIK
:: call :UpdateLine <row> "<text>" "<color>"
:: =====================================================
:UpdateLine
set "ul_row=%~1"
set "ul_text=%~2"
set "ul_col=%~3"

set "ul_color=%cWHT%"
if /i "%ul_col%"=="GRN" set "ul_color=%cGRN%"
if /i "%ul_col%"=="CYN" set "ul_color=%cCYN%"
if /i "%ul_col%"=="RED" set "ul_color=%cRED%"
if /i "%ul_col%"=="YLW" set "ul_color=%cYLW%"
if /i "%ul_col%"=="GRY" set "ul_color=%cGRY%"
if /i "%ul_col%"=="MGN" set "ul_color=%cMGN%"
if /i "%ul_col%"=="WHT" set "ul_color=%cWHT%"

set "ul_len=0"
set "ul_tmp=%ul_text%"
:ul_len_loop
if not "!ul_tmp!"=="" (
    set /a ul_len+=1
    set "ul_tmp=!ul_tmp:~1!"
    goto ul_len_loop
)
set /a "ul_space=w-ul_len"
if %ul_space% LSS 0 set "ul_space=0"
set "ul_pad="
for /l %%i in (1,1,%ul_space%) do set "ul_pad=!ul_pad! "

<nul set /p ="%ESC%[%ul_row%;1H%cGRY%│%cRST%%ul_color%%ul_text%%cRST%!ul_pad!%cGRY%│%cRST%"
goto :eof

:: =====================================================
:: HELPER: RENDER BARIS SAAT INIT
:: call :GKLine "<text>" "<color>"
:: =====================================================
:GKLine
set "gtext=%~1"
set "gcol=%~2"

set "gcolor=%cWHT%"
if /i "%gcol%"=="GRN" set "gcolor=%cGRN%"
if /i "%gcol%"=="CYN" set "gcolor=%cCYN%"
if /i "%gcol%"=="RED" set "gcolor=%cRED%"
if /i "%gcol%"=="YLW" set "gcolor=%cYLW%"
if /i "%gcol%"=="GRY" set "gcolor=%cGRY%"
if /i "%gcol%"=="MGN" set "gcolor=%cMGN%"
if /i "%gcol%"=="WHT" set "gcolor=%cWHT%"

set "glen=0"
set "gtmp=%gtext%"
:gkl_len
if not "!gtmp!"=="" (
    set /a glen+=1
    set "gtmp=!gtmp:~1!"
    goto gkl_len
)
set /a "gspace=w-glen"
if %gspace% LSS 0 set "gspace=0"
set "gpad="
for /l %%i in (1,1,%gspace%) do set "gpad=!gpad! "

echo %cGRY%│%cRST%%gcolor%%gtext%%cRST%!gpad!%cGRY%│%cRST%
goto :eof

:: =====================================================
:: 3. SYSTEM INITIALIZATION
:: =====================================================
:SYSTEM_INIT
echo %cCYN%--- INITIALIZING DEPLOYMENT INTERFACE ---%cRST%
timeout /t 1 /nobreak >nul
echo.
echo %cCYN%[ SYSTEM LOG ] : %cWHT%Attempting to gain kernel-level access...%cRST%
timeout /t 2 /nobreak >nul
echo %cGRN%[ ACCESS ] : %cWHT%Security protocols bypassed successfully.%cRST%
timeout /t 1 /nobreak >nul
echo.

<nul set /p ="%cCYN%[*] Purging ghost connections from memory.... %cRST%"
taskkill /F /IM cloudflared.exe /T >nul 2>&1
if exist "%LOG_FILE%" del "%LOG_FILE%"
if exist "%LINK_FILE%" del "%LINK_FILE%"
timeout /t 2 /nobreak >nul
echo %cGRN%DONE%cRST%

<nul set /p ="%cCYN%[*] Loading Cloudflare Zero-Trust engine..... %cRST%"
start /B cmd /c "cloudflared tunnel --url http://localhost:%PORT% --http-host-header localhost > "%LOG_FILE%" 2>&1" <nul
timeout /t 3 /nobreak >nul
echo %cGRN%OK%cRST%

:: =====================================================
:: 4. TOKEN INTERCEPTION
:: =====================================================
set "CLOUDLINK="
set "MAX_TRIES=30"
set "TRIES=0"

echo %cCYN%[*] Hunting for public uplink signal...%cRST%
<nul set /p ="%cMGN%    SCANNING %cRST%"

:WAIT_LOOP
timeout /t 1 /nobreak >nul
set /a TRIES+=1
<nul set /p ="%cYLW%X%cRST%"

"%PS%" -NoProfile -Command "$match = Select-String -Path '%LOG_FILE%' -Pattern 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' -ErrorAction Ignore; if ($match) { [IO.File]::WriteAllText('%LINK_FILE%', $match.Matches[0].Value) }"

if exist "%LINK_FILE%" (
    for /f "usebackq delims=" %%A in ("%LINK_FILE%") do set "CLOUDLINK=%%A"
)

if defined CLOUDLINK (
    timeout /t 1 /nobreak >nul
    echo %cGRN% [ SIGNAL CAPTURED ]%cRST%
    goto :LINK_FOUND
)
if !TRIES! LSS %MAX_TRIES% goto :WAIT_LOOP

echo.
echo %cRED%[FATAL] UPLINK TIMEOUT. ABORTING MISSION.%cRST%
goto :KILL_AND_EXIT

:LINK_FOUND
timeout /t 2 /nobreak >nul
echo.
<nul set /p ="%cCYN%[*] Pointing payload to target config........ %cRST%"
timeout /t 2 /nobreak >nul
if exist "%ENV_FILE%" (
    echo %cGRN%LOCKED%cRST%
) else (
    echo %cRED%MISSING%cRST%
    goto :KILL_AND_EXIT
)

<nul set /p ="%cCYN%[*] Executing baseURL override sequence...... %cRST%"
"%PS%" -NoProfile -Command "(Get-Content '%ENV_FILE%') -replace '(?i)#?\s*app\.baseURL\s*=.*', 'app.baseURL = ''%CLOUDLINK%/''' | Set-Content '%ENV_FILE%'"
timeout /t 3 /nobreak >nul
echo %cGRN%SUCCESS%cRST%

:: =====================================================
:: 5. GET IPv4 ADDRESS
:: =====================================================
set "IPV4="
for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /i "IPv4"') do (
    set "IPV4=%%A"
    set "IPV4=!IPV4: =!"
    goto :IP_FOUND
)
:IP_FOUND

:: =====================================================
:: 6. FINAL TERMINAL DATA
:: =====================================================
timeout /t 1 /nobreak >nul
echo.
echo %cWHT%=====================================================================%cRST%
echo %cGRN%                NETWORK STATUS: BROADCASTING (ONLINE)%cRST%
echo %cWHT%=====================================================================%cRST%
echo %cCYN%  UPLINK URL    : %cMGN%%CLOUDLINK%%cRST%
echo %cCYN%  LOCAL GATE    : %cWHT%localhost:%PORT%%cRST%
echo %cCYN%  IPv4 ADDRESS  : %cYLW%!IPV4!%cRST%
echo %cCYN%  ENGINEER      : %cMGN%Zy0x (Elite Coder)%cRST%
echo %cWHT%=====================================================================%cRST%
echo.
echo %cRED%[ ALERT ] PRESS 'X' KEY TO SHATTER CONNECTION AND GO DARK%cRST%

choice /c X /n >nul

:: =====================================================
:: SHUTDOWN SEQUENCE
:: =====================================================
:KILL_AND_EXIT
echo.
<nul set /p ="%cRED%[*] Self-destructing tunnel session.......... %cRST%"
taskkill /F /IM cloudflared.exe /T >nul 2>&1
timeout /t 2 /nobreak >nul
echo %cGRN%OK%cRST%

<nul set /p ="%cRED%[*] Wiping ephemeral log traces.............. %cRST%"
timeout /t 2 /nobreak >nul
echo %cGRN%CLEAN%cRST%

echo %cRED%[*] Zy0x System is now OFFLINE. Going dark...%cRST%
timeout /t 2 /nobreak >nul
exit

:: =====================================================
:: HELPER: DYNAMIC CENTER ALIGN
:: =====================================================
:PrintCentered
set "text=%~1"
set "cleanText=%text%"
:: Menghapus kode warna ANSI agar hitungan panjang teks akurat
for %%E in ("%ESC%[92m" "%ESC%[96m" "%ESC%[91m" "%ESC%[93m" "%ESC%[95m" "%ESC%[97m" "%ESC%[90m" "%ESC%[0m") do (
    set "cleanText=!cleanText:%%~E=!"
)
:: Menghitung panjang string
set "length=0"
set "tempStr=%cleanText%"
:len_loop
if not "%tempStr%"=="" (
    set /a "length+=1"
    set "tempStr=%tempStr:~1%"
    goto len_loop
)
:: Hitung spasi kiri
set /a "pad=(winWidth - length) / 2"
if %pad% LSS 0 set "pad=0"
set "padding="
for /l %%i in (1,1,%pad%) do set "padding=!padding! "
echo !padding!!text!
goto :eof