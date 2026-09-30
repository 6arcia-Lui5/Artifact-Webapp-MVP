import { Router } from "express";
import * as collectionController from "../controllers/collectionController";
import { requireApiAuth } from "../middleware/requireApiAuth";

const router = Router();

// GET /api/products => Get all records (public)
router.get("/", collectionController.getAllCollections);
router.get("/:id", collectionController.getCollectionById);
router.post("/", requireApiAuth, collectionController.createCollection);

export default router;