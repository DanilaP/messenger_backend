import { Router } from 'express';
import DialogsController from './controller';
const router = Router();

router.post('/message/send', DialogsController.sendMessage);
router.post('/message/delete', DialogsController.deleteMessages);
router.post('/message/edit', DialogsController.changeMessage);
router.get('/files', DialogsController.getDialogFiles);
router.get('/', DialogsController.getUserDialogsInfo);
router.delete('/', DialogsController.deleteDialog);

export default router;