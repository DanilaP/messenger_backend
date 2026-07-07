import { Router } from "express";
import ChatController from "./controller";
const router = Router();

router.get("/", ChatController.getChats);
router.post("/", ChatController.createChat);
router.patch("/", ChatController.changeChatInfo);
router.post("/send-invitation", ChatController.sendInvitationToChat);
router.post("/accept-invitation", ChatController.acceptInvitationToChat);
router.post("/decline-invitation", ChatController.declineInvitationToChat);
router.delete("/members", ChatController.removeMemberFromChat);
router.patch("/avatar", ChatController.changeChatAvatar);

export default router;