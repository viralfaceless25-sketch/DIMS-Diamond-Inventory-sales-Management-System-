# Office launcher

Run `Launch-DiamondInventory.ps1 -OpenApp` to start the API and the production frontend, then open it in an Edge app window.

Run `Install-Autostart.ps1` once on the always-on office PC to start both services automatically each time that Windows account signs in. The PC must stay powered on and signed in; this is an office-hosted app, not an internet-hosted server.

Use `http://<office-PC-IP>:3000` from another PC on the Maitri private network after allowing inbound TCP ports 3000 and 4000 in Windows Firewall.
