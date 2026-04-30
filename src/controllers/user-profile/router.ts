import { Router } from 'express';
import UserProfileController from './controller';
const router = Router();

router.get('/', UserProfileController.getProfile);
router.post('/change-status', UserProfileController.changeUserStatus);
router.post('/change-avatar', UserProfileController.changeUserAvatar);

export default router;