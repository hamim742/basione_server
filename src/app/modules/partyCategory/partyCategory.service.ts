import { prisma } from "../../lib/prisma";
import slugify from "slugify";
import { AppError } from "../../error/AppError";
import httpStatus from "http-status";

const generateUniqueCategorySlug = async (name: string, currentId?: string): Promise<string> => {
  let baseSlug = slugify(name, { lower: true, strict: true });
  if (!baseSlug) {
    baseSlug = `cat-${Math.random().toString(36).substring(2, 8)}`;
  }

  let slug = baseSlug;
  let counter = 1;

  while (true) {
    const isExist = await prisma.partyCategory.findFirst({
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

const createCategory = async (payload: any) => {
  if (!payload.slug || payload.slug.trim() === "") {
    payload.slug = await generateUniqueCategorySlug(payload.name);
  } else {
    payload.slug = await generateUniqueCategorySlug(payload.slug);
  }

  const category = await prisma.partyCategory.create({
    data: {
      name: payload.name,
      slug: payload.slug,
      description: payload.description || null,
      age: payload.age !== undefined && payload.age !== null ? Number(payload.age) : null,
      isMilestone: Boolean(payload.isMilestone),
      metaTitle: payload.metaTitle || null,
      metaDescription: payload.metaDescription || null,
      h1Title: payload.h1Title || null,
      introText: payload.introText || null,
      seoDescription: payload.seoDescription || null,
      isActive: payload.isActive !== undefined ? Boolean(payload.isActive) : true,
      position: payload.position !== undefined ? Number(payload.position) : 0,
    },
  });

  return category;
};

const getAllCategories = async (query?: { isActive?: boolean; search?: string }) => {
  const where: any = {};

  if (query?.isActive !== undefined) {
    where.isActive = query.isActive;
  }

  if (query?.search) {
    where.OR = [
      { name: { contains: query.search, mode: "insensitive" } },
      { description: { contains: query.search, mode: "insensitive" } },
    ];
  }

  const categories = await prisma.partyCategory.findMany({
    where,
    orderBy: [{ position: "asc" }, { createdAt: "desc" }],
    include: {
      _count: {
        select: { products: true },
      },
    },
  });

  return categories;
};

const getCategoryById = async (id: string) => {
  const category = await prisma.partyCategory.findUnique({
    where: { id },
    include: {
      products: {
        where: { isActive: true },
        take: 20,
      },
      _count: {
        select: { products: true },
      },
    },
  });

  if (!category) {
    throw new AppError("Categorie niet gevonden", httpStatus.NOT_FOUND);
  }

  return category;
};

const getCategoryBySlug = async (slug: string) => {
  const category = await prisma.partyCategory.findUnique({
    where: { slug },
    include: {
      products: {
        where: { isActive: true },
        orderBy: { createdAt: "desc" },
      },
      _count: {
        select: { products: true },
      },
    },
  });

  if (!category) {
    throw new AppError("Categorie niet gevonden", httpStatus.NOT_FOUND);
  }

  return category;
};

const updateCategory = async (id: string, payload: any) => {
  const existing = await prisma.partyCategory.findUnique({
    where: { id },
  });

  if (!existing) {
    throw new AppError("Categorie niet gevonden", httpStatus.NOT_FOUND);
  }

  let slug = existing.slug;
  if (payload.slug && payload.slug !== existing.slug) {
    slug = await generateUniqueCategorySlug(payload.slug, id);
  } else if (payload.name && payload.name !== existing.name && !payload.slug) {
    slug = await generateUniqueCategorySlug(payload.name, id);
  }

  const updated = await prisma.partyCategory.update({
    where: { id },
    data: {
      ...(payload.name !== undefined && { name: payload.name }),
      slug,
      ...(payload.description !== undefined && { description: payload.description }),
      ...(payload.age !== undefined && { age: payload.age !== null ? Number(payload.age) : null }),
      ...(payload.isMilestone !== undefined && { isMilestone: Boolean(payload.isMilestone) }),
      ...(payload.metaTitle !== undefined && { metaTitle: payload.metaTitle }),
      ...(payload.metaDescription !== undefined && { metaDescription: payload.metaDescription }),
      ...(payload.h1Title !== undefined && { h1Title: payload.h1Title }),
      ...(payload.introText !== undefined && { introText: payload.introText }),
      ...(payload.seoDescription !== undefined && { seoDescription: payload.seoDescription }),
      ...(payload.isActive !== undefined && { isActive: Boolean(payload.isActive) }),
      ...(payload.position !== undefined && { position: Number(payload.position) }),
    },
  });

  return updated;
};

const deleteCategory = async (id: string) => {
  const existing = await prisma.partyCategory.findUnique({
    where: { id },
    include: { _count: { select: { products: true } } },
  });

  if (!existing) {
    throw new AppError("Categorie niet gevonden", httpStatus.NOT_FOUND);
  }

  // Unlink products associated with this category
  await prisma.partyProduct.updateMany({
    where: { categoryId: id },
    data: { categoryId: null },
  });

  await prisma.partyCategory.delete({
    where: { id },
  });

  return null;
};

const reorderCategories = async (ids: string[]) => {
  return prisma.$transaction(
    ids.map((id, index) =>
      prisma.partyCategory.update({
        where: { id },
        data: { position: index },
      })
    )
  );
};

export const partyCategoryService = {
  createCategory,
  getAllCategories,
  getCategoryById,
  getCategoryBySlug,
  updateCategory,
  deleteCategory,
  reorderCategories,
};

