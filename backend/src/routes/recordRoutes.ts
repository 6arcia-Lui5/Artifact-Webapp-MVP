
import { Router } from "express";
import * as recordController from "../controllers/recordController";
import { requireApiAuth } from "../middleware/requireApiAuth";
import * as objectTypeController from "../controllers/objectTypeController";
import * as modificationController from "../controllers/modificationController";
import { requireAuth } from "@clerk/express";
import { upload } from "../middleware/upload";

const router = Router();

// Retrieve records
router.get("/", recordController.getAllRecords);
router.get("/my", requireApiAuth, recordController.getMyRecords);
router.get("/search", recordController.searchRecords);

// Object types
router.get("/object-types", objectTypeController.getObjectTypes);

router.post(
    "/object-types",
    requireAuth(),
    objectTypeController.createObjectType
);

// Import records
router.post(
    "/import",
    requireAuth(),
    upload.single("file"),
    recordController.importRecords
);

// Individual records
router.get("/:id", recordController.getRecordById);
router.get("/:id/versions", recordController.getRecordVersions);

router.post("/", requireApiAuth, recordController.createRecord);
router.put("/:id", requireApiAuth, recordController.updateRecord);
router.delete("/:id", requireApiAuth, recordController.deleteRecord);

// Modifications:
router.post("/:id/modifications", requireApiAuth, modificationController.createModificationRequest);

export default router;
