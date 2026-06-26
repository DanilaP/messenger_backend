import { Router } from "express";
import ChatController from "./controller";
const router = Router();

router.post("/", ChatController.createChat);

export default router;