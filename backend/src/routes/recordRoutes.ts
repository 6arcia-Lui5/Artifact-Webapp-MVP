import { Router } from "express";
import * as recordController from "../controllers/recordController"
import { requireApiAuth } from "../middleware/requireApiAuth";
import * as objectTypeController from "../controllers/objectTypeController"
import { requireAuth } from "@clerk/express";
import { upload } from "../middleware/upload"
import { objectTypes } from "../db/schema";

const router = Router();

router.get("/", recordController.getAllRecords);

router.get("/my", requireApiAuth, recordController.getMyRecords);

router.get("/object-types", objectTypeController.getObjectTypes);

router.post(
    "/object-types",
    requireAuth(),
    objectTypeController.createObjectType
);

router.get("/search", recordController.searchRecords);

router.post("/import", requireAuth(), upload.single("file"), recordController.importRecords);

router.get("/:id", recordController.getRecordById);

router.post("/", requireApiAuth, recordController.createRecord);

router.put("/:id", requireApiAuth, recordController.updateRecord);

router.delete("/:id", requireApiAuth, recordController.deleteRecord);



export default router;