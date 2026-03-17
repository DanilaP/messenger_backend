import { Router } from 'express';
import UsersController from './controller';
const router = Router();

router.get('/', UsersController.getUsersList);

export default router;