import { Router } from 'express';
import DialogsController from './controller';
const router = Router();

router.post('/message/send', DialogsController.sendMessage);
router.get('/', DialogsController.getUserDialogInfo);

export default router;