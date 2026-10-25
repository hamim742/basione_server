import { Router } from "express";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { upload } from "../../middleware/upload";
import { partyProductValidation } from "./partyProduct.zod.schema";
import { partyProductController } from "./partyProduct.controller";

const router = Router();

// --- Administrative Endpoints ---
router.post(
  "/upload-images",
  checkAuth("admin"),
  upload.array("images", 10),
  partyProductController.uploadImages
);

router.post(
  "/create",
  checkAuth("admin"),
  validateRequest(partyProductValidation.createPartyProductZodSchema),
  partyProductController.createProduct
);

router.patch(
  "/:id",
  checkAuth("admin"),
  validateRequest(partyProductValidation.updatePartyProductZodSchema),
  partyProductController.updateProduct
);

router.delete(
  "/:id",
  checkAuth("admin"),
  partyProductController.deleteProduct
);

// --- Public Endpoints ---
router.get("/upsell", partyProductController.getUpsellProducts);
router.get("/id/:id", partyProductController.getProductById);
router.get("/:slug", partyProductController.getProductBySlug);
router.get("/", partyProductController.getAllProducts);

export const partyProductRoutes = router;
