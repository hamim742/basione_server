import { prisma } from "../../lib/prisma";
import slugify from "slugify";
import { AppError } from "../../error/AppError";
import httpStatus from "http-status";

const generateUniqueProductSlug = async (title: string, currentId?: string): Promise<string> => {
  let baseSlug = slugify(title, { lower: true, strict: true });
  if (!baseSlug) {
    baseSlug = `item-${Math.random().toString(36).substring(2, 8)}`;
  }

  let slug = baseSlug;
  let counter = 1;

  while (true) {
    const isExist = await prisma.partyProduct.findFirst({
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

const calculateVatPrices = (price: number, vatRate = 0.21, priceInclVat?: number | null, priceExclVat?: number | null) => {
  const finalIncl = priceInclVat !== undefined && priceInclVat !== null ? priceInclVat : price;
  const finalExcl = priceExclVat !== undefined && priceExclVat !== null ? priceExclVat : Number((finalIncl / (1 + vatRate)).toFixed(2));
  return { priceInclVat: finalIncl, priceExclVat: finalExcl, vatRate };
};

const createProduct = async (payload: any) => {
  if (!payload.slug || payload.slug.trim() === "") {
    payload.slug = await generateUniqueProductSlug(payload.title);
  } else {
    payload.slug = await generateUniqueProductSlug(payload.slug);
  }

  const vatRate = payload.vatRate !== undefined ? Number(payload.vatRate) : 0.21;
  const price = Number(payload.price);
  const { priceInclVat, priceExclVat } = calculateVatPrices(price, vatRate, payload.priceInclVat, payload.priceExclVat);

  const images = Array.isArray(payload.images) ? payload.images : [];
  const featuredImage = payload.featuredImage || (images.length > 0 ? images[0] : null);

  const product = await prisma.partyProduct.create({
    data: {
      title: payload.title,
      slug: payload.slug,
      description: payload.description || null,
      price,
      priceInclVat,
      priceExclVat,
      vatRate,
      sku: payload.sku || null,
      images,
      featuredImage,
      inStock: payload.inStock !== undefined ? Boolean(payload.inStock) : true,
      stockQuantity: payload.stockQuantity !== undefined ? Number(payload.stockQuantity) : 100,
      ages: Array.isArray(payload.ages) ? payload.ages.map(Number) : [],
      tags: Array.isArray(payload.tags) ? payload.tags : [],
      isUpsellOnly: Boolean(payload.isUpsellOnly),
      isActive: payload.isActive !== undefined ? Boolean(payload.isActive) : true,
      metaTitle: payload.metaTitle || null,
      metaDescription: payload.metaDescription || null,
      seoDescription: payload.seoDescription || null,
      categoryId: payload.categoryId || null,
    },
    include: {
      category: true,
    },
  });

  return product;
};

const getAllProducts = async (filters: {
  search?: string;
  categoryId?: string;
  age?: number;
  isActive?: boolean;
  isUpsellOnly?: boolean;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}) => {
  const page = Number(filters.page) || 1;
  const limit = Number(filters.limit) || 20;
  const skip = (page - 1) * limit;

  const where: any = {};

  if (filters.isActive !== undefined) {
    where.isActive = filters.isActive;
  }

  if (filters.isUpsellOnly !== undefined) {
    where.isUpsellOnly = filters.isUpsellOnly;
  }

  if (filters.categoryId) {
    where.categoryId = filters.categoryId;
  }

  if (filters.age !== undefined && !isNaN(Number(filters.age))) {
    where.ages = { has: Number(filters.age) };
  }

  if (filters.search) {
    where.OR = [
      { title: { contains: filters.search, mode: "insensitive" } },
      { description: { contains: filters.search, mode: "insensitive" } },
      { sku: { contains: filters.search, mode: "insensitive" } },
    ];
  }

  const orderBy: any = {};
  if (filters.sortBy) {
    orderBy[filters.sortBy] = filters.sortOrder || "desc";
  } else {
    orderBy.createdAt = "desc";
  }

  const [products, total] = await Promise.all([
    prisma.partyProduct.findMany({
      where,
      skip,
      take: limit,
      orderBy,
      include: {
        category: true,
      },
    }),
    prisma.partyProduct.count({ where }),
  ]);

  return {
    metaData: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
    data: products,
  };
};

const getUpsellProducts = async (query: { age?: number; categoryId?: string; limit?: number }) => {
  const limit = Number(query.limit) || 6;
  const parsedAge = query.age !== undefined && !isNaN(Number(query.age)) ? Number(query.age) : undefined;

  let matchedProducts: any[] = [];

  // 1. If an age IS provided (e.g. 16, 50):
  // STRICT RULE: Only show products matching this exact age, or universal products (empty ages array).
  // Under NO circumstances show products tagged with other ages (e.g. no 50-year items on a 16-year banner).
  if (parsedAge) {
    // 1a. Age-specific products
    matchedProducts = await prisma.partyProduct.findMany({
      where: {
        isActive: true,
        inStock: true,
        ages: { has: parsedAge },
      },
      take: limit,
      orderBy: { createdAt: "desc" },
      include: { category: true },
    });

    // 1b. Universal products only (where ages array is empty, e.g. balloon handpump, generic bunting)
    if (matchedProducts.length < limit) {
      const existingIds = matchedProducts.map((p) => p.id);
      const universalProducts = await prisma.partyProduct.findMany({
        where: {
          isActive: true,
          inStock: true,
          id: { notIn: existingIds },
          ages: { isEmpty: true },
        },
        take: limit - matchedProducts.length,
        orderBy: { createdAt: "desc" },
        include: { category: true },
      });

      matchedProducts = [...matchedProducts, ...universalProducts];
    }

    return matchedProducts;
  }

  // 2. If NO age was provided (general/universal banners):
  if (query.categoryId) {
    const categoryProducts = await prisma.partyProduct.findMany({
      where: {
        isActive: true,
        inStock: true,
        categoryId: query.categoryId,
      },
      take: limit,
      orderBy: { createdAt: "desc" },
      include: { category: true },
    });

    matchedProducts = categoryProducts;
  }

  if (matchedProducts.length < limit) {
    const existingIds = matchedProducts.map((p) => p.id);
    const generalProducts = await prisma.partyProduct.findMany({
      where: {
        isActive: true,
        inStock: true,
        id: { notIn: existingIds },
        ages: { isEmpty: true },
      },
      take: limit - matchedProducts.length,
      orderBy: { createdAt: "desc" },
      include: { category: true },
    });

    matchedProducts = [...matchedProducts, ...generalProducts];
  }

  return matchedProducts;
};

const getProductById = async (id: string) => {
  const product = await prisma.partyProduct.findUnique({
    where: { id },
    include: { category: true },
  });

  if (!product) {
    throw new AppError("Product niet gevonden", httpStatus.NOT_FOUND);
  }

  return product;
};

const getProductBySlug = async (slug: string) => {
  const product = await prisma.partyProduct.findUnique({
    where: { slug },
    include: { category: true },
  });

  if (!product) {
    throw new AppError("Product niet gevonden", httpStatus.NOT_FOUND);
  }

  return product;
};

const updateProduct = async (id: string, payload: any) => {
  const existing = await prisma.partyProduct.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError("Product niet gevonden", httpStatus.NOT_FOUND);
  }

  let slug = existing.slug;
  if (payload.slug && payload.slug !== existing.slug) {
    slug = await generateUniqueProductSlug(payload.slug, id);
  } else if (payload.title && payload.title !== existing.title && !payload.slug) {
    slug = await generateUniqueProductSlug(payload.title, id);
  }

  const vatRate = payload.vatRate !== undefined ? Number(payload.vatRate) : existing.vatRate || 0.21;
  const price = payload.price !== undefined ? Number(payload.price) : existing.price;
  const { priceInclVat, priceExclVat } = calculateVatPrices(price, vatRate, payload.priceInclVat, payload.priceExclVat);

  const images = payload.images !== undefined ? (Array.isArray(payload.images) ? payload.images : []) : existing.images;
  const featuredImage = payload.featuredImage !== undefined ? payload.featuredImage : existing.featuredImage || (images.length > 0 ? images[0] : null);

  const updated = await prisma.partyProduct.update({
    where: { id },
    data: {
      ...(payload.title !== undefined && { title: payload.title }),
      slug,
      ...(payload.description !== undefined && { description: payload.description }),
      price,
      priceInclVat,
      priceExclVat,
      vatRate,
      ...(payload.sku !== undefined && { sku: payload.sku }),
      images,
      featuredImage,
      ...(payload.inStock !== undefined && { inStock: Boolean(payload.inStock) }),
      ...(payload.stockQuantity !== undefined && { stockQuantity: Number(payload.stockQuantity) }),
      ...(payload.ages !== undefined && { ages: Array.isArray(payload.ages) ? payload.ages.map(Number) : [] }),
      ...(payload.tags !== undefined && { tags: Array.isArray(payload.tags) ? payload.tags : [] }),
      ...(payload.isUpsellOnly !== undefined && { isUpsellOnly: Boolean(payload.isUpsellOnly) }),
      ...(payload.isActive !== undefined && { isActive: Boolean(payload.isActive) }),
      ...(payload.metaTitle !== undefined && { metaTitle: payload.metaTitle }),
      ...(payload.metaDescription !== undefined && { metaDescription: payload.metaDescription }),
      ...(payload.seoDescription !== undefined && { seoDescription: payload.seoDescription }),
      ...(payload.categoryId !== undefined && { categoryId: payload.categoryId }),
    },
    include: { category: true },
  });

  return updated;
};

const deleteProduct = async (id: string) => {
  const existing = await prisma.partyProduct.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError("Product niet gevonden", httpStatus.NOT_FOUND);
  }

  await prisma.partyProduct.delete({ where: { id } });
  return null;
};

export const partyProductService = {
  createProduct,
  getAllProducts,
  getUpsellProducts,
  getProductById,
  getProductBySlug,
  updateProduct,
  deleteProduct,
};
