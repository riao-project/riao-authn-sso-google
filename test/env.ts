import { AppConfig, configure } from 'ts-appconfig';

/**
 * Test environment configuration with strong typing
 * Provides test-specific configuration for Google authentication tests
 */
class TestEnvironment extends AppConfig {
	// Google OAuth credentials
	// For unit tests: defaults to test values
	// For integration tests: must be set via environment variables or .env.test
	readonly GOOGLE_CLIENT_ID: string =
		'test-client-id.apps.googleusercontent.com';
	readonly GOOGLE_CLIENT_SECRET: string = 'test-client-secret';

	// Google OAuth configuration
	readonly GOOGLE_REDIRECT_URI: string =
		'https://localhost:3000/auth/google/callback';

	// Test database configuration
	readonly TEST_DATABASE_NAME: string = 'google_test_db';

	// Test mode indicator
	override NODE_ENV: string = 'test';
}

/**
 * Configured test environment with variables loaded from .env.test,
 * process.env (overrides), and defaults
 */
export const testEnv = configure(TestEnvironment, {
	relativePath: './.env.test',
});
