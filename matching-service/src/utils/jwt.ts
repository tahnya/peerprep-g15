import jwt from 'jsonwebtoken';
import { config } from '../config/env';

export interface AccessTokenPayload {
    sub: string;
    role?: string;
    type?: 'access' | 'refresh';
}

export function verifyAccessToken(token: string): AccessTokenPayload {
    const payload = jwt.verify(token, config.jwt.secret) as AccessTokenPayload;

    if (!payload?.sub) {
        throw new Error('Invalid access token payload');
    }

    return payload;
}

export function signAccessToken(payload: AccessTokenPayload) {
    return jwt.sign(payload, config.jwt.secret, { expiresIn: '15m' });
}
