import { Router } from "express";
import ChatController from "./controller";
const router = Router();

router.get("/", ChatController.getChats);
router.post("/", ChatController.createChat);
router.patch("/", ChatController.changeChatInfo);
router.delete("/members", ChatController.removeMemberFromChat);
router.patch("/avatar", ChatController.changeChatAvatar);
router.post("/send-invitation", ChatController.sendInvitationToChat);
router.post("/accept-invitation", ChatController.acceptInvitationToChat);
router.post("/decline-invitation", ChatController.declineInvitationToChat);
router.post("/message/send", ChatController.sendMessage);
router.post("/message/delete", ChatController.deleteMessage);
router.post("/message/edit", ChatController.changeMessage);
router.post("/message/read", ChatController.readMessagesInCertainChat);
router.post("/message/scroll", ChatController.scrollToMessage);

export default router;