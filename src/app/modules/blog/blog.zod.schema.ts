import z from "zod";

const createBlogZodSchema = z.object({
  title: z.string({ message: "Title is required" }).min(1, { message: "Title cannot be empty" }),
  content: z.string({ message: "Content is required" }).min(1, { message: "Content cannot be empty" }),
  coverImage: z.string().optional(),
  images: z.array(z.string()).optional(),
  category: z.string({ message: "Category is required" }).min(1, { message: "Category cannot be empty" }),
  tags: z.array(z.string()).optional(),
  isFeatured: z.boolean().optional().default(false),
  metaTitle: z.string().optional(),
  metaDescription: z.string().optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional().default("DRAFT"),
});

const updateBlogZodSchema = z.object({
  title: z.string().optional(),
  content: z.string().optional(),
  coverImage: z.string().optional(),
  images: z.array(z.string()).optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  isFeatured: z.boolean().optional(),
  metaTitle: z.string().optional(),
  metaDescription: z.string().optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
});

const publishExternalBlogZodSchema = z.object({
  title: z.string({ message: "Title is required" }).min(1, { message: "Title cannot be empty" }),
  content: z.string({ message: "Content is required" }).min(1, { message: "Content cannot be empty" }),
  category: z.string().optional().default("General"),
  tags: z.array(z.string()).optional(),
  pdf: z.string().optional(),
  youtubeVideoUrl: z.string().optional(),
  youtubeShortUrl: z.string().optional(),
  mainImage: z.string().optional(),
  infographic: z.string().optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional().default("PUBLISHED"),
});

const updateExternalBlogZodSchema = z.object({
  id: z.string().optional(),
  slug: z.string().optional(),
  title: z.string().optional(),
  content: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  pdf: z.string().optional(),
  pdfUrl: z.string().optional(),
  youtubeVideoUrl: z.string().optional(),
  youtubeShortUrl: z.string().optional(),
  mainImage: z.string().optional(),
  coverImage: z.string().optional(),
  infographic: z.string().optional(),
  infographicUrl: z.string().optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
  isFeatured: z.boolean().optional(),
  metaTitle: z.string().optional(),
  metaDescription: z.string().optional(),
}).passthrough();

export const blogValidation = {
  createBlogZodSchema,
  updateBlogZodSchema,
  publishExternalBlogZodSchema,
  updateExternalBlogZodSchema,
};
