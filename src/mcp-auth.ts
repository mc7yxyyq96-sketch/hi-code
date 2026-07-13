import crypto from "node:crypto";

import { McpError, redactMcpText } from "./mcp-protocol.js";

export type McpAuthConfig = McpNoAuthConfig | McpBearerAuthConfig | McpOAuthConfig;

export interface McpNoAuthConfig {
  type: "none";
}

export interface McpBearerAuthConfig {
  type: "bearer";
  /** Runtime-only resolved value. Persistence uses tokenRef. */
  token?: string;
  tokenRef?: string;
}

export interface McpOAuthConfig {
  type: "oauth";
  clientId: string;
  scopes?: string[];
  resourceMetadataUrl?: string;
  authorizationServer?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  /** Runtime-only resolved values. Persistence uses the matching refs. */
  accessToken?: string;
  accessTokenRef?: string;
  refreshToken?: string;
  refreshTokenRef?: string;
  expiresAt?: string;
}

export interface McpOAuthTokenUpdate {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
}

export interface McpAuthStatus {
  type: McpAuthConfig["type"];
  state: "not_required" | "ready" | "expired" | "refreshing" | "authorization_required" | "failed";
  expiresAt?: string;
  authorizationUrl?: string;
  error?: string;
}

export interface McpOAuthAuthorizationRequest {
  authorizationUrl: string;
  codeVerifier: string;
  state: string;
  redirectUri: string;
}

export interface McpAuthProvider {
  readonly type: McpAuthConfig["type"];
  authorize(headers: Headers, resourceUrl: string): Promise<void>;
  handleUnauthorized(response: Response, resourceUrl: string): Promise<boolean>;
  status(): McpAuthStatus;
}

export interface McpAuthProviderOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  onTokenUpdate?: (update: McpOAuthTokenUpdate) => Promise<void> | void;
}

interface OAuthMetadata {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  scopesSupported: string[];
}

const EXPIRY_SKEW_MS = 30_000;

export function createMcpAuthProvider(config: McpAuthConfig | undefined, options: McpAuthProviderOptions = {}): McpAuthProvider {
  if (!config || config.type === "none") return new NoAuthProvider();
  if (config.type === "bearer") return new BearerAuthProvider(config);
  if (config.type === "oauth") return new OAuthAuthProvider(config, options);
  throw new McpError({ kind: "configuration", code: "MCP_AUTH_INVALID", message: "Unsupported MCP authentication type", retryable: false });
}

export async function createOAuthAuthorizationRequest({
  config,
  resourceUrl,
  redirectUri,
  fetchImpl = fetch,
}: {
  config: McpOAuthConfig;
  resourceUrl: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}): Promise<McpOAuthAuthorizationRequest> {
  const metadata = await discoverOAuthMetadata(config, resourceUrl, fetchImpl);
  const codeVerifier = base64Url(crypto.randomBytes(48));
  const codeChallenge = base64Url(crypto.createHash("sha256").update(codeVerifier).digest());
  const state = base64Url(crypto.randomBytes(24));
  const url = new URL(metadata.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", validateClientId(config.clientId));
  url.searchParams.set("redirect_uri", validateRedirectUri(redirectUri));
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("resource", validateRemoteResource(resourceUrl));
  const scopes = normalizedScopes(config.scopes, metadata.scopesSupported);
  if (scopes.length) url.searchParams.set("scope", scopes.join(" "));
  return { authorizationUrl: url.toString(), codeVerifier, state, redirectUri };
}

export async function exchangeOAuthAuthorizationCode({
  config,
  resourceUrl,
  request,
  code,
  returnedState,
  fetchImpl = fetch,
}: {
  config: McpOAuthConfig;
  resourceUrl: string;
  request: McpOAuthAuthorizationRequest;
  code: string;
  returnedState: string;
  fetchImpl?: typeof fetch;
}): Promise<McpOAuthTokenUpdate> {
  const expectedState = Buffer.from(request.state);
  const actualState = Buffer.from(returnedState);
  if (expectedState.length !== actualState.length || !crypto.timingSafeEqual(expectedState, actualState)) {
    throw authError("MCP_OAUTH_STATE_MISMATCH", "OAuth state validation failed", false);
  }
  const metadata = await discoverOAuthMetadata(config, resourceUrl, fetchImpl);
  return requestToken(metadata.tokenEndpoint, {
    grant_type: "authorization_code",
    code: boundedTokenField(code, "authorization code"),
    client_id: validateClientId(config.clientId),
    redirect_uri: validateRedirectUri(request.redirectUri),
    code_verifier: boundedTokenField(request.codeVerifier, "PKCE verifier"),
    resource: validateRemoteResource(resourceUrl),
  }, fetchImpl);
}

class NoAuthProvider implements McpAuthProvider {
  readonly type = "none" as const;
  async authorize(): Promise<void> {}
  async handleUnauthorized(): Promise<boolean> { return false; }
  status(): McpAuthStatus { return { type: this.type, state: "not_required" }; }
}

class BearerAuthProvider implements McpAuthProvider {
  readonly type = "bearer" as const;
  constructor(private readonly config: McpBearerAuthConfig) {}

  async authorize(headers: Headers): Promise<void> {
    const token = boundedAccessToken(this.config.token);
    if (!token) throw authError("MCP_AUTH_REQUIRED", "MCP bearer token is not configured", false);
    headers.set("Authorization", `Bearer ${token}`);
  }

  async handleUnauthorized(): Promise<boolean> { return false; }

  status(): McpAuthStatus {
    return { type: this.type, state: this.config.token ? "ready" : "authorization_required" };
  }
}

class OAuthAuthProvider implements McpAuthProvider {
  readonly type = "oauth" as const;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private state: McpAuthStatus["state"] = "authorization_required";
  private error = "";
  private metadata?: OAuthMetadata;

  constructor(private readonly config: McpOAuthConfig, private readonly options: McpAuthProviderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    if (config.accessToken) this.state = tokenExpired(config.expiresAt, this.now()) ? "expired" : "ready";
  }

  async authorize(headers: Headers, resourceUrl: string): Promise<void> {
    if (tokenExpired(this.config.expiresAt, this.now())) await this.refresh(resourceUrl);
    const token = boundedAccessToken(this.config.accessToken);
    if (!token) {
      this.state = "authorization_required";
      throw authError("MCP_OAUTH_AUTHORIZATION_REQUIRED", "MCP OAuth authorization is required", false);
    }
    headers.set("Authorization", `Bearer ${token}`);
    this.state = "ready";
  }

  async handleUnauthorized(response: Response, resourceUrl: string): Promise<boolean> {
    if (response.status !== 401) return false;
    const challenge = response.headers.get("www-authenticate") || "";
    const metadataUrl = parseResourceMetadataChallenge(challenge);
    if (metadataUrl) this.config.resourceMetadataUrl = metadataUrl;
    this.config.accessToken = undefined;
    this.state = "expired";
    if (!this.config.refreshToken) return false;
    await this.refresh(resourceUrl);
    return Boolean(this.config.accessToken);
  }

  status(): McpAuthStatus {
    return {
      type: this.type,
      state: this.state,
      ...(this.config.expiresAt ? { expiresAt: this.config.expiresAt } : {}),
      ...(this.error ? { error: redactMcpText(this.error) } : {}),
    };
  }

  private async refresh(resourceUrl: string): Promise<void> {
    const refreshToken = boundedAccessToken(this.config.refreshToken);
    if (!refreshToken) {
      this.state = "authorization_required";
      throw authError("MCP_OAUTH_AUTHORIZATION_REQUIRED", "MCP OAuth refresh token is not configured", false);
    }
    this.state = "refreshing";
    try {
      this.metadata ||= await discoverOAuthMetadata(this.config, resourceUrl, this.fetchImpl);
      const update = await requestToken(this.metadata.tokenEndpoint, {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: validateClientId(this.config.clientId),
        resource: validateRemoteResource(resourceUrl),
      }, this.fetchImpl);
      this.config.accessToken = update.accessToken;
      if (update.refreshToken) this.config.refreshToken = update.refreshToken;
      this.config.expiresAt = update.expiresAt;
      await this.options.onTokenUpdate?.(update);
      this.state = "ready";
      this.error = "";
    } catch (error) {
      this.state = "failed";
      this.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }
}

async function discoverOAuthMetadata(config: McpOAuthConfig, resourceUrl: string, fetchImpl: typeof fetch): Promise<OAuthMetadata> {
  if (config.authorizationEndpoint && config.tokenEndpoint) {
    return {
      issuer: config.authorizationServer || new URL(config.tokenEndpoint).origin,
      authorizationEndpoint: validateSecureUrl(config.authorizationEndpoint, "authorization endpoint"),
      tokenEndpoint: validateSecureUrl(config.tokenEndpoint, "token endpoint"),
      scopesSupported: normalizedScopes(config.scopes),
    };
  }

  let authorizationServer = config.authorizationServer;
  if (!authorizationServer) {
    const resourceMetadataUrl = config.resourceMetadataUrl || new URL("/.well-known/oauth-protected-resource", validateRemoteResource(resourceUrl)).toString();
    const resourceMetadata = await fetchJson(resourceMetadataUrl, fetchImpl);
    const servers = Array.isArray(resourceMetadata.authorization_servers) ? resourceMetadata.authorization_servers : [];
    authorizationServer = typeof servers[0] === "string" ? servers[0] : undefined;
  }
  if (!authorizationServer) throw authError("MCP_OAUTH_METADATA_MISSING", "OAuth protected resource metadata does not identify an authorization server", false);

  const issuer = validateSecureUrl(authorizationServer, "authorization server").replace(/\/$/, "");
  const issuerUrl = new URL(issuer);
  const metadataUrl = new URL(`/.well-known/oauth-authorization-server${issuerUrl.pathname === "/" ? "" : issuerUrl.pathname}`, issuerUrl.origin).toString();
  const metadata = await fetchJson(metadataUrl, fetchImpl);
  const metadataIssuer = typeof metadata.issuer === "string"
    ? validateSecureUrl(metadata.issuer, "authorization server metadata issuer").replace(/\/$/, "")
    : "";
  if (!metadataIssuer || metadataIssuer !== issuer) {
    throw authError("MCP_OAUTH_ISSUER_MISMATCH", "OAuth authorization server metadata issuer does not match the configured issuer", false);
  }
  if (typeof metadata.authorization_endpoint !== "string" || typeof metadata.token_endpoint !== "string") {
    throw authError("MCP_OAUTH_METADATA_INVALID", "OAuth authorization server metadata is incomplete", false);
  }
  return {
    issuer,
    authorizationEndpoint: validateSecureUrl(metadata.authorization_endpoint, "authorization endpoint"),
    tokenEndpoint: validateSecureUrl(metadata.token_endpoint, "token endpoint"),
    scopesSupported: Array.isArray(metadata.scopes_supported)
      ? metadata.scopes_supported.filter((scope): scope is string => typeof scope === "string")
      : [],
  };
}

async function requestToken(tokenEndpoint: string, fields: Record<string, string>, fetchImpl: typeof fetch): Promise<McpOAuthTokenUpdate> {
  const endpoint = validateSecureUrl(tokenEndpoint, "token endpoint");
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(fields),
    redirect: "error",
  });
  if (!response.ok) {
    await cancelResponseBody(response);
    throw authError("MCP_OAUTH_TOKEN_FAILED", `OAuth token endpoint returned HTTP ${response.status}`, response.status >= 500);
  }
  const body = await boundedJson(response);
  const accessToken = boundedAccessToken(body.access_token);
  if (!accessToken) throw authError("MCP_OAUTH_TOKEN_INVALID", "OAuth token response is missing access_token", false);
  const expiresIn = Number(body.expires_in);
  return {
    accessToken,
    ...(boundedAccessToken(body.refresh_token) ? { refreshToken: boundedAccessToken(body.refresh_token) } : {}),
    ...(Number.isFinite(expiresIn) && expiresIn > 0 ? { expiresAt: new Date(Date.now() + Math.min(expiresIn, 31_536_000) * 1000).toISOString() } : {}),
  };
}

async function fetchJson(url: string, fetchImpl: typeof fetch): Promise<Record<string, unknown>> {
  const endpoint = validateSecureUrl(url, "OAuth metadata URL");
  const response = await fetchImpl(endpoint, { headers: { accept: "application/json" }, redirect: "error" });
  if (!response.ok) {
    await cancelResponseBody(response);
    throw authError("MCP_OAUTH_DISCOVERY_FAILED", `OAuth metadata returned HTTP ${response.status}`, response.status >= 500);
  }
  return boundedJson(response);
}

async function boundedJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.body) throw authError("MCP_OAUTH_RESPONSE_INVALID", "OAuth response has no body", false);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 512 * 1024) {
        try { await reader.cancel("OAuth response exceeded the size limit"); } catch {}
        throw authError("MCP_OAUTH_RESPONSE_TOO_LARGE", "OAuth response exceeded the size limit", false);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw authError("MCP_OAUTH_RESPONSE_INVALID", "OAuth response must be a JSON object", false);
  return value as Record<string, unknown>;
}

function parseResourceMetadataChallenge(challenge: string): string | undefined {
  const match = /(?:^|[,\s])resource_metadata="([^"]+)"/i.exec(challenge);
  return match ? validateSecureUrl(match[1], "resource metadata URL") : undefined;
}

function tokenExpired(expiresAt: string | undefined, now: number): boolean {
  if (!expiresAt) return false;
  const timestamp = Date.parse(expiresAt);
  return !Number.isFinite(timestamp) || timestamp <= now + EXPIRY_SKEW_MS;
}

function validateSecureUrl(value: string, label: string): string {
  const url = new URL(value);
  const loopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw authError("MCP_OAUTH_INSECURE_URL", `${label} must use HTTPS`, false);
  }
  if (url.username || url.password || url.hash) throw authError("MCP_OAUTH_URL_INVALID", `${label} cannot contain credentials or fragments`, false);
  return url.toString();
}

function validateRemoteResource(value: string): string {
  return validateSecureUrl(value, "MCP resource URL");
}

function validateRedirectUri(value: string): string {
  const url = new URL(value);
  if (!(["http:", "https:"].includes(url.protocol) && ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname))) {
    throw authError("MCP_OAUTH_REDIRECT_INVALID", "OAuth redirect URI must be a loopback HTTP(S) URL", false);
  }
  return url.toString();
}

function validateClientId(value: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 512 || /[\0\r\n]/.test(value)) {
    throw authError("MCP_OAUTH_CLIENT_INVALID", "OAuth clientId is invalid", false);
  }
  return value;
}

function boundedTokenField(value: string, label: string): string {
  if (typeof value !== "string" || !value || value.length > 8192 || /[\0\r\n]/.test(value)) {
    throw authError("MCP_OAUTH_FIELD_INVALID", `${label} is invalid`, false);
  }
  return value;
}

function boundedAccessToken(value: unknown): string | undefined {
  if (typeof value !== "string" || !value || value.length > 128 * 1024 || /[\0\r\n]/.test(value)) return undefined;
  return value;
}

function normalizedScopes(configured: string[] | undefined, supported: string[] = []): string[] {
  const scopes = Array.isArray(configured) && configured.length ? configured : supported;
  return [...new Set(scopes.filter((scope) => typeof scope === "string" && /^[A-Za-z0-9._:/-]{1,128}$/.test(scope)))].slice(0, 32);
}

function authError(code: string, message: string, retryable: boolean): McpError {
  return new McpError({ kind: "authentication", code, message, retryable });
}

function base64Url(value: Buffer): string {
  return value.toString("base64url");
}

async function cancelResponseBody(response: Response): Promise<void> {
  try { await response.body?.cancel(); } catch {}
}
