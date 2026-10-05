import express from "express";
import * as objectTypeController from "../controllers/objectTypeController";
import { requireAuth } from "@clerk/express";

const router = express.Router();

router.get("/", objectTypeController.getObjectTypes);

router.post(
  "/",
  requireAuth(),
  objectTypeController.createObjectType
);

export default router;
