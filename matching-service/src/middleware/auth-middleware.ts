import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../utils/jwt';

export interface AuthenticatedRequest extends Request {
    auth: {
        userId: string;
        role?: string;
    };
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
    try {
        const header = req.headers.authorization ?? '';
        const [scheme, token] = header.split(' ');

        if (scheme !== 'Bearer' || !token) {
            return res.status(401).json({ message: 'Missing or invalid Authorization header' });
        }

        const decoded = verifyAccessToken(token);

        (req as AuthenticatedRequest).auth = {
            userId: decoded.sub,
            role: decoded.role,
        };

        return next();
    } catch {
        return res.status(401).json({ message: 'Invalid or expired token' });
    }
}
