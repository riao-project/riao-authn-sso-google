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
const state = await googleAuth.generateState(); // Generate and store state for CSRF protection
const authUrl = googleAuth.getAuthorizationUrl(state);

// Redirect user to authUrl
res.redirect(authUrl);
```

### Handle Callback

After user authorizes, Google redirects to your callback endpoint with `code` and `state`:

Pass the callback's `state` value to `authenticate` when the provider returns
it; a supplied state is validated and consumed before code exchange.

```typescript
app.get('/auth/google/callback', async (req, res) => {
	const code = req.query['code'];
	const state = req.query['state'];
	if (typeof code !== 'string' ||
		(state !== undefined && typeof state !== 'string')) {
		res.redirect('/login?error=authentication_failed');
		return;
	}

	const credentials: { code: string; state?: string } = { code };
	if (typeof state === 'string') {
		credentials.state = state;
	}
	const principal = await googleAuth.authenticate(credentials);

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
// Uses generateState() to create and store state in database for CSRF protection
app.get('/auth/google', async (req, res) => {
	try {
		// generateState() creates a random state and stores it in the database
		// The state will be validated in the callback handler
		const state = await googleAuth.generateState();
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
	
	try {
		if (typeof code !== 'string' ||
			(state !== undefined && typeof state !== 'string')) {
			return res.redirect('/login?error=auth_failed');
		}
		// authenticate() validates the state against the database
		// and handles the OAuth code exchange
		const credentials = typeof state === 'string'
			? { code, state }
			: { code };
		const principal = await googleAuth.authenticate(credentials);
		
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

### Invalid state (`authenticate` returns `null`)

This rejection occurs when state was not stored before redirect, expired, or was already consumed. Direct `validateState` throws a typed rejection.

**Solution:** Use `generateState()` to create and store the state:

```typescript
// ❌ WRONG - This won't work
app.get('/auth/google', (req, res) => {
	const state = randomBytes(32).toString('hex'); // Not saved to database!
	const authUrl = googleAuth.getAuthorizationUrl(state);
	res.redirect(authUrl);
});

// ✅ CORRECT - State is saved to database
app.get('/auth/google', async (req, res) => {
	const state = await googleAuth.generateState(); // Saves to database
	const authUrl = googleAuth.getAuthorizationUrl(state);
	res.redirect(authUrl);
});
```

The `generateState()` method creates a cryptographically random state and stores it in the database with an expiration time. The `authenticate()` method then validates this state during the callback to prevent CSRF attacks.

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
