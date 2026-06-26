import { Router } from "express";
import ChatController from "./controller";
const router = Router();

router.post("/", ChatController.createChat);
router.post("/send-invitation", ChatController.sendInvitationToChat);
router.post("/decline-invitation", ChatController.declineInvitationToChat);

export default router;