import { Router } from "express";
import { syncUser } from "../controllers/userController"
import { requireApiAuth } from "../middleware/requireApiAuth";

const router = Router();

// /api/user/sync - POST => sync the clerk user to db
router.post("/sync", requireApiAuth, syncUser)

export default router;
