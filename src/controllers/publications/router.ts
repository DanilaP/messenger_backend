import { Router } from "express";
import PublicationsController from "./controller";
const router = Router();

router.get("/", PublicationsController.getPublications);
router.post("/", PublicationsController.createPublication);
router.delete("/", PublicationsController.deletePublication);
router.patch("/", PublicationsController.changePublication);

export default router;