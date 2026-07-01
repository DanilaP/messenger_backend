import { Router } from "express";
import ChatController from "./controller";
const router = Router();

router.post("/", ChatController.createChat);
router.post("/send-invitation", ChatController.sendInvitationToChat);
router.post("/accept-invitation", ChatController.acceptInvitationToChat);
router.post("/decline-invitation", ChatController.declineInvitationToChat);
router.delete("/members", ChatController.removeMemberFromChat);
router.patch("/", ChatController.changeChatInfo);

export default router;