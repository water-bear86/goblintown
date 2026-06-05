# Operator console auth

The operator console supports two auth modes:

- GitHub App login for multi-user operators.
- Shared password fallback for local setup or emergency access.

Use GitHub App login for production.

## 1. Create the GitHub App

Create a GitHub App owned by the org or your account.

Set the callback URL:

```text
https://goblintown-mcp.vercel.app/api/admin/auth/github/callback
```

For local tunnel testing, add the tunnel callback URL too.

Grant repository permissions:

- Actions variables: read and write.
- Issues: read and write.

Install the app on the repository that owns the duty state, usually:

```text
goblintownlol/chatgptapp
```

## 2. Configure Vercel env

Set these on the hosted app:

```text
GITHUB_APP_CLIENT_ID=<from GitHub App settings>
GITHUB_APP_CLIENT_SECRET=<from GitHub App settings>
GITHUB_APP_ID=<numeric app id>
GITHUB_APP_PRIVATE_KEY=<private key PEM, with newlines escaped if needed>
GITHUB_APP_INSTALLATION_ID=<installation id>
OPERATOR_SESSION_SECRET=<long random string>
OPERATOR_ALLOWED_GITHUB_LOGINS=water-bear86,another-login
AGENT_DUTY_AGENTS=codex,hermes,you
AGENT_DUTY_OWNER=goblintownlol
AGENT_DUTY_REPO=chatgptapp
AGENT_DUTY_VARIABLE=AGENT_DUTY_STATE
```

The private key and client secret stay server-side. The browser never sees them.

## 3. Optional password fallback

For local setup or emergency access:

```text
AGENT_DUTY_PASSWORD=<long random password>
```

The admin page accepts either a valid GitHub session cookie or this bearer
password. Remove this env var when the GitHub App flow is fully trusted.

## 4. Use the console

Open:

```text
https://goblintown-mcp.vercel.app/admin
```

Sign in with GitHub. If your login is in `OPERATOR_ALLOWED_GITHUB_LOGINS`, the
server sets a signed session cookie and loads the duty board.

Flipping a switch writes `AGENT_DUTY_STATE` as a repository Actions variable.
The dispatcher reads that variable before assigning jobs, so off-duty agents are
not selected for new work.
