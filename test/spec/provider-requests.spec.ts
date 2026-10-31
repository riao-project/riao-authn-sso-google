import 'jasmine';
import { Database } from '@riao/dbal';
import { Principal } from '@riao/iam';
import {
	ProviderAuthenticationRejectedError,
} from '@riao/authn-sso';
import { GoogleAuthentication } from '../../src/authentication-google';

describe('Google provider requests', () => {
	const db = { getQueryRepository: () => ({}) } as unknown as Database;
	const options = {
		db,
		clientId: 'client',
		clientSecret: 'secret',
		redirectUri: 'https://example.com/callback',
		requestTimeoutMs: 25,
	};
	let auth: GoogleAuthentication<Principal>;

	beforeEach(() => {
		auth = new GoogleAuthentication(options);
	});

	it('uses the configured timeout for token and user requests', async () => {
		const timeoutSpy = spyOn(AbortSignal, 'timeout').and.callThrough();
		const fetchSpy = spyOn(global, 'fetch').and.resolveTo(
			new Response(JSON.stringify({
				access_token: 'token',
				expires_in: 3600,
			}))
		);
		await auth.exchangeAuthorizationCode('code');
		expect(fetchSpy.calls.mostRecent().args[1]?.signal).toBeDefined();
		expect(timeoutSpy).toHaveBeenCalledWith(options.requestTimeoutMs);

		fetchSpy.and.resolveTo(new Response(JSON.stringify({
			id: 'id',
			email: 'user@example.com',
			name: 'Example User',
		})));
		await auth['getUserInfo']('token');
		expect(fetchSpy.calls.mostRecent().args[1]?.signal).toBeDefined();
		expect(timeoutSpy).toHaveBeenCalledWith(options.requestTimeoutMs);
		expect(timeoutSpy).toHaveBeenCalledTimes(2);
	});

	it('classifies expected provider rejections', async () => {
		spyOn(global, 'fetch').and.resolveTo(new Response(JSON.stringify({
			error: 'invalid_grant',
			error_description: 'secret-token',
		}), { status: 400 }));

		await expectAsync(auth.exchangeAuthorizationCode('code'))
			.toBeRejectedWithError(ProviderAuthenticationRejectedError);
	});

	it(
		'rejects malformed provider responses before trusting them',
		async () => {
			const fetchSpy = spyOn(global, 'fetch').and.resolveTo(
				new Response(JSON.stringify({
					access_token: 'token',
					expires_in: '3600',
				}))
			);
			await expectAsync(auth.exchangeAuthorizationCode('code'))
				.toBeRejectedWithError('Malformed provider token response');

			fetchSpy.and.resolveTo(new Response(JSON.stringify({
				id: 123,
				email: 'user@example.com',
			})));
			await expectAsync(auth['getUserInfo']('token'))
				.toBeRejectedWithError('Malformed provider user response');
		}
	);
});
