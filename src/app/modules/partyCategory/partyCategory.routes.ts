import { Router } from "express";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { partyCategoryValidation } from "./partyCategory.zod.schema";
import { partyCategoryController } from "./partyCategory.controller";

const router = Router();

// --- Administrative Endpoints ---
router.post(
  "/create",
  checkAuth("admin"),
  validateRequest(partyCategoryValidation.createPartyCategoryZodSchema),
  partyCategoryController.createCategory
);

router.patch(
  "/reorder",
  checkAuth("admin"),
  partyCategoryController.reorderCategories
);

router.patch(
  "/:id",
  checkAuth("admin"),
  validateRequest(partyCategoryValidation.updatePartyCategoryZodSchema),
  partyCategoryController.updateCategory
);

router.delete(
  "/:id",
  checkAuth("admin"),
  partyCategoryController.deleteCategory
);

// --- Public Endpoints ---
router.get("/", partyCategoryController.getAllCategories);
router.get("/id/:id", partyCategoryController.getCategoryById);
router.get("/:slug", partyCategoryController.getCategoryBySlug);

export const partyCategoryRoutes = router;
