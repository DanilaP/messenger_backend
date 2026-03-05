import { Router } from 'express';
import AuthController from './controller';
const router = Router();

router.post('/registration', AuthController.registration);
router.post('/login', AuthController.login);
router.post('/logout', AuthController.logout);

export default router;


