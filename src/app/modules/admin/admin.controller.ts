import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import httpStatus from "http-status";
import { calculatePagination } from "../../utils/calculatePagination";
import { Request, Response } from "express";
import { adminService } from "./admin.service";
import { excludeFiled } from "../../utils/constain";
import { uploadFileToS3, uploadImageToS3, uploadOptimizedImageToS3, uploadOptimizedTransparentImageToS3 } from "../../utils/uploadAws";

const totalOrder = catchAsync(async (req: Request, res: Response) => {
  const { page, limit, skip, sortBy, sortOrder } = calculatePagination(
    req.query,
  );
  const filter = { ...req.query };

  for (const f of excludeFiled) {
    delete filter[f];
  }
  const orders = await adminService.totalOrder(
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
    message: "Bestellingen succesvol opgehaald",
    data: orders.orders,
    metaData: orders.metaData,
  });
});

const getOrderStatusSummary = catchAsync(async (req: Request, res: Response) => {
  const summary = await adminService.getOrderStatusSummary();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Bestellingsstatistieken succesvol opgehaald",
    data: summary,
  });
});

const manageOrder = catchAsync(async (req: Request, res: Response) => {
  const order = await adminService.manageOrder(
    req.params.id as string,
    req.body.status,
    {
      carrier: req.body.carrier,
      productCombinationId: req.body.productCombinationId,
    },
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Bestelling succesvol bijgewerkt",
    data: order,
  });
});

const manageUsers = catchAsync(async (req: Request, res: Response) => {
  const { page, limit, skip, sortBy, sortOrder } = calculatePagination(
    req.query,
  );
  const filter = { ...req.query };

  for (const f of excludeFiled) {
    delete filter[f];
  }
  const users = await adminService.manageUsers(
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
    message: "Gebruikers succesvol opgehaald",
    data: users.users,
    metaData: users.metaData,
  });
});

const updateUserStatus = catchAsync(async (req: Request, res: Response) => {
  const user = await adminService.updateUserStatus(
    req.params.id as string,
    req.body.status,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Gebruikersstatus succesvol bijgewerkt",
    data: user,
  });
});

const getUserSavedDesigns = catchAsync(async (req: Request, res: Response) => {
  const { page, limit } = calculatePagination(req.query);
  const result = await adminService.getUserSavedDesigns(
    req.params.id as string,
    page,
    limit,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Opgeslagen ontwerpen van gebruiker succesvol opgehaald",
    data: {
      user: result.user,
      designs: result.designs,
    },
    metaData: result.metaData,
  });
});

const dashboardStats = catchAsync(async (req: Request, res: Response) => {
  const range = req.query.range as string | undefined;
  const startDate = req.query.startDate as string | undefined;
  const endDate = req.query.endDate as string | undefined;
  const stats = await adminService.dashboardStats(range, startDate, endDate);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Dashboard-statistieken succesvol opgehaald",
    data: stats,
  });
});

const totalTransaction = catchAsync(async (req: Request, res: Response) => {
  const { page, limit, skip, sortBy, sortOrder } = calculatePagination(
    req.query,
  );
  const filter = { ...req.query };

  for (const f of excludeFiled) {
    delete filter[f];
  }
  const payments = await adminService.totalTransaction(
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
    message: "Transacties succesvol opgehaald",
    data: payments.payments,
    metaData: payments.metaData,
    stats: payments.stats,
  });
});

const createDecoration = catchAsync(async (req: Request, res: Response) => {
  const file = req.file;
  if (file) {
    const isTransparent =
      file.mimetype === "image/png" ||
      file.mimetype === "image/webp" ||
      file.mimetype === "image/svg+xml";

    const fileUrl = isTransparent
      ? await uploadOptimizedTransparentImageToS3(file, "images", 1200, 1200, 80)
      : await uploadOptimizedImageToS3(file, "images", 1200, 1200, 80);

    req.body.image = fileUrl;
  }

  const decoration = await adminService.createDecoration(req.body);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Decoratie succesvol aangemaakt",
    data: decoration,
  });
});

const deleteDecoration = catchAsync(async (req: Request, res: Response) => {
  await adminService.deleteDecoration(req.params.id as string);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    data: null,
    message: "Decoratie succesvol verwijderd",
  });
});

const getAllDecoration = catchAsync(async (req: Request, res: Response) => {
  const { page, limit, skip, sortBy, sortOrder } = calculatePagination({
    sortBy: "createdAt",
    sortOrder: "desc",
    ...req.query,
  });
  const filter = { ...req.query };

  for (const f of excludeFiled) {
    delete filter[f];
  }
  const decorations = await adminService.getAllDecoration(
    page,
    limit,
    skip,
    filter,
    sortBy,
    sortOrder as "asc" | "desc",
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Decoraties succesvol opgehaald",
    data: decorations.decorations,
    metaData: decorations.metaData,
  });
});

const createDecorationCategory = catchAsync(
  async (req: Request, res: Response) => {
    const category = await adminService.createDecorationCategory(req.body.name);

    sendResponse(res, {
      statusCode: httpStatus.CREATED,
      success: true,
      message: "Decoratiecategorie succesvol aangemaakt",
      data: category,
    });
  },
);

const getAllDecorationCategory = catchAsync(
  async (req: Request, res: Response) => {
    const categories = await adminService.getAllDecorationCategory();
    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Decoratiecategorieën succesvol opgehaald",
      data: categories,
    });
  },
);

const updateDecorationCategory = catchAsync(
  async (req: Request, res: Response) => {
    const category = await adminService.updateDecorationCategory(
      req.params.id as string,
      req.body.name,
    );

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Decoratiecategorie succesvol bijgewerkt",
      data: category,
    });
  },
);

const deleteDecorationCategory = catchAsync(
  async (req: Request, res: Response) => {
    await adminService.deleteDecorationCategory(req.params.id as string);

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Decoratiecategorie succesvol verwijderd",
      data: null,
    });
  },
);

const getSingleOrder = catchAsync(async (req: Request, res: Response) => {
  const order = await adminService.getSingleOrder(req.params.id as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Bestelling succesvol opgehaald",
    data: order,
  });
});

const updateOrderAddress = catchAsync(async (req: Request, res: Response) => {
  const order = await adminService.updateOrderAddress(
    req.params.id as string,
    req.body,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Adres succesvol bijgewerkt",
    data: order,
  });
});

const createFaq = catchAsync(async (req: Request, res: Response) => {
  const faq = await adminService.createFaq(req.body);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "FAQ succesvol aangemaakt",
    data: faq,
  });
});

const updateFaq = catchAsync(async (req: Request, res: Response) => {
  const faq = await adminService.updateFaq(req.params.id as string, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "FAQ succesvol bijgewerkt",
    data: faq,
  });
});

const deleteFaq = catchAsync(async (req: Request, res: Response) => {
  await adminService.deleteFaq(req.params.id as string);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "FAQ succesvol verwijderd",
    data: null,
  });
});

const getFaqs = catchAsync(async (req: Request, res: Response) => {
  const faqs = await adminService.getFaqs();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "FAQ's succesvol opgehaald",
    data: faqs,
  });
});

const createTemplateCategory = catchAsync(async (req: Request, res: Response) => {
  const category = await adminService.createTemplateCategory(req.body);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Templatecategorie succesvol aangemaakt",
    data: category,
  });
});

const getAllTemplateCategories = catchAsync(async (req: Request, res: Response) => {
  const categories = await adminService.getAllTemplateCategories();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Templatecategorieen succesvol opgehaald",
    data: categories,
  });
});

const updateTemplateCategory = catchAsync(async (req: Request, res: Response) => {
  const category = await adminService.updateTemplateCategory(
    req.params.id as string,
    req.body,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Templatecategorie succesvol bijgewerkt",
    data: category,
  });
});

const deleteTemplateCategory = catchAsync(async (req: Request, res: Response) => {
  await adminService.deleteTemplateCategory(req.params.id as string);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Templatecategorie succesvol verwijderd",
    data: null,
  });
});

const createTemplateSubcategory = catchAsync(async (req: Request, res: Response) => {
  const subcategory = await adminService.createTemplateSubcategory(req.body);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Templatesubcategorie succesvol aangemaakt",
    data: subcategory,
  });
});

const getAllTemplateSubcategories = catchAsync(async (req: Request, res: Response) => {
  const subcategories = await adminService.getAllTemplateSubcategories(req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Templatesubcategorieen succesvol opgehaald",
    data: subcategories,
  });
});

const updateTemplateSubcategory = catchAsync(async (req: Request, res: Response) => {
  const subcategory = await adminService.updateTemplateSubcategory(
    req.params.id as string,
    req.body,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Templatesubcategorie succesvol bijgewerkt",
    data: subcategory,
  });
});

const deleteTemplateSubcategory = catchAsync(async (req: Request, res: Response) => {
  await adminService.deleteTemplateSubcategory(req.params.id as string);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Templatesubcategorie succesvol verwijderd",
    data: null,
  });
});

const reorderTemplateSubcategories = catchAsync(async (req: Request, res: Response) => {
  const result = await adminService.reorderTemplateSubcategories(req.body.ids);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Templatesubcategorieen succesvol geherordend",
    data: result,
  });
});

const createTuinposterCategory = catchAsync(async (req: Request, res: Response) => {
  const category = await adminService.createTuinposterCategory(req.body);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Tuinpostercategorie succesvol aangemaakt",
    data: category,
  });
});

const getAllTuinposterCategories = catchAsync(async (req: Request, res: Response) => {
  const categories = await adminService.getAllTuinposterCategories();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Tuinpostercategorieen succesvol opgehaald",
    data: categories,
  });
});

const updateTuinposterCategory = catchAsync(async (req: Request, res: Response) => {
  const category = await adminService.updateTuinposterCategory(
    req.params.id as string,
    req.body,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Tuinpostercategorie succesvol bijgewerkt",
    data: category,
  });
});

const deleteTuinposterCategory = catchAsync(async (req: Request, res: Response) => {
  await adminService.deleteTuinposterCategory(req.params.id as string);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Tuinpostercategorie succesvol verwijderd",
    data: null,
  });
});

const createTemplate = catchAsync(async (req: Request, res: Response) => {
  const file = req.file;
  const result = await adminService.createTemplate(req.body, file);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Template succesvol aangemaakt",
    data: result,
  });
});

const updateTemplate = catchAsync(async (req: Request, res: Response) => {
  const file = req.file;
  const result = await adminService.updateTemplate(
    req.params.id as string,
    req.body,
    file,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Template succesvol bijgewerkt",
    data: result,
  });
});

const deleteTemplate = catchAsync(async (req: Request, res: Response) => {
  await adminService.deleteTemplate(req.params.id as string);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Template succesvol verwijderd",
    data: null,
  });
});

const getAllTemplates = catchAsync(async (req: Request, res: Response) => {
  const { page, limit, skip } = calculatePagination(req.query);
  const occasion = req.query.occasion as string;
  const categoryId = req.query.categoryId as string;
  const category = req.query.category as string;
  const searchTerm = req.query.searchTerm as string;
  const isReadymade = req.query.isReadymade === "true" ? true : req.query.isReadymade === "false" ? false : undefined;
  const result = await adminService.getAllTemplates(
    page,
    limit,
    skip,
    occasion,
    categoryId,
    category,
    isReadymade,
    searchTerm,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Templates succesvol opgehaald",
    data: result.templates,
    metaData: result.metaData,
  });
});

const createBackgroundImage = catchAsync(async (req: Request, res: Response) => {
  const file = req.file;
  if (file) {
    const fileUrl = await uploadOptimizedImageToS3(file, "images", 1600, 1600, 80);
    req.body.imageUrl = fileUrl;
  }

  const backgroundImage = await adminService.createBackgroundImage(req.body);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Achtergrondafbeelding succesvol aangemaakt",
    data: backgroundImage,
  });
});

const deleteBackgroundImage = catchAsync(async (req: Request, res: Response) => {
  await adminService.deleteBackgroundImage(req.params.id as string);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    data: null,
    message: "Achtergrondafbeelding succesvol verwijderd",
  });
});

const getAllBackgroundImages = catchAsync(async (req: Request, res: Response) => {
  const backgrounds = await adminService.getAllBackgroundImages();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Achtergrondafbeeldingen succesvol opgehaald",
    data: backgrounds,
  });
});

const reorderTemplateCategories = catchAsync(async (req: Request, res: Response) => {
  const result = await adminService.reorderTemplateCategories(req.body.ids);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Templatecategorieen succesvol geherordend",
    data: result,
  });
});

const reorderTuinposterCategories = catchAsync(async (req: Request, res: Response) => {
  const result = await adminService.reorderTuinposterCategories(req.body.ids);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Tuinpostercategorieen succesvol geherordend",
    data: result,
  });
});

export const adminController = {
  totalOrder,
  getOrderStatusSummary,
  manageOrder,
  manageUsers,
  updateUserStatus,
  getUserSavedDesigns,
  dashboardStats,
  totalTransaction,
  createDecoration,
  deleteDecoration,
  getAllDecoration,
  createDecorationCategory,
  getAllDecorationCategory,
  updateDecorationCategory,
  deleteDecorationCategory,
  getSingleOrder,
  updateOrderAddress,
  createFaq,
  updateFaq,
  deleteFaq,
  getFaqs,
  createTemplateCategory,
  getAllTemplateCategories,
  updateTemplateCategory,
  deleteTemplateCategory,
  reorderTemplateCategories,
  createTemplateSubcategory,
  getAllTemplateSubcategories,
  updateTemplateSubcategory,
  deleteTemplateSubcategory,
  reorderTemplateSubcategories,
  createTuinposterCategory,
  getAllTuinposterCategories,
  updateTuinposterCategory,
  deleteTuinposterCategory,
  reorderTuinposterCategories,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  getAllTemplates,
  createBackgroundImage,
  deleteBackgroundImage,
  getAllBackgroundImages,
};
