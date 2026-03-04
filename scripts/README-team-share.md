## Team Share Scripts

### Start share mode

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-team-share.ps1
```

This script will:
- ensure Akeneo containers are running
- start or reuse an ngrok HTTPS tunnel to `localhost:8080`
- update `.env` `AKENEO_PIM_URL` to the ngrok URL
- recreate web containers so the new URL is active
- print the share URL and credentials

### Stop share mode

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\stop-team-share.ps1
```

This script will:
- stop ngrok
- reset `.env` `AKENEO_PIM_URL` back to `http://localhost:8080`
- recreate web containers

