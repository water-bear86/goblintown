import { createSign } from "node:crypto";

const GH_API_BASE = "https://api.github.com";
const GH_API_VERSION = "2022-11-28";

export interface GitHubAppConfig {
  appId: string;
  privateKey: string;
  installationId: string;
}

export function githubApiToken(
  env: Record<string, string | undefined> = process.env,
): Promise<string | undefined> {
  const app = githubAppConfig(env);
  if (app) return githubAppInstallationToken(app);
  return Promise.resolve(env.AGENT_DUTY_GITHUB_TOKEN ?? env.GITHUB_TOKEN);
}

export function githubAppConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return !!githubAppConfig(env);
}

function githubAppConfig(
  env: Record<string, string | undefined>,
): GitHubAppConfig | undefined {
  const appId = env.GITHUB_APP_ID ?? env.AGENT_DUTY_GITHUB_APP_ID;
  const privateKey = env.GITHUB_APP_PRIVATE_KEY ?? env.AGENT_DUTY_GITHUB_APP_PRIVATE_KEY;
  const installationId = env.GITHUB_APP_INSTALLATION_ID ?? env.AGENT_DUTY_GITHUB_APP_INSTALLATION_ID;
  if (!appId || !privateKey || !installationId) return undefined;
  return {
    appId,
    privateKey: privateKey.replace(/\\n/g, "\n"),
    installationId,
  };
}

async function githubAppInstallationToken(config: GitHubAppConfig): Promise<string> {
  const jwt = signGithubAppJwt(config);
  const response = await fetch(
    `${GH_API_BASE}/app/installations/${encodeURIComponent(config.installationId)}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": GH_API_VERSION,
        "User-Agent": "goblintown-github-app",
      },
    },
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub App token request failed: ${response.status} ${text.slice(0, 300)}`);
  }
  const body = (await response.json()) as { token?: unknown };
  if (typeof body.token !== "string" || body.token.length === 0) {
    throw new Error("GitHub App token response did not include a token");
  }
  return body.token;
}

function signGithubAppJwt(config: GitHubAppConfig): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlJson({ alg: "RS256", typ: "JWT" });
  const payload = base64urlJson({
    iat: now - 60,
    exp: now + 540,
    iss: config.appId,
  });
  const signingInput = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256")
    .update(signingInput)
    .end()
    .sign(config.privateKey)
    .toString("base64url");
  return `${signingInput}.${signature}`;
}

function base64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
