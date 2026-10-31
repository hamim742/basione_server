import { prisma } from "../../lib/prisma";
import slugify from "slugify";
import { AppError } from "../../error/AppError";
import httpStatus from "http-status";
import { BlogStatus } from "@prisma/client";
import { uploadBase64OrUrl } from "../../utils/uploadBase64";

// Generate a unique, lowercase slug from title. If duplicate exists, appends -1, -2, -3, etc.
const generateUniqueSlug = async (title: string, currentId?: string): Promise<string> => {
  let baseSlug = slugify(title, { lower: true, strict: true });
  
  if (!baseSlug) {
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    baseSlug = `post-${randomSuffix}`;
  }
  
  let slug = baseSlug;
  let counter = 1;
  
  while (true) {
    const isExist = await prisma.blog.findFirst({
      where: {
        slug,
        ...(currentId ? { id: { not: currentId } } : {}),
      },
    });
    
    if (!isExist) {
      break;
    }
    
    slug = `${baseSlug}-${counter}`;
    counter++;
  }
  
  return slug;
};

// Create a new blog post
const createBlog = async (data: any, authorId: string) => {
  // Generate unique slug
  const slug = await generateUniqueSlug(data.title);

  // Set publishedAt if the initial status is PUBLISHED
  const publishedAt = data.status === BlogStatus.PUBLISHED ? new Date() : null;

  const blog = await prisma.blog.create({
    data: {
      ...data,
      slug,
      authorId,
      publishedAt,
    },
    include: {
      author: {
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
        },
      },
    },
  });

  return blog;
};

// Update an existing blog post
const updateBlog = async (id: string, data: any) => {
  const existingBlog = await prisma.blog.findUnique({
    where: { id },
  });

  if (!existingBlog) {
    throw new AppError("Blogpost niet gevonden", httpStatus.NOT_FOUND);
  }

  const updateData = { ...data };

  // If title is updated, regenerate slug
  if (data.title && data.title !== existingBlog.title) {
    updateData.slug = await generateUniqueSlug(data.title, id);
  }

  // Handle status updates and publishedAt timestamps
  if (data.status === BlogStatus.PUBLISHED && existingBlog.status !== BlogStatus.PUBLISHED) {
    updateData.publishedAt = new Date();
  } else if (data.status && data.status !== BlogStatus.PUBLISHED) {
    // Optional: reset publishedAt if draft/archived
    updateData.publishedAt = null;
  }

  const blog = await prisma.blog.update({
    where: { id },
    data: updateData,
    include: {
      author: {
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
        },
      },
    },
  });

  return blog;
};

// Delete a blog post
const deleteBlog = async (id: string) => {
  const existingBlog = await prisma.blog.findUnique({
    where: { id },
  });

  if (!existingBlog) {
    throw new AppError("Blogpost niet gevonden", httpStatus.NOT_FOUND);
  }

  await prisma.blog.delete({
    where: { id },
  });

  return true;
};

// Get a single blog post by Slug
const getBlogBySlug = async (slug: string) => {
  const blog = await prisma.blog.findUnique({
    where: { slug },
    include: {
      author: {
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
        },
      },
    },
  });

  if (!blog) {
    throw new AppError("Blogpost niet gevonden", httpStatus.NOT_FOUND);
  }

  return blog;
};

// Get a single blog post by ID
const getBlogById = async (id: string) => {
  const blog = await prisma.blog.findUnique({
    where: { id },
    include: {
      author: {
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
        },
      },
    },
  });

  if (!blog) {
    throw new AppError("Blogpost niet gevonden", httpStatus.NOT_FOUND);
  }

  return blog;
};

// Admin List View: Support searching, status filtering, category filtering, sorting, and pagination
const getAdminBlogs = async (
  page: number,
  limit: number,
  skip: number,
  filter: any,
  sortBy: string,
  sortOrder: "asc" | "desc",
  searchTerm?: string,
) => {
  const cleanFilter = { ...filter };
  delete cleanFilter.searchTerm;

  const andConditions: any[] = [];

  // Exact matches for fields like status, category, isFeatured
  if (cleanFilter.status) {
    andConditions.push({ status: cleanFilter.status });
  }

  if (cleanFilter.category) {
    andConditions.push({
      category: {
        equals: cleanFilter.category,
        mode: "insensitive",
      },
    });
  }

  if (cleanFilter.isFeatured !== undefined) {
    andConditions.push({
      isFeatured: cleanFilter.isFeatured === "true" || cleanFilter.isFeatured === true,
    });
  }

  // Full-text search on title or content
  if (searchTerm) {
    andConditions.push({
      OR: [
        {
          title: {
            contains: searchTerm,
            mode: "insensitive",
          },
        },
        {
          content: {
            contains: searchTerm,
            mode: "insensitive",
          },
        },
      ],
    });
  }

  const where = andConditions.length > 0 ? { AND: andConditions } : {};

  const [blogs, total] = await prisma.$transaction([
    prisma.blog.findMany({
      where,
      include: {
        author: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
      },
      orderBy: {
        [sortBy]: sortOrder,
      },
      take: limit,
      skip,
    }),
    prisma.blog.count({ where }),
  ]);

  return {
    blogs,
    metaData: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

// Public List View: Only shows PUBLISHED blogs, supports search, category filter, isFeatured filter, pagination, and sorting
const getPublicBlogs = async (
  page: number,
  limit: number,
  skip: number,
  filter: any,
  sortBy: string,
  sortOrder: "asc" | "desc",
  searchTerm?: string,
) => {
  const cleanFilter = { ...filter };
  delete cleanFilter.searchTerm;

  // Enforce only PUBLISHED blogs for public requests
  const andConditions: any[] = [{ status: BlogStatus.PUBLISHED }];

  if (cleanFilter.category) {
    andConditions.push({
      category: {
        equals: cleanFilter.category,
        mode: "insensitive",
      },
    });
  }

  if (cleanFilter.isFeatured !== undefined) {
    andConditions.push({
      isFeatured: cleanFilter.isFeatured === "true" || cleanFilter.isFeatured === true,
    });
  }

  if (searchTerm) {
    andConditions.push({
      OR: [
        {
          title: {
            contains: searchTerm,
            mode: "insensitive",
          },
        },
        {
          content: {
            contains: searchTerm,
            mode: "insensitive",
          },
        },
      ],
    });
  }

  const where = { AND: andConditions };

  const [blogs, total] = await prisma.$transaction([
    prisma.blog.findMany({
      where,
      include: {
        author: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
      },
      orderBy: {
        [sortBy]: sortOrder,
      },
      take: limit,
      skip,
    }),
    prisma.blog.count({ where }),
  ]);

  return {
    blogs,
    metaData: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

// Fetch list of unique blog categories and tags currently used in the DB
const getCategoriesAndTags = async () => {
  const blogs = await prisma.blog.findMany({
    select: {
      category: true,
      tags: true,
    },
  });

  const categories = Array.from(
    new Set(blogs.map((b) => b.category).filter(Boolean)),
  );
  
  const allTags = blogs.flatMap((b) => b.tags || []);
  const tags = Array.from(new Set(allTags.filter(Boolean)));

  return { categories, tags };
};

// Publish blog post from external systems (handles Base64 or URL uploads)
const publishExternalBlog = async (data: any, authorId: string) => {
  const { pdf, mainImage, infographic, ...rest } = data;

  // Process files
  const pdfUrl = await uploadBase64OrUrl(pdf, "pdfs", "application/pdf");
  const coverImage = await uploadBase64OrUrl(mainImage, "images", "image/jpeg");
  const infographicUrl = await uploadBase64OrUrl(infographic, "images", "image/jpeg");

  // Generate unique slug
  const slug = await generateUniqueSlug(rest.title);

  // Set publishedAt if status is PUBLISHED
  const publishedAt = rest.status === BlogStatus.PUBLISHED ? new Date() : null;

  const blog = await prisma.blog.create({
    data: {
      ...rest,
      slug,
      authorId,
      pdfUrl,
      coverImage,
      infographicUrl,
      publishedAt,
    },
  });

  return blog;
};

// Update blog post from external systems (handles PUT, Base64 or URL asset uploads)
const updateExternalBlog = async (identifier: string, data: any) => {
  if (!identifier) {
    throw new AppError("Blog identifier (id or slug) is required", httpStatus.BAD_REQUEST);
  }

  const isObjectId = /^[0-9a-fA-F]{24}$/.test(identifier);
  const existingBlog = await prisma.blog.findFirst({
    where: isObjectId
      ? { OR: [{ id: identifier }, { slug: identifier }] }
      : { slug: identifier },
  });

  if (!existingBlog) {
    throw new AppError("Blog post not found", httpStatus.NOT_FOUND);
  }

  const {
    pdf,
    pdfUrl: inputPdfUrl,
    mainImage,
    coverImage: inputCoverImage,
    infographic,
    infographicUrl: inputInfographicUrl,
    id: _bodyId,
    slug: _bodySlug,
    ...rest
  } = data;

  const updateData: any = { ...rest };

  // Handle PDF: accept either pdf or pdfUrl
  const rawPdf = pdf !== undefined ? pdf : inputPdfUrl;
  if (rawPdf !== undefined) {
    updateData.pdfUrl = rawPdf ? await uploadBase64OrUrl(rawPdf, "pdfs", "application/pdf") : null;
  }

  // Handle Cover / Main Image: accept either mainImage or coverImage
  const rawMainImage = mainImage !== undefined ? mainImage : inputCoverImage;
  if (rawMainImage !== undefined) {
    updateData.coverImage = rawMainImage ? await uploadBase64OrUrl(rawMainImage, "images", "image/jpeg") : null;
  }

  // Handle Infographic: accept either infographic or infographicUrl
  const rawInfographic = infographic !== undefined ? infographic : inputInfographicUrl;
  if (rawInfographic !== undefined) {
    updateData.infographicUrl = rawInfographic ? await uploadBase64OrUrl(rawInfographic, "images", "image/jpeg") : null;
  }

  // If title is updated and different, regenerate unique slug
  if (rest.title && rest.title !== existingBlog.title) {
    updateData.slug = await generateUniqueSlug(rest.title, existingBlog.id);
  }

  // Handle status updates and publishedAt timestamps
  if (rest.status === BlogStatus.PUBLISHED && existingBlog.status !== BlogStatus.PUBLISHED) {
    updateData.publishedAt = new Date();
  } else if (rest.status && rest.status !== BlogStatus.PUBLISHED) {
    updateData.publishedAt = null;
  }

  const blog = await prisma.blog.update({
    where: { id: existingBlog.id },
    data: updateData,
    include: {
      author: {
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
        },
      },
    },
  });

  return blog;
};

export const blogService = {
  createBlog,
  updateBlog,
  deleteBlog,
  getBlogBySlug,
  getBlogById,
  getAdminBlogs,
  getPublicBlogs,
  getCategoriesAndTags,
  publishExternalBlog,
  updateExternalBlog,
};
