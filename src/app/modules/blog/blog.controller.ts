import { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { blogService } from "./blog.service";
import httpStatus from "http-status";
import { calculatePagination } from "../../utils/calculatePagination";
import { excludeFiled } from "../../utils/constain";
import { uploadImageToS3, uploadOptimizedImageToS3 } from "../../utils/uploadAws";
import { AppError } from "../../error/AppError";

// Create blog post (Admin only)
const createBlog = catchAsync(async (req: Request & { user?: any }, res: Response) => {
  const file = req.file;
  if (file) {
    const coverImageUrl = await uploadOptimizedImageToS3(file, "images", 1600, 1600, 80);
    req.body.coverImage = coverImageUrl;
  }

  const authorId = req.user.id;
  const result = await blogService.createBlog(req.body, authorId);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Blog post created successfully",
    data: result,
  });
});

// Edit blog post (Admin only)
const updateBlog = catchAsync(async (req: Request, res: Response) => {
  const file = req.file;
  if (file) {
    const coverImageUrl = await uploadOptimizedImageToS3(file, "images", 1600, 1600, 80);
    req.body.coverImage = coverImageUrl;
  }

  const result = await blogService.updateBlog(req.params.id as string, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Blog post updated successfully",
    data: result,
  });
});

// Delete blog post (Admin only)
const deleteBlog = catchAsync(async (req: Request, res: Response) => {
  await blogService.deleteBlog(req.params.id as string);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Blog post deleted successfully",
    data: null,
  });
});

// Upload media / content images (Admin only)
const uploadImage = catchAsync(async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) {
    throw new AppError("No file uploaded", httpStatus.BAD_REQUEST);
  }

  const imageUrl = await uploadOptimizedImageToS3(file, "images", 1600, 1600, 80);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Image uploaded successfully",
    data: { imageUrl },
  });
});

// Get a single blog post by Slug (Public / Admin)
const getBlogBySlug = catchAsync(async (req: Request, res: Response) => {
  const result = await blogService.getBlogBySlug(req.params.slug as string);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Blog post fetched successfully",
    data: result,
  });
});

// Get a single blog post by ID (Public / Admin)
const getBlogById = catchAsync(async (req: Request, res: Response) => {
  const result = await blogService.getBlogById(req.params.id as string);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Blog post fetched successfully",
    data: result,
  });
});

// Admin list page: support searching, sorting, pagination, and all status filters
const getAdminBlogs = catchAsync(async (req: Request, res: Response) => {
  const { page, limit, skip, sortBy, sortOrder } = calculatePagination(req.query);
  const filter = { ...req.query };

  for (const f of excludeFiled) {
    delete filter[f];
  }

  const result = await blogService.getAdminBlogs(
    page,
    limit,
    skip,
    filter,
    sortBy,
    sortOrder as "asc" | "desc",
    req.query.searchTerm as string,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Admin blog posts fetched successfully",
    data: result.blogs,
    metaData: result.metaData,
  });
});

// Public list page: support pagination, search, category filter, sorting
const getPublicBlogs = catchAsync(async (req: Request, res: Response) => {
  const { page, limit, skip, sortBy, sortOrder } = calculatePagination(req.query);
  const filter = { ...req.query };

  for (const f of excludeFiled) {
    delete filter[f];
  }

  // Force sorting to newest by default if not specified
  const actualSortBy = req.query.sortBy ? (req.query.sortBy as string) : "createdAt";
  const actualSortOrder = req.query.sortOrder ? (req.query.sortOrder as "asc" | "desc") : "desc";

  const result = await blogService.getPublicBlogs(
    page,
    limit,
    skip,
    filter,
    actualSortBy,
    actualSortOrder,
    req.query.searchTerm as string,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Blog posts fetched successfully",
    data: result.blogs,
    metaData: result.metaData,
  });
});

// Get unique categories and tags
const getCategoriesAndTags = catchAsync(async (req: Request, res: Response) => {
  const result = await blogService.getCategoriesAndTags();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Categories and tags fetched successfully",
    data: result,
  });
});

// Publish blog post from external systems (Admin only)
const publishExternalBlog = catchAsync(async (req: Request & { user?: any }, res: Response) => {
  const authorId = req.user.id;
  const result = await blogService.publishExternalBlog(req.body, authorId);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Blog post published successfully",
    data: {
      slug: result.slug,
      id: result.id,
    },
  });
});

// Update blog post from external systems (via API Key or Admin Token)
const updateExternalBlog = catchAsync(async (req: Request, res: Response) => {
  const file = req.file;
  if (file) {
    const coverImageUrl = await uploadOptimizedImageToS3(file, "images", 1600, 1600, 80);
    req.body.coverImage = coverImageUrl;
  }

  const identifier = (req.params.id || req.body.id || req.body.slug) as string;
  if (!identifier) {
    throw new AppError(
      "Blog identifier (id or slug) must be provided in URL parameter or body",
      httpStatus.BAD_REQUEST,
    );
  }

  const result = await blogService.updateExternalBlog(identifier, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Blog post updated successfully",
    data: {
      id: result.id,
      slug: result.slug,
      title: result.title,
      pdfUrl: result.pdfUrl,
      status: result.status,
    },
  });
});

export const blogController = {
  createBlog,
  updateBlog,
  deleteBlog,
  uploadImage,
  getBlogBySlug,
  getBlogById,
  getAdminBlogs,
  getPublicBlogs,
  getCategoriesAndTags,
  publishExternalBlog,
  updateExternalBlog,
};
