import { Router } from 'express';
import UsersController from './controller';
const router = Router();

router.get('/', UsersController.getUsersList);
router.get('/profile', UsersController.getUserInfo);

export default router;