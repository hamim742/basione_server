import { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import httpStatus from "http-status";
import { partyProductService } from "./partyProduct.service";
import { uploadOptimizedImageToS3 } from "../../utils/uploadAws";
import { AppError } from "../../error/AppError";

const createProduct = catchAsync(async (req: Request, res: Response) => {
  const result = await partyProductService.createProduct(req.body);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Feestartikel succesvol aangemaakt",
    data: result,
  });
});

const getAllProducts = catchAsync(async (req: Request, res: Response) => {
  const {
    search,
    categoryId,
    age,
    isActive,
    isUpsellOnly,
    page,
    limit,
    sortBy,
    sortOrder,
  } = req.query;

  const filters = {
    search: search as string | undefined,
    categoryId: categoryId as string | undefined,
    age: age !== undefined ? Number(age) : undefined,
    isActive: isActive !== undefined ? isActive === "true" : undefined,
    isUpsellOnly: isUpsellOnly !== undefined ? isUpsellOnly === "true" : undefined,
    page: page ? Number(page) : undefined,
    limit: limit ? Number(limit) : undefined,
    sortBy: sortBy as string | undefined,
    sortOrder: (sortOrder as "asc" | "desc") || undefined,
  };

  const result = await partyProductService.getAllProducts(filters);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Feestartikelen succesvol opgehaald",
    metaData: result.metaData,
    data: result.data,
  });
});

const getUpsellProducts = catchAsync(async (req: Request, res: Response) => {
  const { age, categoryId, limit } = req.query;

  const result = await partyProductService.getUpsellProducts({
    age: age !== undefined ? Number(age) : undefined,
    categoryId: categoryId as string | undefined,
    limit: limit !== undefined ? Number(limit) : 6,
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Upsell artikelen succesvol opgehaald",
    data: result,
  });
});

const getProductById = catchAsync(async (req: Request, res: Response) => {
  const result = await partyProductService.getProductById(req.params.id as string);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Feestartikel succesvol opgehaald",
    data: result,
  });
});

const getProductBySlug = catchAsync(async (req: Request, res: Response) => {
  const result = await partyProductService.getProductBySlug(req.params.slug as string);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Feestartikel succesvol opgehaald",
    data: result,
  });
});

const updateProduct = catchAsync(async (req: Request, res: Response) => {
  const result = await partyProductService.updateProduct(req.params.id as string, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Feestartikel succesvol bijgewerkt",
    data: result,
  });
});

const deleteProduct = catchAsync(async (req: Request, res: Response) => {
  await partyProductService.deleteProduct(req.params.id as string);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Feestartikel succesvol verwijderd",
    data: null,
  });
});

const uploadImages = catchAsync(async (req: Request, res: Response) => {
  const files = req.files as Express.Multer.File[] | undefined;

  if (!files || files.length === 0) {
    throw new AppError("Geen bestanden geüpload", httpStatus.BAD_REQUEST);
  }

  const uploadPromises = files.map((file) =>
    uploadOptimizedImageToS3(file, "party-products", 1400, 1400, 85)
  );

  const urls = await Promise.all(uploadPromises);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Afbeeldingen succesvol geüpload",
    data: urls,
  });
});

export const partyProductController = {
  createProduct,
  getAllProducts,
  getUpsellProducts,
  getProductById,
  getProductBySlug,
  updateProduct,
  deleteProduct,
  uploadImages,
};
