import { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import httpStatus from "http-status";
import { partyCategoryService } from "./partyCategory.service";

const createCategory = catchAsync(async (req: Request, res: Response) => {
  const result = await partyCategoryService.createCategory(req.body);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Feestcategorie succesvol aangemaakt",
    data: result,
  });
});

const getAllCategories = catchAsync(async (req: Request, res: Response) => {
  const isActive = req.query.isActive !== undefined ? req.query.isActive === "true" : undefined;
  const hasActiveProducts = req.query.hasActiveProducts !== undefined ? req.query.hasActiveProducts === "true" : undefined;
  const search = req.query.search as string | undefined;

  const result = await partyCategoryService.getAllCategories({ isActive, search, hasActiveProducts });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Feestcategorieën succesvol opgehaald",
    data: result,
  });
});

const getCategoryById = catchAsync(async (req: Request, res: Response) => {
  const result = await partyCategoryService.getCategoryById(req.params.id as string);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Feestcategorie succesvol opgehaald",
    data: result,
  });
});

const getCategoryBySlug = catchAsync(async (req: Request, res: Response) => {
  const result = await partyCategoryService.getCategoryBySlug(req.params.slug as string);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Feestcategorie succesvol opgehaald",
    data: result,
  });
});

const updateCategory = catchAsync(async (req: Request, res: Response) => {
  const result = await partyCategoryService.updateCategory(req.params.id as string, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Feestcategorie succesvol bijgewerkt",
    data: result,
  });
});

const deleteCategory = catchAsync(async (req: Request, res: Response) => {
  await partyCategoryService.deleteCategory(req.params.id as string);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Feestcategorie succesvol verwijderd",
    data: null,
  });
});

const reorderCategories = catchAsync(async (req: Request, res: Response) => {
  const { ids } = req.body;
  const result = await partyCategoryService.reorderCategories(ids || []);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Volgorde succesvol aangepast",
    data: result,
  });
});

export const partyCategoryController = {
  createCategory,
  getAllCategories,
  getCategoryById,
  getCategoryBySlug,
  updateCategory,
  deleteCategory,
  reorderCategories,
};
