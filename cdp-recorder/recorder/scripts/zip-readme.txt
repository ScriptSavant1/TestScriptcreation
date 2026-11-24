PerfX Studio - CDP Recorder
===========================

SET UP ONCE ON THIS COMPUTER

1. Right-click this ZIP and choose "Extract All...". Pick a folder that
   stays and where your computer lets you run programs, for example
   C:\PerfX\cdp-recorder - not inside your user profile folder (such as
   Downloads, Desktop or Documents). If Windows blocks the program there,
   ask your IT team.
   Do not run cdp-recorder.exe from inside the ZIP - Windows would run it
   from a temporary folder and the Start recording button could not find
   it next time.

2. Open the extracted folder and double-click cdp-recorder.exe once.
   This connects it to the "Start recording" button in PerfX Studio
   (Script Studio), for your Windows user - no administrator rights needed.
   It opens a small toolbar and a browser window - you don't need to
   record anything in them.
   If you move the folder later, double-click it again.


RECORD FROM PERFX STUDIO (recommended)

3. Open PerfX Studio -> Script Studio -> Start recording. Type your
   application's address, choose Edge or Chrome and, if you like, a private
   window (optional - every recording starts signed out in a fresh browser
   profile either way), then click Start recording. The first time, your browser asks
   "Open cdp-recorder?" - click Open.

   If your computer does not let the browser start programs (an error, or
   nothing happens): start cdp-recorder.exe yourself first, then click
   Start recording on the page. The small toolbar asks "Allow this page to
   start recordings?" - click Allow. It asks once per PerfX Studio address
   and remembers it (allowed-pages.json in %LOCALAPPDATA%\PerfX\cdp-recorder).
   If Windows does not allow cdp-recorder.exe to run at all, ask your IT
   team to approve it.

4. A separate Edge (or Chrome) recording window with an orange border
   opens on your application, already recording, with a floating toolbar
   beside it. Use your application only in the recording window - new
   tabs and pop-ups it opens are recorded too; your normal browser is not.

5. Name transactions on the toolbar or on the page: type a name (for
   example Login) and press Enter - the running transaction ends and this
   one starts. The number is added for you (T02_Login); type your own,
   for example T07_Pay, to use another number. With planned steps (More
   options on the page), press Enter on an empty box to start the next
   one. There is no End: the next name ends the running transaction, and
   Stop ends the last one.
   On the page: Tab takes the page title as the name; the pencil in the
   list renames a transaction; Undo last mark takes back the last Start or
   End. An optional script ID (More options, e.g. SC01) starts the file
   name and the transaction names in the script (SC01_01_...).

   THE FLOATING BAR (0.3.0): the recording window (it opens maximised)
   shows a small bar at the top: REC, the time, the running transaction
   and the same box. One bar on screen: a new tab, window or pop-up takes
   it as it opens, and it follows you to the recorded window you last
   clicked or typed in. Type a name, Enter (or Mark): the
   running transaction ends and the next starts. The arrow opens the
   details (transactions, rename, Undo last mark, planned steps); Stop and
   save is on the bar too. Drag it anywhere, by any part that is not a
   button (it stays there; double-click the grip: back at the top), minimise it, or press Alt+Shift+H to hide it and bring it
   back. It is never part of the recording. Turn it off on the page under
   More options, or start the recorder with --no-bar.

6. Click Stop and save on the page (or Stop Recording on the toolbar).
   The recording (.har file) is saved in your Downloads folder and opens
   in Script Studio by itself. The toolbar says it is saved; the recorder's
   windows close after 10 seconds - click Keep open on the toolbar to look
   at the recording window first.


WHERE THE SETUP IS KEPT

Nothing is stored in your browser. Each start of cdp-recorder.exe registers
a "perfx-recorder:" link with Windows, for your user only (registry key
HKEY_CURRENT_USER\Software\Classes\perfx-recorder, pointing to this .exe).
Start recording in PerfX Studio opens that link and Windows starts the
program; it then talks to the page on this computer only (127.0.0.1:8787).
Clearing browser history and cookies does not change it. After moving this
folder, double-click cdp-recorder.exe once more. Pages you allowed are in
%LOCALAPPDATA%\PerfX\cdp-recorder\allowed-pages.json. Each recording uses
a fresh, temporary browser profile, deleted when the recorder closes.
To remove everything: delete this folder, the registry key above
(reg delete HKCU\Software\Classes\perfx-recorder /f) and the folder
%LOCALAPPDATA%\PerfX\cdp-recorder.

OR START IT YOURSELF

Double-click cdp-recorder.exe. A floating toolbar and a separate Edge (or
Chrome) recording window with an orange border open. Use your application
only in the recording window - your normal browser is not recorded.

On the toolbar click Start Recording, type a transaction name (for example
Login) and press Enter: it is numbered for you (T01_Login). Do the steps,
then type the next name and press Enter - the running transaction ends and
the next one starts. Stop Recording ends the last one.

Click Stop Recording. The recording (.har file) is saved in the same folder
as cdp-recorder.exe. Open it in PerfX Studio's Script Studio.
Click Quit on the toolbar when you have finished - a recording still
running is saved first.

Full guide: open PerfX Studio, click "Help & guides" in the left sidebar,
then open the Recorder section.
