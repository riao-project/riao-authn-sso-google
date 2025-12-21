import 'jasmine';
import {
	GoogleAuthentication,
	GoogleAuthenticationOptions,
} from '../../src/index';
import { createDatabase, runMigrations } from '../database';
import { maindb } from '../../database/main';
import { testEnv } from '../env';
import { Database } from '@riao/dbal';
import { AuthMigrations } from '@riao/iam/auth/auth-migrations';
import { Principal } from '@riao/iam';

describe('GoogleAuthentication', () => {
	let db: Database;
	let googleAuth: GoogleAuthentication<Principal>;

	const mockGoogleOptions: GoogleAuthenticationOptions = {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		db: null as any,
		clientId: testEnv.GOOGLE_CLIENT_ID,
		clientSecret: testEnv.GOOGLE_CLIENT_SECRET,
		redirectUri: testEnv.GOOGLE_REDIRECT_URI,
		scopes: ['openid', 'profile', 'email'],
	};

	beforeAll(async () => {
		await maindb.init();
		db = createDatabase(testEnv.TEST_DATABASE_NAME);
		await db.init();
		const authMigrations = new AuthMigrations();
		await runMigrations(db, authMigrations);
	});

	afterAll(async () => {
		await db.disconnect();
	});

	beforeEach(() => {
		googleAuth = new GoogleAuthentication<Principal>({
			...mockGoogleOptions,
			db,
		});
	});

	describe('Constructor', () => {
		it('should initialize with provided options', () => {
			expect(googleAuth['clientId']).toBe(testEnv.GOOGLE_CLIENT_ID);
			expect(googleAuth['clientSecret']).toBe(
				testEnv.GOOGLE_CLIENT_SECRET
			);
			expect(googleAuth['redirectUri']).toBe(testEnv.GOOGLE_REDIRECT_URI);
		});

		it('should set default scopes when not provided', () => {
			const authWithoutScopes = new GoogleAuthentication<Principal>({
				db,
				clientId: 'client-id',
				clientSecret: 'client-secret',
				redirectUri: 'https://localhost:3000/callback',
			});

			expect(authWithoutScopes['scopes']).toEqual([
				'openid',
				'profile',
				'email',
			]);
		});

		it('should set custom scopes when provided', () => {
			const customScopes = ['openid', 'profile'];
			const authWithCustomScopes = new GoogleAuthentication<Principal>({
				...mockGoogleOptions,
				db,
				scopes: customScopes,
			});

			expect(authWithCustomScopes['scopes']).toEqual(customScopes);
		});

		it('should set provider to "google"', () => {
			expect(googleAuth['provider']).toBe('google');
		});
	});

	describe('getAuthorizationUrl', () => {
		it('should generate valid authorization URL', () => {
			const state = 'test-state-123';
			const url = googleAuth.getAuthorizationUrl(state);
			const encoded = encodeURIComponent(testEnv.GOOGLE_REDIRECT_URI);

			expect(url).toContain(
				'https://accounts.google.com/o/oauth2/v2/auth'
			);
			expect(url).toContain(`client_id=${testEnv.GOOGLE_CLIENT_ID}`);
			expect(url).toContain(`redirect_uri=${encoded}`);
			expect(url).toContain('response_type=code');
			expect(url).toContain(`state=${state}`);
			expect(url).toContain('access_type=offline');
			expect(url).toContain('prompt=consent');
		});

		it('should include scopes in authorization URL', () => {
			const state = 'test-state-456';
			const url = googleAuth.getAuthorizationUrl(state);

			expect(url).toContain('scope=openid');
			expect(url).toContain('profile');
			expect(url).toContain('email');
		});
	});

	describe('exchangeAuthorizationCode', () => {
		it('should handle token exchange error', async () => {
			spyOn(global, 'fetch').and.returnValue(
				Promise.resolve(
					new Response(JSON.stringify({ error: 'invalid_code' }), {
						status: 400,
						statusText: 'Bad Request',
					})
				)
			);

			try {
				await googleAuth.exchangeAuthorizationCode('invalid-code');
				fail('Should throw error');
			}
			catch (error) {
				expect((error as Error).message).toContain(
					'Google token exchange failed'
				);
			}
		});

		it('should successfully exchange authorization code', async () => {
			const mockTokenResponse = {
				access_token: 'mock-access-token',
				refresh_token: 'mock-refresh-token',
				expires_in: 3600,
				token_type: 'Bearer',
			};

			spyOn(global, 'fetch').and.returnValue(
				Promise.resolve(
					new Response(JSON.stringify(mockTokenResponse), {
						status: 200,
					})
				)
			);

			const result =
				await googleAuth.exchangeAuthorizationCode('test-code');

			expect(result.access_token).toBe('mock-access-token');
			expect(result.refresh_token).toBe('mock-refresh-token');
			expect(result.expires_in).toBe(3600);
		});
	});

	describe('getUserInfo', () => {
		it('should fetch user information', async () => {
			const mockUserInfo = {
				id: '123456789',
				email: 'user@example.com',
				name: 'Test User',
				picture: 'https://example.com/photo.jpg',
				locale: 'en',
			};

			spyOn(global, 'fetch').and.returnValue(
				Promise.resolve(
					new Response(JSON.stringify(mockUserInfo), {
						status: 200,
					})
				)
			);

			const userInfo = await googleAuth['getUserInfo']('mock-token');

			expect(userInfo.id).toBe('123456789');
			expect(userInfo.login).toBe('user@example.com');
			expect(userInfo.name).toBe('Test User');
			expect(userInfo.type).toBe('user');
		});

		it('should handle user info fetch error', async () => {
			spyOn(global, 'fetch').and.returnValue(
				Promise.resolve(
					new Response('Unauthorized', {
						status: 401,
						statusText: 'Unauthorized',
					})
				)
			);

			try {
				await googleAuth['getUserInfo']('invalid-token');
				fail('Should throw error');
			}
			catch (error) {
				expect((error as Error).message).toContain(
					'Failed to fetch Google user info'
				);
			}
		});
	});

	describe('exchangeRefreshToken', () => {
		it('should refresh access token successfully', async () => {
			const mockTokenResponse = {
				access_token: 'new-access-token',
				expires_in: 3600,
				token_type: 'Bearer',
			};

			spyOn(global, 'fetch').and.returnValue(
				Promise.resolve(
					new Response(JSON.stringify(mockTokenResponse), {
						status: 200,
					})
				)
			);

			const result =
				await googleAuth['exchangeRefreshToken']('refresh-token');

			expect(result.access_token).toBe('new-access-token');
			expect(result.expires_in).toBe(3600);
		});

		it('should handle refresh token error', async () => {
			spyOn(global, 'fetch').and.returnValue(
				Promise.resolve(
					new Response(JSON.stringify({ error: 'invalid_grant' }), {
						status: 400,
						statusText: 'Bad Request',
					})
				)
			);

			try {
				await googleAuth['exchangeRefreshToken'](
					'invalid-refresh-token'
				);
				fail('Should throw error');
			}
			catch (error) {
				expect((error as Error).message).toContain(
					'Google token refresh failed'
				);
			}
		});
	});
});
