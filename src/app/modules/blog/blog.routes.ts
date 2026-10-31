import { Router } from "express";
import { checkAuth, checkBlogPublishAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { upload } from "../../middleware/upload";
import { blogValidation } from "./blog.zod.schema";
import { blogController } from "./blog.controller";

const router = Router();

// --- Administrative Endpoints (Admin role only) ---

// Create a new blog post (handles coverImage direct upload or JSON data body)
router.post(
  "/create",
  checkAuth("admin"),
  upload.single("coverImage"),
  validateRequest(blogValidation.createBlogZodSchema),
  blogController.createBlog,
);

// Publish a blog post from an external source (handles base64 files and URLs)
router.post(
  "/publish-external",
  checkBlogPublishAuth(),
  validateRequest(blogValidation.publishExternalBlogZodSchema),
  blogController.publishExternalBlog,
);

// Update a blog post from an external source (handles base64 files and URLs, PUT method)
router.put(
  "/publish-external/:id",
  checkBlogPublishAuth(),
  validateRequest(blogValidation.updateExternalBlogZodSchema),
  blogController.updateExternalBlog,
);

router.put(
  "/publish-external",
  checkBlogPublishAuth(),
  validateRequest(blogValidation.updateExternalBlogZodSchema),
  blogController.updateExternalBlog,
);

router.put(
  "/update-external/:id",
  checkBlogPublishAuth(),
  validateRequest(blogValidation.updateExternalBlogZodSchema),
  blogController.updateExternalBlog,
);

router.put(
  "/update-external",
  checkBlogPublishAuth(),
  validateRequest(blogValidation.updateExternalBlogZodSchema),
  blogController.updateExternalBlog,
);

// Upload a cover or content image independently (returns image URL)
router.post(
  "/upload-image",
  checkAuth("admin"),
  upload.single("image"),
  blogController.uploadImage,
);

// Edit an existing blog post (handles coverImage update or JSON data body)
router.patch(
  "/:id",
  checkAuth("admin"),
  upload.single("coverImage"),
  validateRequest(blogValidation.updateBlogZodSchema),
  blogController.updateBlog,
);

// Update an existing blog post via PUT (supports API Key and Admin Token, Base64/URL/Multipart)
router.put(
  "/:id",
  checkBlogPublishAuth(),
  upload.single("coverImage"),
  validateRequest(blogValidation.updateExternalBlogZodSchema),
  blogController.updateExternalBlog,
);

// Delete a blog post
router.delete(
  "/:id",
  checkAuth("admin"),
  blogController.deleteBlog,
);

// Admin-specific paginated list of all blog posts (supports search/filter drafts/archives/published)
router.get(
  "/admin",
  checkAuth("admin"),
  blogController.getAdminBlogs,
);

// --- Public Endpoints (No authentication required) ---

// Fetch unique categories and tags used across all blog posts
router.get(
  "/categories-tags",
  blogController.getCategoriesAndTags,
);

// Fetch a single blog post by ID
router.get(
  "/id/:id",
  blogController.getBlogById,
);

// Public-facing list of published blog posts (supports pagination, search, category filtering)
router.get(
  "/",
  blogController.getPublicBlogs,
);

// Fetch a single blog post by SEO Slug
router.get(
  "/:slug",
  blogController.getBlogBySlug,
);

export const blogRoutes = router;
