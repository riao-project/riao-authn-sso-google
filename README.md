# @riao/authn-sso-google

Google OAuth2/OIDC authentication driver for riao-iam.

## Installation

```bash
npm install @riao/authn-sso-google @riao/iam @riao/dbal
npm install --save-dev @riao/cli
```

## Database Setup

Import SSO tables into your database:

```bash
npx riao migration:create import-sso-google-tables
```

`database/main/migrations/123456789-import-sso-tables.ts`:

```typescript
import { AuthenticationSSOMigrations } from '@riao/authn-sso/authentication-sso-migrations';

export default AuthenticationSSOMigrations;
```

Then run migrations:

```bash
npm run migration up
```

## Google OAuth Setup

### 1. Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project
3. Enable the Google+ API

### 2. Create OAuth 2.0 Credentials

1. Navigate to "Credentials" → "Create Credentials" → "OAuth client ID"
2. Choose "Web application"
3. Add authorized redirect URIs:
   - `https://yourdomain.com/auth/google/callback`
   - `http://localhost:3000/auth/google/callback` (for development)
4. Save the Client ID and Client Secret

### 3. Configuration

```typescript
import { GoogleAuthentication } from '@riao/authn-sso-google';

const googleAuth = new GoogleAuthentication({
	db: database,
	clientId: process.env.GOOGLE_CLIENT_ID!,
	clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
	redirectUri: process.env.GOOGLE_REDIRECT_URI!,
});
```

### Environment Variables

```bash
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=https://yourdomain.com/auth/google/callback
```

### Custom Scopes

By default, the driver requests: `openid`, `profile`, `email`.

To customize scopes:

```typescript
const googleAuth = new GoogleAuthentication({
	// ... other options
	scopes: ['openid', 'profile', 'email', 'https://www.googleapis.com/auth/calendar'],
});
```

## Usage

### Get Authorization URL

```typescript
const { state, stateBinding } = await googleAuth.generateState();
req.session.oauthState = state;
req.session.oauthStateBinding = stateBinding;
await new Promise<void>((resolve, reject) => {
	req.session.save((error) => error ? reject(error) : resolve());
});
const authUrl = googleAuth.getAuthorizationUrl(state);

res.redirect(authUrl);
```

### Handle Callback

After user authorizes, Google redirects to your callback endpoint with `code` and `state`:

Require the callback's `state` to match the value saved in the browser session.
Pass it and the saved session binding to `authenticate`; the state is consumed
before the authorization code is exchanged.

```typescript
app.get('/auth/google/callback', async (req, res) => {
	const code = req.query['code'];
	const state = req.query['state'];
	const session = req.session;
	const stateBinding = session.oauthStateBinding;
	if (
		typeof code !== 'string' || !code ||
		typeof state !== 'string' || !state ||
		session.oauthState !== state ||
		typeof stateBinding !== 'string' || !stateBinding
	) {
		res.redirect('/login?error=authentication_failed');
		return;
	}

	delete session.oauthState;
	delete session.oauthStateBinding;
	await new Promise<void>((resolve, reject) => {
		session.save((error) => error ? reject(error) : resolve());
	});

	const principal = await googleAuth.authenticate({
		code,
		state,
		stateBinding,
	});

	if (principal) {
		// Store the authenticated principal in the application session.
	} else {
		res.redirect('/login?error=authentication_failed');
	}
});
```

### Refresh Tokens

Automatically refresh access tokens using stored refresh tokens:

```typescript
// Retrieve stored token record for user
// `principal` is the authenticated principal from the callback/session.
const principalId = principal.id;
const tokenRecord = await googleAuth.getStoredToken(principalId);

// Refresh if expired
if (tokenRecord && tokenRecord.expires_at < new Date()) {
	await googleAuth.refreshAccessToken(principalId);
}
```

## Complete Example

```typescript
import express from 'express';
import session from 'express-session';
import { GoogleAuthentication } from '@riao/authn-sso-google';
import { Principal } from '@riao/iam';

declare module 'express-session' {
	interface SessionData {
		principal?: Principal;
		oauthState?: string;
		oauthStateBinding?: string;
	}
}

const app = express();

// Setup session middleware
app.use(session({
	secret: process.env.SESSION_SECRET!,
	resave: false,
	saveUninitialized: false,
}));

const googleAuth = new GoogleAuthentication({
	db: database,
	clientId: process.env.GOOGLE_CLIENT_ID!,
	clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
	redirectUri: process.env.GOOGLE_REDIRECT_URI!,
});

// Redirect to Google login
// Bind generated state to this browser session for CSRF protection.
app.get('/auth/google', async (req, res) => {
	try {
		const { state, stateBinding } = await googleAuth.generateState();
		req.session.oauthState = state;
		req.session.oauthStateBinding = stateBinding;
		await new Promise<void>((resolve, reject) => {
			req.session.save((error) => error ? reject(error) : resolve());
		});
		const authUrl = googleAuth.getAuthorizationUrl(state);
		res.redirect(authUrl);
	} catch (error) {
		console.error('Google authentication setup failed', {
			errorType: error instanceof Error ? error.name : typeof error,
		});
		res.redirect('/login?error=auth_error');
	}
});

// Handle Google callback
app.get('/auth/google/callback', async (req, res) => {
	const code = req.query['code'];
	const state = req.query['state'];
	const session = req.session;

	try {
		const stateBinding = session.oauthStateBinding;
		if (
			typeof code !== 'string' || !code ||
			typeof state !== 'string' || !state ||
			session.oauthState !== state ||
			typeof stateBinding !== 'string' || !stateBinding
		) {
			return res.redirect('/login?error=auth_failed');
		}
		delete session.oauthState;
		delete session.oauthStateBinding;
		await new Promise<void>((resolve, reject) => {
			session.save((saveError) =>
				saveError ? reject(saveError) : resolve()
			);
		});

		const principal = await googleAuth.authenticate({
			code,
			state,
			stateBinding,
		});

		if (principal) {
			req.session.principal = principal;
			res.redirect('/dashboard');
		} else {
			res.redirect('/login?error=auth_failed');
		}
	} catch (error) {
		console.error('Google authentication operation failed', {
			errorType: error instanceof Error ? error.name : typeof error,
		});
		res.redirect('/login?error=auth_error');
	}
});
```

## Troubleshooting

### Invalid state

The callback is rejected if its state does not match the value saved in the
browser session, the session binding is missing, or the state has expired or
already been consumed.

**Solution:** Save both values returned by `generateState()` in the browser
session before redirecting:

```typescript
// ❌ WRONG - A manually generated state has no session binding
app.get('/auth/google', (req, res) => {
	const state = randomBytes(32).toString('hex');
	const authUrl = googleAuth.getAuthorizationUrl(state);
	res.redirect(authUrl);
});

// ✅ CORRECT - Save the generated state and binding in the browser session
app.get('/auth/google', async (req, res) => {
	const { state, stateBinding } = await googleAuth.generateState();
	req.session.oauthState = state;
	req.session.oauthStateBinding = stateBinding;
	await new Promise<void>((resolve, reject) => {
		req.session.save((error) => error ? reject(error) : resolve());
	});
	const authUrl = googleAuth.getAuthorizationUrl(state);
	res.redirect(authUrl);
});
```

Store the generated state and binding in the user's session before redirecting
to Google. On callback, require the returned state to match the session value,
consume both session values, and pass `{ code, state, stateBinding }` to
`authenticate()` so it can validate the browser binding and prevent CSRF.

### "Database table not found"

Ensure you've run the SSO migrations to create the required tables:

```bash
npx riao migration:create import-sso-google-tables
```

Then add to your migration file:

```typescript
import { AuthenticationSSOMigrations } from '@riao/authn-sso/authentication-sso-migrations';
export default AuthenticationSSOMigrations;
```

Run migrations:

```bash
npm run migration up
```

## Contributing & Development

See [contributing.md](docs/contributing/contributing.md) for information on how to develop or contribute to this project!

## Related Drivers

- [@riao/authn-sso](https://github.com/riao-project/authn-sso) - Base SSO driver
- [@riao/authn-sso-entra](https://github.com/riao-project/authn-sso-entra) - Microsoft Entra ID
- [@riao/authn-password](https://github.com/riao-project/authn-password) - Password authentication

## License

MIT
