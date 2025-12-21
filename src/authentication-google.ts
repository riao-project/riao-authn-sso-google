import {
	SSOAuthentication,
	SSOUserInfo,
	SSOTokenResponse,
	SSOAuthenticationOptions,
} from '@riao/authn-sso';
import { Principal } from '@riao/iam';

export interface GoogleAuthenticationOptions extends Omit<
	SSOAuthenticationOptions,
	'provider'
> {
	clientId: string;
	clientSecret: string;
	redirectUri: string;
	scopes?: string[];
}

/**
 * Google OAuth2/OIDC SSO authentication driver
 * Extends generic SSOAuthentication with Google-specific
 * OAuth2/OIDC implementation
 */
export class GoogleAuthentication<
	TPrincipal extends Principal,
> extends SSOAuthentication<TPrincipal> {
	protected readonly clientId: string;
	protected readonly clientSecret: string;
	protected readonly redirectUri: string;
	protected readonly scopes: string[];

	constructor(options: GoogleAuthenticationOptions) {
		super({
			db: options.db,
			provider: 'google',
		});
		this.clientId = options.clientId;
		this.clientSecret = options.clientSecret;
		this.redirectUri = options.redirectUri;
		// Default scopes: openid for ID token, profile & email for user info
		this.scopes = options.scopes || ['openid', 'profile', 'email'];
	}

	/**
	 * Generate Google authorization URL
	 */
	public getAuthorizationUrl(state: string): string {
		const baseUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
		const params = new URLSearchParams(this.getAuthorizationParams(state));
		return `${baseUrl}?${params}`;
	}

	/**
	 * Get authorization URL query parameters for Google
	 */
	protected getAuthorizationParams(state: string): Record<string, string> {
		return {
			client_id: this.clientId,
			redirect_uri: this.redirectUri,
			response_type: 'code',
			scope: this.scopes.join(' '),
			state,
			access_type: 'offline',
			prompt: 'consent',
		};
	}

	/**
	 * Exchange authorization code for tokens
	 */
	public async exchangeAuthorizationCode(
		code: string
	): Promise<SSOTokenResponse> {
		const tokenUrl = 'https://oauth2.googleapis.com/token';

		const response = await fetch(tokenUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				client_id: this.clientId,
				client_secret: this.clientSecret,
				code,
				redirect_uri: this.redirectUri,
				grant_type: 'authorization_code',
			}).toString(),
		});

		if (!response.ok) {
			throw new Error(
				`Google token exchange failed: ${response.status}` +
					` ${response.statusText}`
			);
		}

		return response.json() as Promise<SSOTokenResponse>;
	}

	/**
	 * Fetch user information from Google userinfo endpoint
	 */
	protected async getUserInfo(accessToken: string): Promise<SSOUserInfo> {
		const response = await fetch(
			'https://www.googleapis.com/oauth2/v2/userinfo',
			{
				method: 'GET',
				headers: {
					Authorization: `Bearer ${accessToken}`,
					'Content-Type': 'application/json',
				},
			}
		);

		if (!response.ok) {
			const errorBody = await response.text();
			throw new Error(
				`Failed to fetch Google user info: ${response.status}` +
					` ${response.statusText}. ` +
					`Error details: ${errorBody}`
			);
		}

		const userData = (await response.json()) as {
			id: string;
			email?: string;
			name?: string;
			picture?: string;
			locale?: string;
		};

		return {
			id: userData.id,
			login: userData.email || '',
			name: userData.name || userData.email || '',
			type: 'user',
			picture: userData.picture,
			locale: userData.locale,
		};
	}

	/**
	 * Exchange refresh token for new access token
	 */
	protected async exchangeRefreshToken(
		refreshToken: string
	): Promise<SSOTokenResponse> {
		const tokenUrl = 'https://oauth2.googleapis.com/token';

		const response = await fetch(tokenUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				client_id: this.clientId,
				client_secret: this.clientSecret,
				refresh_token: refreshToken,
				grant_type: 'refresh_token',
			}).toString(),
		});

		if (!response.ok) {
			throw new Error(
				`Google token refresh failed: ${response.status}` +
					` ${response.statusText}`
			);
		}

		return response.json() as Promise<SSOTokenResponse>;
	}
}
