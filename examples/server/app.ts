/* eslint-disable no-console */

import express, { Request, Response } from 'express';
import session from 'express-session';
import { GoogleAuthentication } from '../../src/index';
import { env } from './env';
import { createDatabase, runMigrations } from '../../test/database';
import { maindb } from '../../database/main';
import { AuthMigrations } from '@riao/iam/auth/auth-migrations';
import { Principal } from '@riao/iam';
// eslint-disable-next-line max-len
import { AuthenticationSSOMigrations } from '@riao/authn-sso/authentication-sso-migrations';

const db = createDatabase('google_sso_example_db');

/**
 * Express application with Google SSO authentication
 */
const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session middleware
app.use(
	session({
		secret: env.SESSION_SECRET,
		resave: false,
		saveUninitialized: false,
		cookie: {
			secure: false, // Set to true in production with HTTPS
			maxAge: 1000 * 60 * 60 * 24, // 24 hours
		},
	})
);

// Initialize Google authentication
const googleAuth = new GoogleAuthentication<Principal>({
	db,
	clientId: env.GOOGLE_CLIENT_ID,
	clientSecret: env.GOOGLE_CLIENT_SECRET,
	redirectUri: env.GOOGLE_REDIRECT_URI,
	scopes: ['openid', 'profile', 'email'],
});

function logSafeFailure(operation: string, error: unknown): void {
	console.error(operation, {
		errorType: error instanceof Error ? error.name : typeof error,
	});
}

declare module 'express-session' {
	interface SessionData {
		principal?: Principal;
	}
}

// Routes

/**
 * Home page
 */
app.get('/', (req: Request, res: Response) => {
	const session = req.session;
	if (session.principal) {
		res.send(`
			<h1>Welcome!</h1>
			<p>You are logged in.</p>
			<a href="/logout">Logout</a>
		`);
	}
	else {
		res.send(`
			<h1>Welcome to Google SSO Example</h1>
			<a href="/auth/google">Login with Google</a>
		`);
	}
});

/**
 * Initiate Google OAuth flow
 */
app.get('/auth/google', async (req: Request, res: Response) => {
	try {
		// Generate and store state for CSRF protection in database
		const state = await googleAuth.generateState();

		// Get authorization URL and redirect
		const authUrl = googleAuth.getAuthorizationUrl(state);
		res.redirect(authUrl);
	}
	catch (error) {
		logSafeFailure('Google authentication setup failed', error);
		res.redirect('/?error=authentication_unavailable');
	}
});

/**
 * Google OAuth callback handler
 */
app.get('/auth/google/callback', async (req: Request, res: Response) => {
	const code = req.query['code'];
	const state = req.query['state'];
	const error = req.query['error'];

	try {
		// Check for errors from Google
		if (error) {
			console.warn('Google OAuth callback returned an error');
			res.redirect('/?error=authentication_failed');
			return;
		}
		if (typeof code !== 'string' || !code) {
			res.redirect('/?error=authentication_failed');
			return;
		}
		if (state !== undefined && typeof state !== 'string') {
			res.redirect('/?error=authentication_failed');
			return;
		}

		// Authenticate with Google
		const credentials: { code: string; state?: string } = { code };
		if (typeof state === 'string') {
			credentials.state = state;
		}
		const principal = await googleAuth.authenticate(credentials);

		if (!principal) {
			res.redirect('/?error=authentication_failed');
			return;
		}

		// Store the principal for downstream authorization.
		req.session.principal = principal;
		await new Promise<void>((resolve, reject) => {
			req.session.save((error) => error ? reject(error) : resolve());
		});
		res.redirect('/');
	}
	catch (error) {
		logSafeFailure('Google authentication operation failed', error);
		res.status(503).json({ error: 'Authentication unavailable' });
	}
});

/**
 * Logout handler
 */
app.get('/logout', (req: Request, res: Response) => {
	const session = req.session;

	if (!session) {
		return res.redirect('/');
	}

	session.destroy((err) => {
		if (err) {
			logSafeFailure('Google session logout failed', err);
		}
		res.redirect('/');
	});
});

/**
 * Protected route example
 */
app.get('/dashboard', (req: Request, res: Response) => {
	const session = req.session;
	if (!session.principal) {
		return res.redirect('/');
	}

	res.send(`
		<h1>Dashboard</h1>
		<p>Authenticated user</p>
		<a href="/logout">Logout</a>
	`);
});

// Start server
const port = env.SERVER_PORT;

// Initialize database
async function initializeDatabase() {
	await maindb.init();
	await db.init();
	await runMigrations(db, new AuthMigrations());
	await runMigrations(db, new AuthenticationSSOMigrations());
}

async function initialize() {
	await initializeDatabase();

	app.listen(port, () => {
		console.log(`Server running on http://localhost:${port}`);
		console.log(`Login page: http://localhost:${port}/`);
		console.log(
			`Callback URL: http://localhost:${port}/auth/google/callback`
		);
		console.log(`Environment: ${env.NODE_ENV}`);
	});
}

initialize().catch((err) => {
	logSafeFailure('Application initialization failed', err);
	process.exit(1);
});

export default app;
