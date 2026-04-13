import 'dotenv/config';
import http from 'http';
import { createApp } from '../../app';
import { connectDB } from '../../config/db';
import { config } from '../../config/env';
import mongoose from 'mongoose';

export async function startTestServer() {
	await connectDB(config.mongo.uri, config.mongo.dbName);

	const app = createApp();
	const server = http.createServer(app);

	await new Promise<void>((resolve) => server.listen(0, resolve));

	return server;
}

export async function stopTestServer(server: http.Server) {
	await new Promise<void>((resolve) => server.close(() => resolve()));
	await mongoose.disconnect();
}

export function getBaseUrl(server: http.Server) {
	const address = server.address();
	if (!address || typeof address === 'string') {
		throw new Error('Test server is not listening on a TCP port');
	}

	return `http://127.0.0.1:${address.port}`;
}