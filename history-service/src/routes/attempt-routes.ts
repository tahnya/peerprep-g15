import { Router } from 'express';
import { AttemptController } from '../controllers/attempt-controller';
import { requireAuth, requireBodySelfOrAdmin, requireSelfOrAdmin } from '../middleware/auth-middleware';

const router = Router();

router.get('/health', AttemptController.health);
router.post('/save-attempt', requireAuth, requireBodySelfOrAdmin('userId'), AttemptController.save);
router.get('/users/:userId/attempts', requireAuth, requireSelfOrAdmin('userId'), AttemptController.listByUser);

export default router;
