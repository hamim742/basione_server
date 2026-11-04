import { Router } from "express";
import { adminController } from "./admin.controller";
import { upload } from "../../middleware/upload";
import { checkAuth } from "../../middleware/checkAuth";
import { chatbotController } from "../chatbot/chatbot.controller";
import { validateRequest } from "../../middleware/validateRequest";
import { chatbotSettingsSchema } from "../chatbot/chatbot.zod.schema";
import { fontController } from "../font/font.controller";

const router = Router();

router.get("/total-orders", adminController.totalOrder);
router.get("/order-status-summary", adminController.getOrderStatusSummary);
router.patch("/update-order/:id", adminController.manageOrder);

router.get("/total-users", adminController.manageUsers);
router.patch("/update-user/:id", adminController.updateUserStatus);
router.get("/users/:id/saved-designs", checkAuth("admin"), adminController.getUserSavedDesigns);
router.get("/user-saved-designs/:id", checkAuth("admin"), adminController.getUserSavedDesigns);

router.get("/dashboard-stats", adminController.dashboardStats);
router.get("/total-transaction", adminController.totalTransaction);

router.post(
  "/create-decoration",
  upload.single("file"),
  adminController.createDecoration,
);

router.delete("/decoration/:id", adminController.deleteDecoration);
router.get("/decorations", adminController.getAllDecoration);

router.post(
  "/create-decoration-category",
  adminController.createDecorationCategory,
);

router.get("/decoration-categories", adminController.getAllDecorationCategory);

router.patch(
  "/update-decoration-category/:id",
  adminController.updateDecorationCategory,
);

router.delete(
  "/delete-decoration-category/:id",
  adminController.deleteDecorationCategory,
);

router.get("/single-order/:id", adminController.getSingleOrder);
router.patch("/update-order-address/:id", adminController.updateOrderAddress);

router.get("/faqs", adminController.getFaqs);
router.post("/create-faq", adminController.createFaq);
router.patch("/update-faq/:id", adminController.updateFaq);
router.delete("/delete-faq/:id", adminController.deleteFaq);

// --- Admin Template Category Management Endpoints ---
router.post(
  "/template-categories",
  checkAuth("admin"),
  adminController.createTemplateCategory,
);

router.get(
  "/template-categories",
  checkAuth("admin"),
  adminController.getAllTemplateCategories,
);

router.patch(
  "/template-categories/reorder",
  checkAuth("admin"),
  adminController.reorderTemplateCategories,
);

router.patch(
  "/template-categories/:id",
  checkAuth("admin"),
  adminController.updateTemplateCategory,
);

router.delete(
  "/template-categories/:id",
  checkAuth("admin"),
  adminController.deleteTemplateCategory,
);

// --- Admin Template Subcategory Management Endpoints ---
router.post(
  "/template-subcategories",
  checkAuth("admin"),
  adminController.createTemplateSubcategory,
);

router.get(
  "/template-subcategories",
  checkAuth("admin"),
  adminController.getAllTemplateSubcategories,
);

router.patch(
  "/template-subcategories/reorder",
  checkAuth("admin"),
  adminController.reorderTemplateSubcategories,
);

router.patch(
  "/template-subcategories/:id",
  checkAuth("admin"),
  adminController.updateTemplateSubcategory,
);

router.delete(
  "/template-subcategories/:id",
  checkAuth("admin"),
  adminController.deleteTemplateSubcategory,
);

// --- Admin Tuinposter Category Management Endpoints ---
router.post(
  "/tuinposter-categories",
  checkAuth("admin"),
  adminController.createTuinposterCategory,
);

router.get(
  "/tuinposter-categories",
  checkAuth("admin"),
  adminController.getAllTuinposterCategories,
);

router.patch(
  "/tuinposter-categories/reorder",
  checkAuth("admin"),
  adminController.reorderTuinposterCategories,
);

router.patch(
  "/tuinposter-categories/:id",
  checkAuth("admin"),
  adminController.updateTuinposterCategory,
);

router.delete(
  "/tuinposter-categories/:id",
  checkAuth("admin"),
  adminController.deleteTuinposterCategory,
);

// --- Admin Template Management Endpoints ---
router.post(
  "/create-template",
  checkAuth("admin"),
  upload.single("image"),
  adminController.createTemplate,
);

router.patch(
  "/update-template/:id",
  checkAuth("admin"),
  upload.single("image"),
  adminController.updateTemplate,
);

router.delete(
  "/delete-template/:id",
  checkAuth("admin"),
  adminController.deleteTemplate,
);

router.get(
  "/templates",
  checkAuth("admin"),
  adminController.getAllTemplates,
);

// --- Admin Font Management Endpoints ---
router.get(
  "/fonts",
  checkAuth("admin"),
  fontController.getAdminFonts,
);

router.post(
  "/fonts",
  checkAuth("admin"),
  upload.single("file"),
  fontController.createFont,
);

router.patch(
  "/fonts/:id",
  checkAuth("admin"),
  upload.single("file"),
  fontController.updateFont,
);

router.delete(
  "/fonts/:id",
  checkAuth("admin"),
  fontController.deleteFont,
);

// --- Admin Chatbot Management Endpoints ---
router.get(
  "/chatbot/settings",
  checkAuth("admin"),
  chatbotController.getSettings,
);

router.patch(
  "/chatbot/settings",
  checkAuth("admin"),
  validateRequest(chatbotSettingsSchema),
  chatbotController.updateSettings,
);

router.get(
  "/chatbot/conversations",
  checkAuth("admin"),
  chatbotController.listConversations,
);

router.get(
  "/chatbot/conversations/:conversationId",
  checkAuth("admin"),
  chatbotController.getConversation,
);

router.delete(
  "/chatbot/conversations/:conversationId",
  checkAuth("admin"),
  chatbotController.deleteConversation,
);

router.get(
  "/chatbot/documentation/summary",
  checkAuth("admin"),
  chatbotController.getDocumentationSummary,
);

router.get(
  "/chatbot/documentation/search",
  checkAuth("admin"),
  chatbotController.searchDocumentation,
);

router.post(
  "/create-background-image",
  checkAuth("admin"),
  upload.single("file"),
  adminController.createBackgroundImage,
);

router.delete(
  "/background-image/:id",
  checkAuth("admin"),
  adminController.deleteBackgroundImage,
);

router.get(
  "/background-images",
  adminController.getAllBackgroundImages,
);

export const adminRoutes = router;
