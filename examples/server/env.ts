import { AppConfig, configure } from 'ts-appconfig';

/**
 * Example application configuration
 * Loads from environment variables or .env file
 */
class AppConfiguration extends AppConfig {
	// Google OAuth Configuration
	readonly GOOGLE_CLIENT_ID: string = '';
	readonly GOOGLE_CLIENT_SECRET: string = '';
	readonly GOOGLE_REDIRECT_URI: string =
		'http://localhost:3000/auth/google/callback';

	// Session Configuration
	readonly SESSION_SECRET: string = 'your-session-secret';

	// Server Configuration
	readonly SERVER_PORT: number = 3000;
	readonly SERVER_HOST: string = 'localhost';

	// Database Configuration (inherits from AppConfig)
	override NODE_ENV: string = 'development';
}

/**
 * Configured application environment
 */
export const env = configure(AppConfiguration, {
	relativePath: './.env',
});
