import 'jasmine';
import { GoogleAuthentication } from '../../src/index';
import { maindb } from '../../database/main';

beforeAll(async () => {
	await maindb.init();
});

afterAll(async () => {
	await maindb.disconnect();
});

describe('GoogleAuthentication Exports', () => {
	it('should export GoogleAuthentication class', () => {
		expect(GoogleAuthentication).toBeDefined();
	});
});
