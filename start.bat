@echo off
chcp 65001 >nul
title ALLATKAOSZ - Online 2D jatek
cd /d "%~dp0"
color 0B

echo.
echo  ==============================================
echo           ALLATKAOSZ 1.10 - INDÍTÁS
echo  ==============================================
echo.

where node >nul 2>nul
if errorlevel 1 goto no_node
where npm >nul 2>nul
if errorlevel 1 goto no_npm
if not exist "package.json" goto no_files

if not exist "node_modules\express\package.json" goto install_deps
if not exist "node_modules\socket.io\package.json" goto install_deps
goto start_server

:install_deps
echo Elso inditas: a jatek csomagjainak telepitese kovetkezik.
echo Ehhez internetkapcsolat kell. Ez csak egyszer szukseges.
echo.
call npm install --no-audit --no-fund
if errorlevel 1 goto install_failed

goto start_server

:start_server
echo.
echo A szerver indul. A bongeszo par masodperc mulva megnyilik.
echo Helyi cim: http://localhost:3000
echo Leallitas: CTRL+C
echo.
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3000"
node server.js
echo.
echo A szerver leallt.
pause
exit /b 0

:no_node
echo HIBA: A Node.js nincs telepitve vagy nincs a PATH-ban.
echo Telepitsd a Node.js LTS valtozatat innen: https://nodejs.org/
echo Telepites utan zarj be minden CMD ablakot, majd inditsd ujra a start.bat fajlt.
pause
exit /b 1

:no_npm
echo HIBA: Az npm nem talalhato. Telepitsd ujra a Node.js LTS valtozatat.
pause
exit /b 1

:no_files
echo HIBA: Nem talalhato a package.json.
echo A start.bat fajlt a teljesen kicsomagolt allat_kaosz mappabol inditsd.
pause
exit /b 1

:install_failed
echo.
echo HIBA TORTENT A CSOMAGOK TELEPITESEKOR.
echo Ellenorizd az internetkapcsolatot es futtasd ujra a start.bat fajlt.
echo Ha a hiba megmarad, kuldd el a fekete ablakban lathato hiba szoveget.
pause
exit /b 1
