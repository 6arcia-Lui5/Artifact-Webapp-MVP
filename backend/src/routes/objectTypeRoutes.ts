import express from "express";
import * as objectTypeController from "../controllers/objectTypeController";
import { requireApiAuth } from "../middleware/requireApiAuth";

const router = express.Router();

router.get("/", objectTypeController.getObjectTypes);

router.post(
  "/",
  requireApiAuth,
  objectTypeController.createObjectType
);

export default router;
