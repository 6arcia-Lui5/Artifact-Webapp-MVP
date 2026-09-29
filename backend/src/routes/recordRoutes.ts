import { Router } from "express";
import * as recordController from "../controllers/recordController"
import { requireApiAuth } from "../middleware/requireApiAuth";

const router = Router();

router.get("/", recordController.getAllRecords);

router.get("/my", requireApiAuth, recordController.getMyRecords);

router.get("/:id", recordController.getRecordById);

router.post("/", requireApiAuth, recordController.createRecord);

router.put("/:id", requireApiAuth, recordController.updateRecord);

router.delete("/:id", requireApiAuth, recordController.deleteRecord);

export default router;