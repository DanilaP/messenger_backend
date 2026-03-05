import { Router } from 'express';
import DialogsController from './controller';
const router = Router();

router.post('/send-message', DialogsController.sendMessage);

export default router;