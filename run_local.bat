@echo off
setlocal EnableExtensions

rem Запуск локального сервера (Node.js 18+)
cd /d "%~dp0"

rem В некоторых средах PATH у cmd урезан и не содержит System32 / nodejs.
if defined SystemRoot set "PATH=%SystemRoot%\System32;%SystemRoot%;%PATH%"
set "PATH=C:\Progra~1\nodejs;C:\Program Files\nodejs;%PATH%"

node -v >nul 2>nul
if errorlevel 1 (
  echo Node.js не найден. Установите Node.js 18+ и повторите запуск.
  pause
  exit /b 1
)

npm -v >nul 2>nul
if errorlevel 1 (
  echo npm не найден. Переустановите Node.js 18+ и повторите запуск.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Устанавливаю зависимости...
  call npm install
  if errorlevel 1 (
    echo Ошибка установки зависимостей.
    pause
    exit /b 1
  )
)

set HOST=0.0.0.0
set PORT=8000

rem Если сервер уже отвечает на порту, не пытаемся стартовать второй экземпляр.
C:\Windows\System32\curl.exe -I http://127.0.0.1:%PORT%/ >nul 2>nul
if not errorlevel 1 (
  echo Сервер уже запущен на http://localhost:%PORT%/
  exit /b 0
)

echo Сервер запускается на http://localhost:%PORT%/
echo Оставьте это окно открытым, пока нужен локальный сайт.
call npm start
exit /b %errorlevel%
