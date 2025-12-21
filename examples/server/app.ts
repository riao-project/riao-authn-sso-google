/* eslint-disable no-console */

import express, { Request, Response } from 'express';
import session from 'express-session';
import { GoogleAuthentication } from '../../src/index';
import { env } from './env';
import { createDatabase, runMigrations } from '../../test/database';
import { maindb } from '../../database/main';
import { AuthMigrations } from '@riao/iam/auth/auth-migrations';
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
const googleAuth = new GoogleAuthentication({
	db,
	clientId: env.GOOGLE_CLIENT_ID,
	clientSecret: env.GOOGLE_CLIENT_SECRET,
	redirectUri: env.GOOGLE_REDIRECT_URI,
	scopes: ['openid', 'profile', 'email'],
});

export type SessionRequest = Request & {
	session: {
		userId?: string | null;
		userEmail?: string | null;
	};
};

// Routes

/**
 * Home page
 */
app.get('/', (req: Request, res: Response) => {
	const session = (req as SessionRequest).session;
	if (session.userId) {
		res.send(`
			<h1>Welcome!</h1>
			<p>You are logged in as: ${session.userEmail}</p>
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
		console.error('Failed to initiate authentication:', error);
		res.redirect(`/?error=${encodeURIComponent((error as Error).message)}`);
	}
});

/**
 * Google OAuth callback handler
 */
app.get('/auth/google/callback', async (req: Request, res: Response) => {
	const { code, state, error } = req.query as {
		code?: string;
		state?: string;
		error?: string;
	};

	const session = (req as SessionRequest).session;

	try {
		// Check for errors from Google
		if (error) {
			throw new Error(`Google error: ${error}`);
		}

		// Validate required parameters
		if (!code || !state) {
			throw new Error('Missing code or state parameter');
		}

		// Authenticate with Google
		const principal = await googleAuth.authenticate({
			code,
			state,
		});

		if (!principal) {
			throw new Error('Authentication failed');
		}

		// Store user info in session
		session.userId = principal.id;
		session.userEmail = principal.name;

		res.redirect('/');
	}
	catch (error) {
		console.error('Authentication error:', error);
		res.redirect(`/?error=${encodeURIComponent((error as Error).message)}`);
	}
});

/**
 * Logout handler
 */
app.get('/logout', (req: Request, res: Response) => {
	const session = (req as SessionRequest).session;
	session.userId = null;
	session.userEmail = null;
	res.redirect('/');
});

/**
 * Protected route example
 */
app.get('/dashboard', (req: Request, res: Response) => {
	const session = (req as SessionRequest).session;
	if (!session.userId) {
		return res.redirect('/');
	}

	res.send(`
		<h1>Dashboard</h1>
		<p>User: ${session.userEmail}</p>
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
		console.log(`Login page: http://localhost:${port}/login`);
		console.log(
			`Callback URL: http://localhost:${port}/auth/google/callback`
		);
		console.log(`Environment: ${env.NODE_ENV}`);
	});
}

initialize().catch((err) => {
	console.error('Failed to initialize application:', err);
	process.exit(1);
});

export default app;
