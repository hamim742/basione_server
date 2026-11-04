import { Request } from "express";
import { prisma } from "../../lib/prisma";
import axios from "axios";
import FormData from "form-data";
import { AppError } from "../../error/AppError";
import { uploadImageToS3, uploadBufferToS3, uploadOptimizedImageToS3, uploadFileToS3 } from "../../utils/uploadAws";
import { getS3KeyFromUrl } from "../../utils/getS3KeyFromUrl";
import { deleteImageFromS3 } from "../../utils/deleteImageFromS3";
import { processCanvasJsonImages } from "../../utils/processCanvasJson";
import slugify from "slugify";
import config from "../../../config";
import { pricingSettingService } from "../pricingSetting/pricingSetting.service";
import { generateBannerPrintPdf as generateBannerPrintPdfUtil } from "./banner.print.pdf";

export const generateUniqueBannerSlug = async (
  headline: string,
  currentId?: string,
): Promise<string> => {

  
  const baseSlug =
    slugify(headline || "spandoek", { lower: true, strict: true }) || "spandoek";

  let slug = baseSlug;
  let counter = 1;
  const MAX_SLUG_ATTEMPTS = 100;

  while (counter <= MAX_SLUG_ATTEMPTS) {
    const isExist = await prisma.banner.findFirst({
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

  // Fallback: if somehow exhausted all attempts, append timestamp for uniqueness
  if (counter > MAX_SLUG_ATTEMPTS) {
    slug = `${baseSlug}-${Date.now()}`;
  }

  return slug;
};

const bannerListSelect = {
  id: true,
  userId: true,
  templateCategoryId: true,
  sourceTemplateId: true,
  templateCategory: true,
  templateCategoryIds: true,
  templateCategories: true,
  templateSubcategoryId: true,
  templateSubcategory: {
    include: {
      templateCategory: true,
    },
  },
  tuinposterCategoryId: true,
  tuinposterCategory: true,
  tuinposterCategoryIds: true,
  tuinposterCategories: true,
  sku: true,
  occasion: true,
  style: true,
  headline: true,
  material: true,
  eyeletType: true,
  slug: true,
  name: true,
  price: true,
  priceInclVat: true,
  priceExclVat: true,
  vatAmount: true,
  vatRate: true,
  areaM2: true,
  pricePerM2: true,
  isVatIncluded: true,
  hobbies: true,
  description: true,
  sizeType: true,
  sizeLabel: true,
  width: true,
  height: true,
  imageUrl: true,
  originalImageUrl: true,
  variant: true,
  designNumber: true,
  revisedPrompt: true,
  source: true,
  savedFromEditor: true,
  isSavedDesign: true,
  isOrdered: true,
  designStatus: true,
  lifecycleStatus: true,
  orderedAt: true,
  orderId: true,
  isSelected: true,
  isTemplate: true,
  isReadymade: true,
  mockupUrl: true,
  mockupFirstUrl: true,
  mockupHedgeUrl: true,
  mockupPartyUrl: true,
  mockupRailingUrl: true,
  mockupLawnNewUrl: true,
  mockupGardenUrl: true,
  status: true,
  generationId: true,
  createdAt: true,
  updatedAt: true,
  svgMaskId: true,
  svgMask: {
    select: {
      id: true,
      name: true,
      svgUrl: true,
    },
  },
};

const buildReviewSummary = async (templateId: string) => {
  const result = await prisma.templateReview.aggregate({
    where: {
      templateId,
    },
    _avg: {
      rating: true,
    },
    _count: {
      rating: true,
    },
  });

  return {
    averageRating: result._avg.rating ? roundToTwo(result._avg.rating) : 0,
    totalReviews: result._count.rating,
  };
};

const attachReviewSummary = async <T extends { id: string }>(template: T) => {
  return {
    ...template,
    reviewSummary: await buildReviewSummary(template.id),
  };
};

const attachReviewSummaries = async <T extends { id: string }>(
  templates: T[],
) => {
  return Promise.all(templates.map((template) => attachReviewSummary(template)));
};

export enum ICategory {
  wedding = "wedding",
  birthday = "birthday",
  kids_party = "party",
  baby_shower = "baby_shower",
  engagement = "engagement",
}

type AuthRequest = Request & {
  user?: any;
  file?: Express.Multer.File;
};

const VAT_RATE = 0.21;

// Client confirmed: these prices are INCLUDING VAT
const MIN_PRICE_INCL_VAT = 11.95;
const PRICE_PER_M2_UNDER_1_INCL_VAT = 25;
const PRICE_PER_M2_FROM_1_INCL_VAT = 20;

const MAX_WIDTH_CM = 240;
const MAX_HEIGHT_CM = 160;

const calculateAreaM2 = (widthCm: number, heightCm: number) => {
  return (widthCm / 100) * (heightCm / 100);
};

const getPricePerM2InclVat = (
  areaM2: number,
  under1: number = PRICE_PER_M2_UNDER_1_INCL_VAT,
  from1: number = PRICE_PER_M2_FROM_1_INCL_VAT
) => {
  return areaM2 < 1 ? under1 : from1;
};

export const calculateBannerPriceInclVat = (
  widthCm: number,
  heightCm: number,
  pricing?: {
    baseBannerPrice?: number;
    pricePerM2Under1?: number;
    pricePerM2From1?: number;
    standardPrice60x40?: number;
    standardPrice120x80?: number;
    standardPrice180x120?: number;
    standardPrice240x160?: number;
  } | null
) => {
  const minDim = Math.min(widthCm, heightCm);
  const maxDim = Math.max(widthCm, heightCm);

  if (minDim === 40 && maxDim === 60 && pricing?.standardPrice60x40 !== undefined) {
    return pricing.standardPrice60x40;
  }
  if (minDim === 80 && maxDim === 120 && pricing?.standardPrice120x80 !== undefined) {
    return pricing.standardPrice120x80;
  }
  if (minDim === 120 && maxDim === 180 && pricing?.standardPrice180x120 !== undefined) {
    return pricing.standardPrice180x120;
  }
  if (minDim === 160 && maxDim === 240 && pricing?.standardPrice240x160 !== undefined) {
    return pricing.standardPrice240x160;
  }

  const areaM2 = calculateAreaM2(widthCm, heightCm);
  const under1 = pricing?.pricePerM2Under1 ?? PRICE_PER_M2_UNDER_1_INCL_VAT;
  const from1 = pricing?.pricePerM2From1 ?? PRICE_PER_M2_FROM_1_INCL_VAT;
  const minPrice = pricing?.baseBannerPrice ?? MIN_PRICE_INCL_VAT;
  const pricePerM2InclVat = getPricePerM2InclVat(areaM2, under1, from1);
  const calculatedPrice = areaM2 * pricePerM2InclVat;

  return roundToTwo(Math.max(calculatedPrice, minPrice));
};

const calculatePriceInclVat = calculateBannerPriceInclVat;

const calculatePriceExclVat = (priceInclVat: number) => {
  return priceInclVat / (1 + VAT_RATE);
};

const calculateVatAmount = (priceInclVat: number) => {
  return priceInclVat - calculatePriceExclVat(priceInclVat);
};

const formatLabel = (text: string) => {
  return text
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

const roundToTwo = (value: number): number => {
  return Math.round((value + Number.EPSILON) * 100) / 100;
};

const parseMultipartData = (rawData: unknown) => {
  if (!rawData) {
    return {};
  }

  if (typeof rawData !== "string") {
    return rawData;
  }

  try {
    return JSON.parse(rawData);
  } catch {
    throw new AppError("Ongeldige data JSON.", 400);
  }
};

const getCanvasJson = async (data: any) => {
  const canvasJson = data?.canvasJson ?? data?.canvasJSON;

  if (canvasJson === undefined || canvasJson === null) {
    return null;
  }

  const rawJson =
    typeof canvasJson === "string"
      ? canvasJson
      : JSON.stringify(canvasJson);

  return processCanvasJsonImages(rawJson);
};

const getSizeType = (data: any, fallback = "custom") => {
  if (typeof data?.size === "string") {
    return data.size;
  }

  return data?.sizeType || data?.size?.type || fallback;
};

const getSizeLabel = (data: any, sizeType: string, fallback?: string | null) => {
  return data?.sizeLabel || data?.size?.label || fallback || formatLabel(sizeType);
};

const getProvidedNumber = (value: unknown) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const numberValue = Number(value);

  return Number.isNaN(numberValue) ? undefined : numberValue;
};

const getProvidedBoolean = (value: unknown) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.toLowerCase();

    if (["1", "true", "yes"].includes(normalized)) {
      return true;
    }

    if (["0", "false", "no"].includes(normalized)) {
      return false;
    }
  }

  if (typeof value === "number") {
    return value === 1;
  }

  return undefined;
};

const normalizeStringArray = (value: unknown) => {
  if (Array.isArray(value)) {
    return value.map(String);
  }

  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }

  return [];
};

const mapBannerForEditor = (banner: any) => {
  const canvasJson = banner?.canvasJson ?? banner?.canvasJSON ?? null;

  return {
    ...banner,
    canvasJson,
    size: banner?.sizeLabel || banner?.sizeType,
  };
};

const getSavedDesignDefaults = (data: any = {}) => ({
  source: data.source || "editor",
  savedFromEditor: getProvidedBoolean(data.savedFromEditor) ?? true,
  isSavedDesign: getProvidedBoolean(data.isSavedDesign) ?? true,
  isOrdered: getProvidedBoolean(data.isOrdered) ?? false,
  designStatus: data.designStatus || "saved",
  lifecycleStatus: data.lifecycleStatus || "saved",
  orderedAt: data.orderedAt ? new Date(data.orderedAt) : null,
  orderId: data.orderId || null,
});

const getLifecycleUpdateData = (data: any) => {
  const updateData: any = {};

  if (!data) {
    return updateData;
  }

  if (data.source !== undefined) updateData.source = data.source;
  if (data.savedFromEditor !== undefined) {
    updateData.savedFromEditor = getProvidedBoolean(data.savedFromEditor) ?? false;
  }
  if (data.isSavedDesign !== undefined) {
    updateData.isSavedDesign = getProvidedBoolean(data.isSavedDesign) ?? false;
  }
  if (data.isOrdered !== undefined) {
    updateData.isOrdered = getProvidedBoolean(data.isOrdered) ?? false;
  }
  if (data.designStatus !== undefined) updateData.designStatus = data.designStatus;
  if (data.lifecycleStatus !== undefined) {
    updateData.lifecycleStatus = data.lifecycleStatus;
  }
  if (data.orderedAt !== undefined) {
    updateData.orderedAt = data.orderedAt ? new Date(data.orderedAt) : null;
  }
  if (data.orderId !== undefined) updateData.orderId = data.orderId || null;

  return updateData;
};

const canAccessOwnedBanner = (banner: any, user?: any) => {
  if (banner?.isTemplate) {
    return true;
  }

  if (!banner?.userId) {
    return true;
  }

  return user?.role === "admin" || banner.userId === user?.id;
};

const copyGeneratedImageToFolder = async (imageUrl: string, variant: number): Promise<string> => {
  try {
    const originalKey = getS3KeyFromUrl(imageUrl);
    if (!originalKey) return imageUrl;

    if (originalKey.startsWith("ai-banners/")) {
      return imageUrl;
    }

    // Download image from the temporary URL (S3 root)
    const imageResponse = await axios.get(imageUrl, { responseType: "arraybuffer" });
    const buffer = Buffer.from(imageResponse.data);

    // Define the new S3 key under the folder "ai-banners"
    const newKey = `ai-banners/${Date.now()}-v${variant}-${originalKey}`;

    // Upload buffer to S3
    const newUrl = await uploadBufferToS3({
      buffer,
      key: newKey,
      contentType: "image/png",
    });

    // Delete the original image from the S3 root
    await deleteImageFromS3(originalKey);

    return newUrl;
  } catch (error) {
    console.error("Failed to copy generated image to S3 folder:", error);
    // Fallback to original URL
    return imageUrl;
  }
};

const assertCanAccessOwnedBanner = (banner: any, user?: any) => {
  if (!canAccessOwnedBanner(banner, user)) {
    throw new AppError("Je bent niet geautoriseerd", 403);
  }
};

const createBanner = async (req: AuthRequest) => {
  const parsedData = req.body;

  const width = Number(parsedData?.size?.width);
  const height = Number(parsedData?.size?.height);

  if (
    Number.isNaN(width) ||
    Number.isNaN(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new AppError("Ongeldige bannerafmeting.", 400);
  }

  // Sizing validations (no upper limit enforced)

  /**
   * Price calculation
   * All prices are INCLUDING VAT.
   */
  const pricingSettings = await pricingSettingService.getPricingSetting().catch(() => null);
  const areaM2 = calculateAreaM2(width, height);
  const price = calculateBannerPriceInclVat(width, height, pricingSettings);
  const priceExclVat = calculatePriceExclVat(price);
  const vatAmount = calculateVatAmount(price);
  const pricePerM2InclVat = getPricePerM2InclVat(areaM2);

  const name = parsedData?.name || "";
  const age = parsedData?.age || "";
  let description = parsedData.description || "";

  if (name || age) {
    const textParts = [];
    if (name) textParts.push(`the name "${name}"`);
    if (age) textParts.push(`the age "${age}"`);
    const textStr = textParts.join(" and ");
    
    description = `${description}\n\n[IMPORTANT INSTRUCTION]: The banner must clearly and visibly display the text for ${textStr}. Please render the text "${name}"${age ? ` and "${age}"` : ""} in a very clean, large, beautiful, and highly legible typography that matches the ${parsedData?.style || "modern"} style of the banner. Make sure the text is spelled correctly.`.trim();
  }

  const formData = new FormData();

  formData.append(
    "data",
    JSON.stringify({
      occasion: parsedData?.occasion,
      style: parsedData?.style,
      headline: parsedData?.headline || "",
      subtext: parsedData?.subheadline || "",
      name,
      age,
      description: description || "A beautiful custom banner",
    }),
  );

  if (req.file) {
    formData.append("ref_image_1", req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });
  }

  formData.append("ref_image_2", "");
  formData.append("ref_image_3", "");
  formData.append("ref_image_4", "");

  const response = await axios.post(
    "https://ai.spandoekprint.nl/generate",
    formData,
    {
      headers: {
        ...formData.getHeaders(),
        accept: "application/json",
      },
      responseType: "stream",
      validateStatus: () => true,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    },
  );

  if (response.status >= 400) {
    let rawError = "";

    await new Promise<void>((resolve, reject) => {
      response.data.on("data", (chunk: Buffer) => {
        rawError += chunk.toString("utf-8");
      });

      response.data.on("end", () => resolve());
      response.data.on("error", reject);
    });

    console.error("AI server error:", rawError);

    throw new AppError("AI-server wordt afgesloten", 400);
  }

  return new Promise((resolve, reject) => {
    const finalVariants: {
      variant: number;
      url: string | null;
      image_b64?: string | null;
      revised_prompt?: string;
    }[] = [];

    let buffer = "";
    let isFinished = false;

    const saveAndResolve = async () => {
      if (isFinished) return;

      isFinished = true;

      const sortedVariants = [...finalVariants].sort(
        (a, b) => a.variant - b.variant,
      );

      const savedBanners: any[] = [];
      const generationId = `gen-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;

      for (const item of sortedVariants) {
        let imageUrl = item.url ?? "";
        if (imageUrl && (imageUrl.startsWith("http://") || imageUrl.startsWith("https://"))) {
          imageUrl = await copyGeneratedImageToFolder(imageUrl, item.variant);
        }

        const slug = await generateUniqueBannerSlug(
          `${parsedData.headline || "banner"}-v${item.variant}`,
        );
        const banner = await prisma.banner.create({
          data: {
            userId: req.user?.id || null,

            occasion: parsedData.occasion,
            style: parsedData.style,
            headline: parsedData.headline,
            slug,
            name: parsedData.name,

            hobbies: parsedData.hobbies || [],
            description: parsedData.description,

            sizeType: parsedData.size.type,
            sizeLabel: parsedData.size.label,
            width: parsedData.size.width,
            height: parsedData.size.height,

            imageUrl: imageUrl,
            variant: item.variant,

            price,

            revisedPrompt: item.revised_prompt || null,
            generationId,
          },
        });
        savedBanners.push(banner);
      }

      resolve({
        variants: savedBanners,

        /**
         * Optional response summary.
         * Useful for debugging/testing frontend.
         */
        pricing: {
          areaM2: roundToTwo(areaM2),
          pricePerM2InclVat,
          priceInclVat: price,
          priceExclVat,
          vatAmount,
          vatRate: VAT_RATE,
        },
      });
    };

    response.data.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      buffer += text;

      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";

      for (const part of parts) {
        const lines = part.split("\n");
        const dataLines: string[] = [];

        for (const line of lines) {
          const trimmedLine = line.trim();

          if (trimmedLine.startsWith("data:")) {
            dataLines.push(trimmedLine.replace("data:", "").trim());
          }
        }

        const dataStr = dataLines.join("");

        if (!dataStr) continue;

        let data: any;

        try {
          data = JSON.parse(dataStr);
        } catch {
          data = dataStr;
        }

        const event = data?.event?.trim?.();

        if (event === "final") {
          finalVariants.push({
            variant: data?.variant ?? null,
            url: data?.url ?? null,
            image_b64: data?.image_b64 ?? null,
            revised_prompt: data?.revised_prompt ?? "",
          });
        }

        if (event === "error") {
          if (!isFinished) {
            isFinished = true;

            reject(
              new AppError(
                data?.message || "AI-server gaf een fout terug",
                400,
              ),
            );
          }

          return;
        }

        if (event === "all_done") {
          saveAndResolve().catch((err) => {
            if (!isFinished) {
              isFinished = true;
              reject(err);
            }
          });

          return;
        }
      }
    });

    response.data.on("end", () => {
      saveAndResolve().catch((err) => {
        if (!isFinished) {
          isFinished = true;
          reject(err);
        }
      });
    });

    response.data.on("error", (err: Error) => {
      if (!isFinished) {
        isFinished = true;
        reject(err);
      }
    });
  });
};

const createBannerByTemplate = async (req: AuthRequest) => {
  const parsedData: any = parseMultipartData(req?.body?.data);
  const sizeType = getSizeType(parsedData);

  let occ = "";
  let headline = parsedData.headline || parsedData.name || "";

  if (sizeType === "party-banner") {
    occ = "party";
    headline = headline || "Welcome to the party";
  } else if (sizeType === "blessing-sign") {
    occ = "wedding";
    headline = headline || "We are getting married";
  } else if (sizeType === "birthday-backdrop") {
    occ = "birthday";
    headline = headline || "Happy birthday";
  } else {
    occ = parsedData.occasion || "custom";
    headline = headline || "Custom Banner";
  }

  const height = Number(parsedData.height ?? parsedData?.size?.height);
  const width = Number(parsedData.width ?? parsedData?.size?.width);

  if (
    Number.isNaN(width) ||
    Number.isNaN(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new AppError("Ongeldige bannerbreedte of -hoogte", 400);
  }

  const areaM2 = calculateAreaM2(width, height);
  const pricePerM2InclVat = getPricePerM2InclVat(areaM2);

  const pricingSettings = await pricingSettingService.getPricingSetting().catch(() => null);

  // Final price is already INCLUDING VAT
  const priceInclVat =
    getProvidedNumber(parsedData.priceInclVat) ??
    getProvidedNumber(parsedData.price) ??
    calculatePriceInclVat(width, height, pricingSettings);
  const priceExclVat =
    getProvidedNumber(parsedData.priceExclVat) ??
    calculatePriceExclVat(priceInclVat);
  const vatAmount =
    getProvidedNumber(parsedData.vatAmount) ?? calculateVatAmount(priceInclVat);
  const vatRate = getProvidedNumber(parsedData.vatRate) ?? VAT_RATE;

  let imgUrl = parsedData.imageUrl || "";
  let originalImgUrl = parsedData.originalImageUrl || parsedData.imageUrl || "";

  if (req?.file) {
    const [originalImg, optimizedImg] = await Promise.all([
      uploadFileToS3(req.file, "banner-originals"),
      uploadOptimizedImageToS3(req.file, "images"),
    ]);
    imgUrl = optimizedImg;
    originalImgUrl = originalImg;
  }

  const sizeLabel = getSizeLabel(parsedData, sizeType);

  const slug = await generateUniqueBannerSlug(headline);
  const canvasJson = await getCanvasJson(parsedData);
  const lifecycleData = getSavedDesignDefaults(parsedData);

  const banner = await prisma.banner.create({
    data: {
      userId: req.user?.id || null,
      headline,
      slug,
      occasion: occ,
      imageUrl: imgUrl,
      originalImageUrl: originalImgUrl || imgUrl,

      // Main price field should store VAT-included final price
      price: Number(priceInclVat.toFixed(2)),
      priceInclVat: Number(priceInclVat.toFixed(2)),
      priceExclVat: Number(priceExclVat.toFixed(2)),
      vatAmount: Number(vatAmount.toFixed(2)),
      vatRate,
      areaM2: Number(areaM2.toFixed(2)),
      pricePerM2: Number(pricePerM2InclVat.toFixed(2)),
      isVatIncluded: parsedData.isVatIncluded ?? true,
      material: parsedData.material || null,
      eyeletType: parsedData.eyeletType || null,

      width,
      height,
      sizeType,
      sizeLabel,
      style: parsedData.style || "Template",
      name: parsedData.name || null,
      description: parsedData.description || null,
      hobbies: normalizeStringArray(parsedData.hobbies),
      variant: 0,
      canvasJSON: canvasJson,
      tuinposterCategoryId: parsedData.tuinposterCategoryId || null,
      tuinposterCategoryIds: parsedData.tuinposterCategoryIds || (parsedData.tuinposterCategoryId ? [parsedData.tuinposterCategoryId] : []),
      ...lifecycleData,
    },
  });

  return mapBannerForEditor(banner);
};

const updateBanner = async (req: AuthRequest, bannerId: string) => {
  const banner = await prisma.banner.findUnique({
    where: {
      id: bannerId,
    },
  });

  if (!banner) {
    throw new AppError("Banner niet gevonden", 404);
  }

  const shouldClaimBanner =
    !banner.userId && !banner.isTemplate && req.user && req.user.role !== "admin";

  if (banner.userId) {
    assertCanAccessOwnedBanner(banner, req.user);
  } else if (shouldClaimBanner && req.user) {
    banner.userId = req.user.id;
  }

  if (!banner.isTemplate && banner.isOrdered && req.user?.role !== "admin") {
    throw new AppError("Bestelde ontwerpen kunnen niet worden bewerkt", 400);
  }

  if (banner.generationId) {
    await cleanupUnselectedGenerationVariants(banner.id, banner.generationId);
  }

  let parsedData: any = null;

  if (req?.body?.data) {
    parsedData = parseMultipartData(req.body.data);
  }

  let occasion = banner.occasion;
  let headline = banner.headline;
  const parsedSizeType = parsedData ? getSizeType(parsedData, banner.sizeType) : banner.sizeType;

  if (parsedSizeType === "party-banner") {
    occasion = "party";
    headline = "Welcome to the party";
  } else if (parsedSizeType === "blessing-sign") {
    occasion = "wedding";
    headline = "We are getting married";
  } else if (parsedSizeType === "birthday-backdrop") {
    occasion = "birthday";
    headline = `Happy birthday ${banner.name || ""}`.trim();
  }

  const width = parsedData?.width || parsedData?.size?.width
    ? Number(parsedData.width ?? parsedData.size.width)
    : Number(banner.width);
  const height = parsedData?.height || parsedData?.size?.height
    ? Number(parsedData.height ?? parsedData.size.height)
    : Number(banner.height);

  let price = banner.price;

  let areaM2 = banner.areaM2 ?? calculateAreaM2(width, height);
  let pricePerM2InclVat = banner.pricePerM2 ?? getPricePerM2InclVat(areaM2);
  let priceInclVat = banner.priceInclVat ?? Number(banner.price);
  let priceExclVat =
    banner.priceExclVat ?? calculatePriceExclVat(priceInclVat);
  let vatAmount = banner.vatAmount ?? calculateVatAmount(priceInclVat);

  const hasWidthOrHeight =
    parsedData?.width !== undefined ||
    parsedData?.height !== undefined ||
    parsedData?.size?.width !== undefined ||
    parsedData?.size?.height !== undefined;

  if (hasWidthOrHeight) {
    if (
      Number.isNaN(width) ||
      Number.isNaN(height) ||
      width <= 0 ||
      height <= 0
    ) {
      throw new AppError("Ongeldige bannerbreedte of -hoogte", 400);
    }

    areaM2 = calculateAreaM2(width, height);
    pricePerM2InclVat = getPricePerM2InclVat(areaM2);

    const pricingSettings = await pricingSettingService.getPricingSetting().catch(() => null);
    // Final price is already INCLUDING VAT
    priceInclVat = calculatePriceInclVat(width, height, pricingSettings);
    priceExclVat = calculatePriceExclVat(priceInclVat);
    vatAmount = calculateVatAmount(priceInclVat);

    price = Number(priceInclVat.toFixed(2));
  }

  const providedPriceInclVat =
    getProvidedNumber(parsedData?.priceInclVat) ??
    getProvidedNumber(parsedData?.price);
  const providedPriceExclVat = getProvidedNumber(parsedData?.priceExclVat);
  const providedVatAmount = getProvidedNumber(parsedData?.vatAmount);
  const providedVatRate = getProvidedNumber(parsedData?.vatRate);
  const providedAreaM2 = getProvidedNumber(parsedData?.areaM2);
  const providedPricePerM2 = getProvidedNumber(parsedData?.pricePerM2);

  if (providedPriceInclVat !== undefined) {
    priceInclVat = providedPriceInclVat;
    price = Number(providedPriceInclVat.toFixed(2));
  }

  if (providedPriceExclVat !== undefined) {
    priceExclVat = providedPriceExclVat;
  }

  if (providedVatAmount !== undefined) {
    vatAmount = providedVatAmount;
  }

  if (providedAreaM2 !== undefined) {
    areaM2 = providedAreaM2;
  }

  if (providedPricePerM2 !== undefined) {
    pricePerM2InclVat = providedPricePerM2;
  }

  let imageUrl = banner?.imageUrl;
  let originalImageUrl = banner?.originalImageUrl || banner?.imageUrl;
  const oldImg = banner?.imageUrl;
  const oldOriginalImg = banner?.originalImageUrl;

  if (req?.file) {
    const [originalImg, optimizedImg] = await Promise.all([
      uploadFileToS3(req.file, "banner-originals"),
      uploadOptimizedImageToS3(req.file, "images"),
    ]);
    imageUrl = optimizedImg;
    originalImageUrl = originalImg;

    // Only delete original image from S3 if we are updating a user banner draft, NOT a template!
    if (oldImg && !banner.isTemplate) {
      const oldKey = getS3KeyFromUrl(oldImg);

      if (oldKey) {
        await deleteImageFromS3(oldKey).catch(() => null);
      }
    }
    if (oldOriginalImg && !banner.isTemplate && oldOriginalImg !== oldImg) {
      const oldOrigKey = getS3KeyFromUrl(oldOriginalImg);

      if (oldOrigKey) {
        await deleteImageFromS3(oldOrigKey).catch(() => null);
      }
    }
  }

  // If this is a template banner, create a new customized user banner copy instead of modifying the template!
  if (banner.isTemplate) {
    let bannerHeadline = parsedData?.headline || banner.headline;
    if (banner.tuinposterCategoryId && !bannerHeadline.startsWith("Tuinposter - ")) {
      bannerHeadline = `Tuinposter - ${bannerHeadline}`;
    }
    const slug = await generateUniqueBannerSlug(bannerHeadline);
    const lifecycleData = getSavedDesignDefaults(parsedData);

    let bannerName = parsedData?.name || banner.name;
    if (banner.tuinposterCategoryId && bannerName && !bannerName.startsWith("Tuinposter - ")) {
      bannerName = `Tuinposter - ${bannerName}`;
    }

    const newBanner = await prisma.banner.create({
      data: {
        userId: req.user?.id || null,
        templateCategoryId: banner.templateCategoryId || null,
        templateCategoryIds: banner.templateCategoryIds || [],
        tuinposterCategoryId: banner.tuinposterCategoryId || null,
        tuinposterCategoryIds: banner.tuinposterCategoryIds || [],
        sourceTemplateId: banner.id,
        svgMaskId: banner.svgMaskId,
        occasion: occasion,
        style: banner.style,
        headline: bannerHeadline,
        slug,
        name: bannerName,
        description: parsedData?.description || banner.description,
        hobbies:
          parsedData?.hobbies !== undefined
            ? normalizeStringArray(parsedData.hobbies)
            : banner.hobbies || [],
        sizeType: parsedSizeType || banner.sizeType,
        sizeLabel: getSizeLabel(parsedData, parsedSizeType, banner.sizeLabel),
        width,
        height,
        imageUrl,
        originalImageUrl,
        price,
        priceInclVat: Number(priceInclVat.toFixed(2)),
        priceExclVat: Number(priceExclVat.toFixed(2)),
        vatAmount: Number(vatAmount.toFixed(2)),
        vatRate: providedVatRate ?? VAT_RATE,
        areaM2: Number(areaM2.toFixed(2)),
        pricePerM2: Number(pricePerM2InclVat.toFixed(2)),
        isVatIncluded: parsedData?.isVatIncluded ?? true,
        material: parsedData?.material ?? banner.material,
        eyeletType: parsedData?.eyeletType ?? banner.eyeletType,
        variant: 0,
        isTemplate: false,
        isSelected: true,
        status: "SELECTED",
        canvasJSON: (await getCanvasJson(parsedData)) ?? banner.canvasJSON,
        ...lifecycleData,
      },
    });

    return mapBannerForEditor(newBanner);
  }

  const updateData: any = {};

  if (imageUrl) {
    updateData.imageUrl = imageUrl;
  }

  if (originalImageUrl) {
    updateData.originalImageUrl = originalImageUrl;
  }

  let finalHeadline = banner.headline;

  if (parsedData?.size !== undefined || parsedData?.sizeType !== undefined) {
    finalHeadline = headline;
    updateData.headline = headline;
    updateData.occasion = occasion;
    updateData.price = price;
    updateData.sizeType = parsedSizeType;
    updateData.sizeLabel = getSizeLabel(parsedData, parsedSizeType, banner.sizeLabel);
  }

  if (parsedData?.headline && parsedData.headline !== banner.headline) {
    finalHeadline = parsedData.headline;
    updateData.headline = parsedData.headline;
  }

  if (finalHeadline !== banner.headline) {
    updateData.slug = await generateUniqueBannerSlug(finalHeadline, bannerId);
  }

  if (parsedData?.name !== undefined) {
    updateData.name = parsedData.name;
  }

  if (parsedData?.description !== undefined) {
    updateData.description = parsedData.description;
  }

  if (parsedData?.hobbies !== undefined) {
    updateData.hobbies = normalizeStringArray(parsedData.hobbies);
  }

  if (parsedData?.width !== undefined || parsedData?.size?.width !== undefined) {
    updateData.width = width;
  }

  if (parsedData?.height !== undefined || parsedData?.size?.height !== undefined) {
    updateData.height = height;
  }

  if (hasWidthOrHeight || providedPriceInclVat !== undefined) {
    updateData.price = price;
  }

  if (hasWidthOrHeight || providedAreaM2 !== undefined) {
    updateData.areaM2 = Number(areaM2.toFixed(2));
  }

  if (hasWidthOrHeight || providedPricePerM2 !== undefined) {
    updateData.pricePerM2 = Number(pricePerM2InclVat.toFixed(2));
  }

  if (hasWidthOrHeight || providedPriceInclVat !== undefined) {
    updateData.priceInclVat = Number(priceInclVat.toFixed(2));
  }

  if (hasWidthOrHeight || providedPriceExclVat !== undefined) {
    updateData.priceExclVat = Number(priceExclVat.toFixed(2));
  }

  if (hasWidthOrHeight || providedVatAmount !== undefined) {
    updateData.vatAmount = Number(vatAmount.toFixed(2));
  }

  if (providedVatRate !== undefined || hasWidthOrHeight) {
    updateData.vatRate = providedVatRate ?? VAT_RATE;
  }

  if (parsedData?.isVatIncluded !== undefined) {
    updateData.isVatIncluded = parsedData.isVatIncluded;
  } else if (hasWidthOrHeight || providedPriceInclVat !== undefined) {
    updateData.isVatIncluded = true;
  }

  if (
    parsedData?.canvasJson !== undefined ||
    parsedData?.canvasJSON !== undefined
  ) {
    updateData.canvasJSON = await getCanvasJson(parsedData);
  }

  if (parsedData?.tuinposterCategoryId !== undefined) {
    updateData.tuinposterCategoryId = parsedData.tuinposterCategoryId;
    updateData.tuinposterCategoryIds = parsedData.tuinposterCategoryIds || (parsedData.tuinposterCategoryId ? [parsedData.tuinposterCategoryId] : []);
  }

  if (parsedData?.material !== undefined) {
    updateData.material = parsedData.material;
  }

  if (parsedData?.eyeletType !== undefined) {
    updateData.eyeletType = parsedData.eyeletType;
  }

  Object.assign(updateData, getLifecycleUpdateData(parsedData));

  const isEditorSave =
    parsedData?.source === "editor" ||
    parsedData?.savedFromEditor !== undefined ||
    parsedData?.isSavedDesign !== undefined ||
    parsedData?.canvasJson !== undefined ||
    parsedData?.canvasJSON !== undefined;

  if (isEditorSave && !banner.isOrdered) {
    updateData.source = updateData.source ?? banner.source ?? "editor";
    updateData.savedFromEditor = updateData.savedFromEditor ?? true;
    updateData.isSavedDesign = updateData.isSavedDesign ?? true;
    updateData.isOrdered = updateData.isOrdered ?? false;
    updateData.designStatus = updateData.designStatus ?? "saved";
    updateData.lifecycleStatus = updateData.lifecycleStatus ?? "saved";
  }

  if (shouldClaimBanner && req.user) {
    updateData.userId = req.user.id;
  }

  const updatedBanner = await prisma.banner.update({
    where: {
      id: bannerId,
    },
    data: updateData,
  });

  return mapBannerForEditor(updatedBanner);
};

const mybanner = async (id: string) => {
  const banner = await prisma.banner.findMany({
    where: {
      userId: id,
    },
    select: bannerListSelect,
  });
  return banner;
};

const getAllbanners = async (
  page: number,
  limit: number,
  skip: number,
  category?: string,
  fetchFrom?: "home" | "gallery",
  categoryId?: string,
) => {
  const where: any = {};

  if (categoryId && categoryId !== "all" && categoryId !== "undefined") {
    where.OR = [
      { templateCategoryId: categoryId },
      { templateCategoryIds: { has: categoryId } },
    ];
  } else if (category && category !== "all" && category !== "undefined") {
    const templateCategory = await prisma.templateCategory.findFirst({
      where: {
        slug: category,
        isActive: true,
      },
    });

    if (templateCategory) {
      where.OR = [
        { templateCategoryId: templateCategory.id },
        { templateCategoryIds: { has: templateCategory.id } },
      ];
    } else {
      where.occasion = category;
    }
  }

  if (fetchFrom === "home" || fetchFrom === "gallery") {
    where.isTemplate = true;
  }

  const banners = await prisma.banner.findMany({
    skip,
    take: fetchFrom === "home" ? 6 : limit,
    where,
    orderBy: {
      createdAt: "desc",
    },
    select: bannerListSelect,
  });

  const total = await prisma.banner.count({
    where,
  });

  return {
    banners,
    metaData: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

const cleanupUnselectedGenerationVariants = async (
  selectedBannerId: string,
  generationId: string,
) => {
  if (!generationId) return;

  try {
    const otherBanners = await prisma.banner.findMany({
      where: {
        generationId,
        id: { not: selectedBannerId },
      },
    });

    if (!otherBanners || otherBanners.length === 0) return;

    for (const other of otherBanners) {
      if (other.imageUrl) {
        const key = getS3KeyFromUrl(other.imageUrl);
        if (key) {
          await deleteImageFromS3(key);
        }
      }
      if (other.originalImageUrl) {
        const key = getS3KeyFromUrl(other.originalImageUrl);
        if (key) {
          await deleteImageFromS3(key);
        }
      }
      if (other.mockupUrl) {
        const key = getS3KeyFromUrl(other.mockupUrl);
        if (key) {
          await deleteImageFromS3(key);
        }
      }
    }

    await prisma.banner.deleteMany({
      where: {
        generationId,
        id: { not: selectedBannerId },
      },
    });
  } catch (cleanError) {
    console.error("Failed to clean up unselected variants:", cleanError);
  }
};

const getSelectedBanner = async (id: string, user?: any) => {
  const banner = await prisma.banner.findUnique({
    where: {
      id,
    },
    include: {
      svgMask: true,
    },
  });

  if (!banner) {
    throw new AppError("Banner niet gevonden", 404);
  }

  assertCanAccessOwnedBanner(banner, user);

  // If this banner belongs to an AI generation, delete the other 3 variants from DB and S3
  if (banner.generationId) {
    await cleanupUnselectedGenerationVariants(banner.id, banner.generationId);
  }

  const selectedBanner = await prisma.banner.update({
    where: {
      id,
    },
    data: {
      isSelected: true,
      status: "SELECTED",
    },
    include: {
      svgMask: true,
    },
  });

  return mapBannerForEditor(selectedBanner);
};

const getTemplates = async (
  page: number,
  limit: number,
  skip: number,
  occasion?: string,
  categoryId?: string,
  category?: string,
  isReadymade?: boolean,
  searchTerm?: string,
  subcategory?: string,
) => {
  const businessSlugs = ["zakelijke", "business", "zakelijk", "corporate"];
  let isBusinessRequest = false;

  if (category) {
    isBusinessRequest = businessSlugs.includes(category.toLowerCase());
  } else if (categoryId) {
    const cat = await prisma.templateCategory.findUnique({
      where: { id: categoryId },
      select: { slug: true }
    });
    if (cat && cat.slug) {
      isBusinessRequest = businessSlugs.includes(cat.slug.toLowerCase());
    }
  }

  const where: any = {
    isTemplate: true,
    isReadymade: isReadymade ?? false,
  };

  if (!isBusinessRequest) {
    where.NOT = [
      {
        AND: [
          { templateCategoryId: { not: null } },
          { templateCategory: { slug: { in: businessSlugs } } }
        ]
      },
      { templateCategories: { some: { slug: { in: businessSlugs } } } },
      { occasion: { in: businessSlugs } },
    ];
  }

  if (categoryId) {
    if (isReadymade) {
      where.OR = [
        { tuinposterCategoryId: categoryId },
        { tuinposterCategoryIds: { has: categoryId } },
      ];
    } else {
      where.OR = [
        { templateCategoryId: categoryId },
        { templateCategoryIds: { has: categoryId } },
      ];
    }
  } else if (category) {
    if (isReadymade) {
      const tuinCategory = await prisma.tuinposterCategory.findFirst({
        where: {
          slug: category,
          isActive: true,
        },
      });

      if (tuinCategory) {
        where.OR = [
          { tuinposterCategoryId: tuinCategory.id },
          { tuinposterCategoryIds: { has: tuinCategory.id } },
        ];
      } else {
        where.occasion = category;
      }
    } else {
      let templateCategory = await prisma.templateCategory.findFirst({
        where: {
          slug: category,
          isActive: true,
        },
      });

      if (!templateCategory) {
        const term = category.replace(/-spandoek$/, "").toLowerCase();
        templateCategory = await prisma.templateCategory.findFirst({
          where: {
            isActive: true,
            OR: [
              { slug: { contains: term, mode: "insensitive" } },
              { name: { contains: term, mode: "insensitive" } },
            ],
          },
        });
      }

      const orConditions: any[] = [];
      if (templateCategory) {
        orConditions.push(
          { templateCategoryId: templateCategory.id },
          { templateCategoryIds: { has: templateCategory.id } }
        );
      }

      const cleanCategory = category.replace(/-spandoek$/, "");
      orConditions.push(
        { occasion: category },
        { occasion: cleanCategory },
        { occasion: { equals: category, mode: "insensitive" } },
        { occasion: { equals: cleanCategory, mode: "insensitive" } }
      );

      if (category.includes("abraham")) {
        orConditions.push(
          { occasion: "50-jaar" },
          { headline: { contains: "Abraham", mode: "insensitive" } }
        );
      }
      if (category.includes("sarah")) {
        orConditions.push(
          { occasion: "50-jaar" },
          { headline: { contains: "Sarah", mode: "insensitive" } }
        );
      }
      if (category.includes("verjaardag") || category.includes("birthday")) {
        orConditions.push(
          { occasion: "verjaardag" },
          { headline: { contains: "verjaardag", mode: "insensitive" } }
        );
      }

      where.OR = orConditions;
    }
  }

  if (subcategory) {
    const cleanSub = subcategory.replace(/-spandoek$/, "").toLowerCase();
    const subcategoryObj = await prisma.templateSubcategory.findFirst({
      where: {
        OR: [
          ...(subcategory.match(/^[0-9a-fA-F]{24}$/) ? [{ id: subcategory }] : []),
          { slug: subcategory },
          { slug: `${subcategory}-spandoek` },
          { slug: cleanSub },
          { slug: `${cleanSub}-spandoek` },
          { slug: { contains: cleanSub, mode: "insensitive" } },
          { name: { contains: cleanSub, mode: "insensitive" } },
        ] as any,
      },
    });
    if (subcategoryObj) {
      where.templateSubcategoryId = subcategoryObj.id;
    } else {
      where.templateSubcategoryId = "non-existent-id";
    }
  }

  if (occasion) {
    where.occasion = occasion;
  }

  if (searchTerm) {
    const searchConditions = [
      { headline: { contains: searchTerm, mode: "insensitive" } },
      { description: { contains: searchTerm, mode: "insensitive" } },
      { occasion: { contains: searchTerm, mode: "insensitive" } },
      { name: { contains: searchTerm, mode: "insensitive" } },
      { sku: { contains: searchTerm, mode: "insensitive" } },
      { slug: { contains: searchTerm, mode: "insensitive" } },
    ];
    if (where.OR) {
      where.AND = [
        { OR: where.OR },
        { OR: searchConditions }
      ];
      delete where.OR;
    } else {
      where.OR = searchConditions;
    }
  }

  const templates = await prisma.banner.findMany({
    skip,
    take: limit,
    where,
    orderBy: {
      createdAt: "desc",
    },
    select: bannerListSelect,
  });

  const total = await prisma.banner.count({ where });
  const templatesWithReviews = await attachReviewSummaries(templates);

  return {
    templates: templatesWithReviews,
    metaData: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

const getTemplateCategories = async () => {
  const categories = await prisma.templateCategory.findMany({
    where: {
      isActive: true,
    },
    include: {
      subcategories: {
        where: {
          isActive: true,
        },
        orderBy: [
          { position: "asc" },
          { createdAt: "desc" },
        ],
      },
    },
    orderBy: [
      { position: "asc" },
      { createdAt: "desc" },
    ],
  });

  return categories;
};

const getTemplateSubcategories = async (query: { templateCategoryId?: string }) => {
  let categoryId = query.templateCategoryId;
  if (categoryId === "skip") {
    return [];
  }

  // If categoryId is passed as a slug (e.g. "zakelijke" or "zakelijk"), resolve to category ID
  if (categoryId && !categoryId.match(/^[0-9a-fA-F]{24}$/)) {
    const cleanCat = categoryId.replace(/-spandoek$/, "").toLowerCase();
    const cat = await prisma.templateCategory.findFirst({
      where: {
        OR: [
          { slug: categoryId },
          { slug: `${categoryId}-spandoek` },
          { slug: cleanCat },
          { slug: { contains: cleanCat, mode: "insensitive" } },
          { name: { contains: cleanCat, mode: "insensitive" } },
        ],
      },
    });
    if (cat) {
      categoryId = cat.id;
    }
  }

  const subcategories = await prisma.templateSubcategory.findMany({
    where: {
      isActive: true,
      ...(categoryId ? { templateCategoryId: categoryId } : {}),
    },
    orderBy: [
      { position: "asc" },
      { createdAt: "desc" },
    ],
  });

  return subcategories;
};

const getTuinposterCategories = async () => {
  const categories = await prisma.tuinposterCategory.findMany({
    where: {
      isActive: true,
    },
    orderBy: [
      { position: "asc" },
      { createdAt: "desc" },
    ],
  });

  return categories;
};

const getTemplateBySlug = async (slug: string) => {
  const isObjectId = /^[0-9a-fA-F]{24}$/.test(slug);
  const template = await prisma.banner.findFirst({
    where: {
      isTemplate: true,
      ...(isObjectId ? { OR: [{ slug }, { id: slug }] } : { slug }),
    },
    include: {
      svgMask: true,
      templateCategory: true,
      templateCategories: true,
      templateSubcategory: {
        include: {
          templateCategory: true,
        },
      },
      tuinposterCategory: true,
      tuinposterCategories: true,
    },
  });

  if (!template) {
    throw new AppError("Template niet gevonden", 404);
  }

  return attachReviewSummary(template);
};

const createBannerFromTemplate = async (req: AuthRequest) => {
  let parsedData = req.body;
  if (
    typeof req.body === "string" ||
    (req.body.data && typeof req.body.data === "string")
  ) {
    parsedData = JSON.parse(req.body.data || req.body);
  }

  const { templateId } = parsedData;
  if (!templateId) {
    throw new AppError("templateId is verplicht", 400);
  }

  const template = await prisma.banner.findUnique({
    where: { id: templateId, isTemplate: true },
  });

  if (!template) {
    throw new AppError("Template niet gevonden", 404);
  }

  const width = Number(parsedData.width);
  const height = Number(parsedData.height);

  if (
    Number.isNaN(width) ||
    Number.isNaN(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new AppError("Ongeldige bannerafmeting.", 400);
  }

  // Sizing validations (no upper limit enforced)

  const pricingSettings = await pricingSettingService.getPricingSetting().catch(() => null);
  const price =
    getProvidedNumber(parsedData.priceInclVat) ??
    getProvidedNumber(parsedData.price) ??
    calculateBannerPriceInclVat(width, height, pricingSettings);

  let imageUrl = template.imageUrl;
  let originalImageUrl = template.originalImageUrl || template.imageUrl;
  if (req.file) {
    const [originalImg, optimizedImg] = await Promise.all([
      uploadFileToS3(req.file, "banner-originals"),
      uploadOptimizedImageToS3(req.file, "images"),
    ]);
    imageUrl = optimizedImg;
    originalImageUrl = originalImg;
  }

  const sizeType = parsedData.sizeType || template.sizeType;
  const sizeLabel = formatLabel(sizeType);

  let bannerHeadline = parsedData.headline || template.headline;
  if (template.tuinposterCategoryId && !bannerHeadline.startsWith("Tuinposter - ")) {
    bannerHeadline = `Tuinposter - ${bannerHeadline}`;
  }
  const slug = await generateUniqueBannerSlug(bannerHeadline);

  let bannerName = parsedData.name || template.name;
  if (template.tuinposterCategoryId && bannerName && !bannerName.startsWith("Tuinposter - ")) {
    bannerName = `Tuinposter - ${bannerName}`;
  }

  const banner = await prisma.banner.create({
    data: {
      userId: req.user?.id || null,
      templateCategoryId: template.templateCategoryId || null,
      templateCategoryIds: template.templateCategoryIds || [],
      tuinposterCategoryId: template.tuinposterCategoryId || null,
      tuinposterCategoryIds: template.tuinposterCategoryIds || [],
      sku: template.sku || null,
      sourceTemplateId: template.id,
      occasion: template.occasion,
      style: template.style,
      headline: bannerHeadline,
      slug,
      name: bannerName,
      description: parsedData.description || template.description,
      hobbies: parsedData.hobbies || template.hobbies || [],
      sizeType,
      sizeLabel,
      width,
      height,
      imageUrl,
      originalImageUrl,
      price,
      variant: 0,
      isTemplate: false,
      isReadymade: template.isReadymade || !!template.tuinposterCategoryId,
      isSelected: true,
      status: "SELECTED",
    },
  });

  return banner;
};

const getGoogleShoppingFeed = async () => {
  const templates = await prisma.banner.findMany({
    where: {
      isTemplate: true,
    },
    select: {
      id: true,
      name: true,
      headline: true,
      description: true,
      price: true,
      imageUrl: true,
      mockupUrl: true,
      slug: true,
      isReadymade: true,
      occasion: true,
      templateCategory: {
        select: {
          name: true,
        },
      },
      templateCategories: {
        select: {
          name: true,
        },
      },
      tuinposterCategory: {
        select: {
          name: true,
        },
      },
      tuinposterCategories: {
        select: {
          name: true,
        },
      },
    },
  });

  const clientUrl = config.client_url || "https://spandoekprint.nl";

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">
  <channel>
    <title>Spandoekprint.nl Products</title>
    <link>${clientUrl}</link>
    <description>Custom Banners and Garden Posters</description>\n`;

  const escapeXml = (str: string) => {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  };

  for (const template of templates) {
    const id = template.id;
    const title = template.name || template.headline || "Ontwerp";
    const description = template.description || title;
    const route = template.isReadymade ? "tuinposter" : "templates";
    const link = `${clientUrl}/${route}/${template.slug || template.id}`;
    const imageLink = template.mockupUrl || template.imageUrl || "";
    // Google Merchant Center requires feed price to match website's initial page load price.
    // Since the website details page always defaults to the 60x40 cm size (which costs 11.95 EUR),
    // we enforce the feed price to be 11.95 EUR to prevent price mismatch suspensions.
    const priceStr = "11.95 EUR";

    const categoryName =
      template.templateCategory?.name ||
      (template.templateCategories && template.templateCategories.length > 0
        ? template.templateCategories.map((c) => c.name).filter(Boolean).join(" > ")
        : "") ||
      template.tuinposterCategory?.name ||
      (template.tuinposterCategories && template.tuinposterCategories.length > 0
        ? template.tuinposterCategories.map((c) => c.name).filter(Boolean).join(" > ")
        : "") ||
      (template.occasion && template.occasion !== "custom" ? template.occasion : "");

    xml += `    <item>
      <g:id>${escapeXml(id)}</g:id>
      <g:title>${escapeXml(title)}</g:title>
      <g:description>${escapeXml(description)}</g:description>
      <g:link>${escapeXml(link)}</g:link>
      <g:image_link>${escapeXml(imageLink)}</g:image_link>
      <g:condition>new</g:condition>
      <g:availability>in_stock</g:availability>
      <g:price>${priceStr}</g:price>`;

    if (categoryName) {
      xml += `\n      <g:product_type>${escapeXml(categoryName)}</g:product_type>`;
    }

    xml += `\n    </item>\n`;
  }

  xml += `  </channel>
</rss>`;

  return xml;
};

const duplicateBanner = async (bannerId: string, req: AuthRequest) => {
  const originalBanner = await prisma.banner.findUnique({
    where: { id: bannerId },
  });

  if (!originalBanner) {
    throw new AppError("Origineel ontwerp niet gevonden", 404);
  }

  const baseName = originalBanner.name || originalBanner.headline || "Naamloos ontwerp";
  const slug = await generateUniqueBannerSlug(baseName);

  const duplicatedBanner = await prisma.banner.create({
    data: {
      userId: req.user?.id || null,
      templateCategoryId: originalBanner.templateCategoryId,
      templateCategoryIds: originalBanner.templateCategoryIds || [],
      tuinposterCategoryId: originalBanner.tuinposterCategoryId,
      tuinposterCategoryIds: originalBanner.tuinposterCategoryIds || [],
      occasion: originalBanner.occasion,
      style: originalBanner.style,
      headline: originalBanner.headline,
      slug,
      name: originalBanner.name ? `${originalBanner.name} (kopie)` : "Naamloos ontwerp (kopie)",
      price: originalBanner.price,
      priceInclVat: originalBanner.priceInclVat,
      priceExclVat: originalBanner.priceExclVat,
      vatAmount: originalBanner.vatAmount,
      vatRate: originalBanner.vatRate,
      areaM2: originalBanner.areaM2,
      pricePerM2: originalBanner.pricePerM2,
      isVatIncluded: originalBanner.isVatIncluded,
      material: originalBanner.material,
      eyeletType: originalBanner.eyeletType,
      hobbies: originalBanner.hobbies || [],
      description: originalBanner.description,
      sizeType: originalBanner.sizeType,
      sizeLabel: originalBanner.sizeLabel,
      width: originalBanner.width,
      height: originalBanner.height,
      imageUrl: originalBanner.imageUrl,
      originalImageUrl: originalBanner.originalImageUrl,
      canvasJSON: originalBanner.canvasJSON,
      variant: originalBanner.variant,
      source: originalBanner.source,
      savedFromEditor: originalBanner.savedFromEditor,
      isSavedDesign: originalBanner.isSavedDesign,
      designStatus: originalBanner.designStatus,
      lifecycleStatus: originalBanner.lifecycleStatus,
      isSelected: originalBanner.isSelected,
      isTemplate: false,
      isReadymade: originalBanner.isReadymade,
      mockupUrl: originalBanner.mockupUrl,
      status: originalBanner.status,
      generationId: originalBanner.generationId,
      sku: originalBanner.sku,
      sourceTemplateId: originalBanner.sourceTemplateId || originalBanner.id,
    },
  });

  return duplicatedBanner;
};

const generateBannerPrintPdf = async (
  bannerId: string,
  options?: { bleedMm?: number; includeCropMarks?: boolean },
) => {
  const banner = await prisma.banner.findUnique({
    where: { id: bannerId },
  });

  if (!banner) {
    throw new AppError("Banner niet gevonden", 404);
  }

  const pdfBuffer = await generateBannerPrintPdfUtil({
    banner: {
      id: banner.id,
      headline: banner.headline,
      name: banner.name,
      width: banner.width,
      height: banner.height,
      imageUrl: banner.imageUrl,
      originalImageUrl: banner.originalImageUrl,
      material: banner.material,
      eyeletType: banner.eyeletType,
      orderId: banner.orderId,
      designNumber: banner.designNumber,
    },
    bleedMm: options?.bleedMm,
    includeCropMarks: options?.includeCropMarks,
  });

  const safeHeadline = (banner.headline || banner.name || "spandoek")
    .replace(/[^a-zA-Z0-9-_\s]/g, "")
    .trim()
    .replace(/\s+/g, "-");

  const filename = `Drukbestand-${safeHeadline}-${banner.width}x${banner.height}cm.pdf`;

  return { pdfBuffer, filename };
};

export const bannerService = {
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
  getGoogleShoppingFeed,
  generateBannerPrintPdf,
};
