import { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { bannerService, ICategory } from "./banner.service";
import { sendResponse } from "../../utils/sendResponse";
import httpStatus from "http-status";
import { calculatePagination } from "../../utils/calculatePagination";
import axios from "axios";
import { AppError } from "../../error/AppError";

const downloadImage = catchAsync(async (req: Request, res: Response) => {
  const { url, filename } = req.query;

  if (!url) {
    throw new AppError("Afbeelding URL is verplicht", httpStatus.BAD_REQUEST);
  }

  const rawUrl = String(Array.isArray(url) ? url[0] : url || "");
  const targetUrl = rawUrl.trim();
  const rawFilename = Array.isArray(filename) ? filename[0] : filename;
  const cleanFilename =
    typeof rawFilename === "string" ? rawFilename : "ontwerp.png";

  try {
    // Fetch the image as a stream with timeout & follow redirects
    const response = await axios({
      method: "GET",
      url: targetUrl,
      responseType: "stream",
      timeout: 30000,
      maxRedirects: 5,
    });

    // Set Content-Disposition to force attachment download
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(cleanFilename)}"`,
    );

    const contentType = response.headers["content-type"];
    if (contentType) {
      res.setHeader("Content-Type", contentType);
    }

    response.data.on("error", (streamErr: any) => {
      console.error("Stream error in downloadImage:", streamErr?.message);
      if (!res.headersSent) {
        res.redirect(targetUrl);
      }
    });

    response.data.pipe(res);
  } catch (error: any) {
    console.error(
      `Failed to stream download for ${targetUrl}:`,
      error?.message,
    );

    // If server stream proxy encounters any error (e.g. PHP/external outage, network blip),
    // redirect browser directly to the target URL so user can still download/open it
    if (
      targetUrl.startsWith("http://") ||
      targetUrl.startsWith("https://")
    ) {
      return res.redirect(targetUrl);
    }

    throw new AppError(
      `Kan bestand niet downloaden: ${error.message}`,
      httpStatus.BAD_GATEWAY,
    );
  }
});

const getBannerPrintPdf = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const bleedMm = req.query.bleedMm ? Number(req.query.bleedMm) : 0;
  const includeCropMarks = req.query.cropMarks === "true";

  const { pdfBuffer, filename } = await bannerService.generateBannerPrintPdf(
    id,
    { bleedMm, includeCropMarks },
  );

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${encodeURIComponent(filename)}"`,
  );
  res.setHeader("Content-Length", pdfBuffer.length);
  res.end(pdfBuffer);
});

const createBanner = catchAsync(
  async (req: Request & { user?: any }, res: Response) => {
    const banner = await bannerService.createBanner(req);

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Banner succesvol aangemaakt",
      data: banner,
    });
  },
);

const createBannerByTemplate = catchAsync(
  async (req: Request & { user?: any }, res: Response) => {
    const banner = await bannerService.createBannerByTemplate(req);

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Banner succesvol aangemaakt",
      data: banner,
    });
  },
);

const updateBanner = catchAsync(
  async (req: Request & { user?: any }, res: Response) => {
    const banner = await bannerService.updateBanner(req, req.params.id as string);

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Banner succesvol bijgewerkt",
      data: banner,
    });
  },
);

const mybanner = catchAsync(
  async (req: Request & { user?: any }, res: Response) => {
    const banner = await bannerService.mybanner(req.user.id);

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Banner succesvol opgehaald",
      data: banner,
    });
  },
);

const getAllbanners = catchAsync(async (req: Request, res: Response) => {
  const { page, limit, skip } = calculatePagination(req.query);
  const category = req.query.category as string;
  const categoryId = req.query.categoryId as string;
  const banners = await bannerService.getAllbanners(
    page,
    limit,
    skip,
    category,
    req.query.fetchFrom as "home" | "gallery",
    categoryId,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Banners succesvol opgehaald",
    data: banners.banners,
    metaData: banners.metaData,
  });
});

const getSelectedBanner = catchAsync(async (req: Request, res: Response) => {
  const banner = await bannerService.getSelectedBanner(
    req.params.id as string,
    (req as Request & { user?: any }).user,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Banner succesvol opgehaald",
    data: banner,
  });
});

const getTemplates = catchAsync(async (req: Request, res: Response) => {
  const { page, limit, skip } = calculatePagination(req.query);
  const occasion = req.query.occasion as string;
  const categoryId = req.query.categoryId as string;
  const category = req.query.category as string;
  const searchTerm = req.query.searchTerm as string;
  const subcategory = req.query.subcategory as string;
  const isReadymade = req.query.isReadymade === "true" ? true : req.query.isReadymade === "false" ? false : undefined;
  const result = await bannerService.getTemplates(
    page,
    limit,
    skip,
    occasion,
    categoryId,
    category,
    isReadymade,
    searchTerm,
    subcategory,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Templates succesvol opgehaald",
    data: result.templates,
    metaData: result.metaData,
  });
});

const getTemplateCategories = catchAsync(async (req: Request, res: Response) => {
  const categories = await bannerService.getTemplateCategories();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Templatecategorieen succesvol opgehaald",
    data: categories,
  });
});

const getTemplateSubcategories = catchAsync(async (req: Request, res: Response) => {
  const query = {
    templateCategoryId: req.query.templateCategoryId as string,
  };
  const subcategories = await bannerService.getTemplateSubcategories(query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Templatesubcategorieen succesvol opgehaald",
    data: subcategories,
  });
});

const getTuinposterCategories = catchAsync(async (req: Request, res: Response) => {
  const categories = await bannerService.getTuinposterCategories();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Tuinpostercategorieen succesvol opgehaald",
    data: categories,
  });
});

const createBannerFromTemplate = catchAsync(
  async (req: Request & { user?: any }, res: Response) => {
    const banner = await bannerService.createBannerFromTemplate(req);

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Banner succesvol aangemaakt op basis van template",
      data: banner,
    });
  },
);

const getTemplateBySlug = catchAsync(async (req: Request, res: Response) => {
  const template = await bannerService.getTemplateBySlug(req.params.slug as string);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Template succesvol opgehaald",
    data: template,
  });
});

const getGoogleShoppingFeed = catchAsync(async (req: Request, res: Response) => {
  const feedXml = await bannerService.getGoogleShoppingFeed();
  res.header("Content-Type", "text/xml");
  res.status(httpStatus.OK).send(feedXml);
});

const duplicateBanner = catchAsync(
  async (req: Request & { user?: any }, res: Response) => {
    const banner = await bannerService.duplicateBanner(req.params.id as string, req);

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Ontwerp succesvol gedupliceerd",
      data: banner,
    });
  },
);

export const bannerController = {
  duplicateBanner,
  mybanner,
  createBanner,
  getAllbanners,
  getSelectedBanner,
  createBannerByTemplate,
  updateBanner,
  getTemplates,
  getTemplateCategories,
  getTemplateSubcategories,
  getTuinposterCategories,
  getTemplateBySlug,
  createBannerFromTemplate,
  downloadImage,
  getGoogleShoppingFeed,
  getBannerPrintPdf,
};
