import { AppError } from "../../error/AppError";
import { prisma } from "../../lib/prisma";
import path from "path";
import config from "../../../config";
import { orderUserSearchableFields } from "./admin.contain";
import httpStatus from "http-status";
import { cancledOrder } from "../order/order.service";
import { orderRefundedTemplate } from "../../utils/emailTemplates/orderRefunded";
import { orderReadyTemplate } from "../../utils/emailTemplates/orderReadyTemplate";
import { orderShippedTemplate } from "../../utils/emailTemplates/orderShipped";
import { stat } from "fs";
import { uploadImageToS3, uploadBufferToS3, uploadOptimizedImageToS3 } from "../../utils/uploadAws";
import { getS3KeyFromUrl } from "../../utils/getS3KeyFromUrl";
import { deleteImageFromS3 } from "../../utils/deleteImageFromS3";
import { generateGardenMockup } from "../../utils/generateMockup";
import { generateAllMockups } from "../../utils/generateAllMockups";
import { generateBusinessMockups } from "../../utils/generateBusinessMockups";
import { optimizeImage } from "../../utils/optimizeImage";
import axios from "axios";
import { generateUniqueBannerSlug } from "../banner/banner.service";
import { processCanvasJsonImages } from "../../utils/processCanvasJson";
import { QlsCarrierCode, shippingService } from "../shipping/shipping.service";
import { sendDeliveredOrderReviewEmail } from "../../utils/orderReview";
import { formatLabel } from "../../utils/formatLable";
import { webwinkelkeurService } from "../webwinkelkeur/webwinkelkeur.service";
import { formatAmsterdamDateTime } from "../../utils/deliveryCalculator";
import { assertNoDummyContent } from "../../utils/contentValidator";
import {
  AMSTERDAM_TIMEZONE,
  getAmsterdamComponents,
  getAmsterdamMidnight,
  getAmsterdamEndOfDay,
  getAmsterdamDaysAgoMidnight,
  getAmsterdamHourLabel,
  getAmsterdamDayWeekdayLabel,
  getAmsterdamDayMonthLabel,
  getAmsterdamMonthLabel,
  getAmsterdamMonthYearLabel,
  ALL_DUTCH_MONTHS,
} from "../../utils/amsterdamTime";

const bannerListSelect = {
  id: true,
  userId: true,
  templateCategoryId: true,
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
  slug: true,
  name: true,
  price: true,
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

const generateUniqueTemplateCategorySlug = async (
  name: string,
  currentId?: string,
): Promise<string> => {
  const baseSlug = generateSlug(name || "category");
  let slug = baseSlug;
  let counter = 1;

  while (true) {
    const isExist = await prisma.templateCategory.findFirst({
      where: {
        slug,
        ...(currentId ? { id: { not: currentId } } : {}),
      },
    });

    if (!isExist) {
      return slug;
    }

    slug = `${baseSlug}-${counter}`;
    counter++;
  }
};

const generateSlug = (value: string) => {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

type IOrderStatus =
  | "pending"
  | "processing"
  | "ready"
  | "shipped"
  | "refunded"
  | "delivered"
  | "cancelled";

type ManageOrderOptions = {
  carrier?: QlsCarrierCode;
  productCombinationId?: number;
};

const totalOrder = async (
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

  const validOrderFields = new Set([
    "id",
    "status",
    "paymentStatus",
    "userId",
    "bannerId",
    "deliveryType",
    "deliveryMethod",
    "isGuest",
    "trackingNumber",
  ]);

  for (const key of Object.keys(cleanFilter)) {
    if (
      !validOrderFields.has(key) ||
      cleanFilter[key] === "" ||
      cleanFilter[key] === "all" ||
      cleanFilter[key] === undefined ||
      cleanFilter[key] === null
    ) {
      delete cleanFilter[key];
    }
  }

  const validSortFields = new Set([
    "createdAt",
    "updatedAt",
    "total",
    "status",
    "paymentStatus",
    "quantity",
  ]);
  const safeSortBy = validSortFields.has(sortBy) ? sortBy : "createdAt";

  const andConditions: any[] = [];

  if (Object.keys(cleanFilter).length > 0) {
    andConditions.push(cleanFilter);
  }

  if (searchTerm && searchTerm.trim()) {
    const term = searchTerm.trim();
    const cleanTerm = term.replace(/^#/, "").trim();
    const isObjectId = /^[a-fA-F0-9]{24}$/.test(term);

    const [matchedUsers, matchedAddresses, matchedBanners] = await Promise.all([
      prisma.user.findMany({
        where: {
          OR: [
            { name: { contains: term, mode: "insensitive" } },
            { email: { contains: term, mode: "insensitive" } },
            { phone: { contains: term, mode: "insensitive" } },
          ],
        },
        select: { id: true },
      }),
      prisma.address.findMany({
        where: {
          OR: [
            { name: { contains: term, mode: "insensitive" } },
            { email: { contains: term, mode: "insensitive" } },
            { phone: { contains: term, mode: "insensitive" } },
            { companyName: { contains: term, mode: "insensitive" } },
            { street: { contains: term, mode: "insensitive" } },
            { city: { contains: term, mode: "insensitive" } },
            { zipCode: { contains: term, mode: "insensitive" } },
          ],
        },
        select: { orderId: true },
      }),
      prisma.banner.findMany({
        where: {
          OR: [
            { headline: { contains: term, mode: "insensitive" } },
            { occasion: { contains: term, mode: "insensitive" } },
            { name: { contains: term, mode: "insensitive" } },
            { description: { contains: term, mode: "insensitive" } },
            { style: { contains: term, mode: "insensitive" } },
            { sku: { contains: term, mode: "insensitive" } },
            { slug: { contains: term, mode: "insensitive" } },
            { designNumber: { contains: term, mode: "insensitive" } },
          ],
        },
        select: { id: true },
      }),
    ]);

    const userIds = matchedUsers.map((u) => u.id);
    const addressOrderIds = matchedAddresses
      .map((a) => a.orderId)
      .filter((id): id is string => Boolean(id));
    const bannerIds = matchedBanners.map((b) => b.id);

    const orConditions: any[] = [
      { trackingNumber: { contains: term, mode: "insensitive" } },
      { guestName: { contains: term, mode: "insensitive" } },
      { guestEmail: { contains: term, mode: "insensitive" } },
      { guestPhone: { contains: term, mode: "insensitive" } },
    ];

    if (cleanTerm && cleanTerm !== term) {
      orConditions.push({
        trackingNumber: { contains: cleanTerm, mode: "insensitive" },
      });
    }

    if (isObjectId) {
      orConditions.push(
        { id: term },
        { userId: term },
        { bannerId: term },
      );
    }

    if (addressOrderIds.length > 0) {
      orConditions.push({
        id: { in: addressOrderIds },
      });
    }

    if (userIds.length > 0) {
      orConditions.push({
        userId: { in: userIds },
      });
    }

    if (bannerIds.length > 0) {
      orConditions.push(
        { bannerId: { in: bannerIds } },
        { items: { some: { bannerId: { in: bannerIds } } } },
      );
    }

    andConditions.push({
      OR: orConditions,
    });
  }

  const where =
    andConditions.length > 0
      ? { AND: [...andConditions] }
      : {};

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where: where,
      include: {
        banner: {
          select: {
            id: true,
            occasion: true,
            style: true,
            name: true,
            price: true,
            imageUrl: true,
            variant: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        payment: true,
        addresses: true,
        invoice: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            image: true,
          },
        },
      },
      orderBy: {
        [safeSortBy]: sortOrder || "desc",
      },
      take: limit,
      skip,
    }),
    prisma.order.count({ where }),
  ]);

  return {
    orders,
    metaData: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

const getOrderStatusSummary = async () => {
  const [
    totalOrders,
    pending,
    processing,
    ready,
    shipped,
    delivered,
    cancelled,
    refunded,
  ] = await Promise.all([
    prisma.order.count(),
    prisma.order.count({ where: { status: "pending" } }),
    prisma.order.count({ where: { status: "processing" } }),
    prisma.order.count({ where: { status: "ready" } }),
    prisma.order.count({ where: { status: "shipped" } }),
    prisma.order.count({ where: { status: "delivered" } }),
    prisma.order.count({ where: { status: "cancelled" } }),
    prisma.order.count({ where: { status: "refunded" } }),
  ]);

  return {
    totalOrders,
    pending,
    processing,
    ready,
    shipped,
    delivered,
    cancelled,
    refunded,
    byStatus: {
      pending,
      processing,
      ready,
      shipped,
      delivered,
      cancelled,
      refunded,
    },
  };
};

const manageOrder = async (
  orderId: string,
  status: IOrderStatus,
  options: ManageOrderOptions = {},
) => {
  const payemt = await prisma.payment.findUnique({
    where: {
      orderId,
    },
  });

  const order = await prisma.order.findUnique({
    where: {
      id: orderId,
    },
    include: {
      user: true,
      banner: true,
      addresses: true,
    },
  });

  if (!order) {
    throw new AppError("Bestelling niet gevonden", httpStatus.NOT_FOUND);
  }
  const customerName =
    order.user?.name || order.guestName || order.addresses?.name || "Customer";
  const customerEmail =
    order.user?.email || order.guestEmail || order.addresses?.email;

  if (!customerEmail) {
    throw new AppError("E-mailadres niet gevonden", httpStatus.BAD_REQUEST);
  }

  const displayOrderNumber = (order.trackingNumber || orderId) as string;

  const data = {
    orderNumber: displayOrderNumber,

    deliveredDate: formatAmsterdamDateTime(order?.createdAt),

    items: [
      {
        name: (order?.banner?.name || (order?.banner?.occasion ? `${formatLabel(order.banner.occasion)} Banner` : "Banner")) as string,
        quantity: order?.quantity as number,
        price: order?.banner?.price as number,
        image: order?.banner?.imageUrl as string,
      },
    ],

    totalAmount: order?.total as number,

    deliveryAddress: `${order?.addresses?.houseNumber || ""} ${
      order?.addresses?.street || ""
    } ${order?.addresses?.city || ""}, ${order?.addresses?.zipCode || ""}`,

    reviewLink: "", // optional
  };

  const refundedData = {
    orderNumber: displayOrderNumber,

    refundDate: formatAmsterdamDateTime(new Date()), // বা backend থেকে refund date

    refundAmount: order?.total as number, // বা partial হলে change করবা

    refundMethod: "Mollie", // dynamic হলে payment method use করো

    refundReason: "Order cancelled", // optional (dynamic দিতে পারো)

    items: [
      {
        name: (order?.banner?.name || (order?.banner?.occasion ? `${formatLabel(order.banner.occasion)} Banner` : "Banner")) as string,
        quantity: order?.quantity as number,
        price: order?.banner?.price as number,
        image: order?.banner?.imageUrl as string,
      },
    ],

    estimatedArrival: "", // optional (refund case-এ usually empty)

    supportLink: `${config.client_url}/contact`, // optional
  };

  const orderReadyData = {
    orderNumber: displayOrderNumber,
    readyDate: formatAmsterdamDateTime(order?.updatedAt),
    pickupAddress: order?.addresses?.address
      ? order?.addresses?.address
      : `${order?.addresses?.houseNumber || ""} ${order?.addresses?.street || ""} ${order?.addresses?.city || ""}, ${order?.addresses?.zipCode || ""}`,
    items: [
      {
        name: (order?.banner?.name || (order?.banner?.occasion ? `${formatLabel(order.banner.occasion)} Banner` : "Banner")) as string,
        quantity: order?.quantity as number,
        price: order?.banner?.price as number,
        image: order?.banner?.imageUrl as string, // ⚠️ imageUrl → image
      },
    ],
    totalAmount: order?.total as number,
    paymentMethod: "Mollie",
    deliveryAddress: `${order?.addresses?.houseNumber || ""} ${
      order?.addresses?.street || ""
    } ${order?.addresses?.city || ""}, ${order?.addresses?.zipCode || ""}`,

    trackingLink: "",
    supportLink: `${config.client_url}/contact`,
  };

  if (status === "ready") {
    if (payemt?.status !== "paid") {
      throw new AppError(
        "Alleen betaalde bestellingen kunnen worden bijgewerkt",
        httpStatus.BAD_REQUEST,
      );
    }

    if (order.status !== "processing") {
      throw new AppError(
        "Alleen bestellingen met status 'processing' kunnen klaar worden gezet voor levering",
        httpStatus.BAD_REQUEST,
      );
    }
    await prisma.order.update({
      where: {
        id: orderId,
      },
      data: {
        status: "ready",
      },
    });

    // For delivery orders: notify customer the order is being prepared for shipment.
    // For pickup orders: skip this email — the "klaar voor afhalen" notification is sent
    // when the admin sets status to "shipped" (handled in the shipped branch below).
    if (order.deliveryMethod !== "pickup") {
      await orderReadyTemplate(
        customerName,
        customerEmail,
        "Bestelling klaar voor levering",
        {
          ...orderReadyData,
          isPickup: false,
        },
      );
    }
  } else if (status === "delivered") {
    if (payemt?.status !== "paid") {
      throw new AppError(
        "Alleen betaalde bestellingen kunnen worden bijgewerkt",
        httpStatus.BAD_REQUEST,
      );
    }
    if (order.status !== "shipped") {
      throw new AppError(
        "Alleen bestellingen met status 'shipped' kunnen als geleverd worden gemarkeerd",
        httpStatus.BAD_REQUEST,
      );
    }
    await prisma.order.update({
      where: {
        id: orderId,
      },
      data: {
        status: "delivered",
      },
    });

    await sendDeliveredOrderReviewEmail(orderId);
    await webwinkelkeurService.sendReviewInvitation(order);
  } else if (status === "cancelled") {
    await cancledOrder(orderId, "Bestelling geannuleerd door beheerder");
  } else if (status === "refunded") {
    if (payemt?.status !== "paid") {
      throw new AppError(
        "Alleen betaalde bestellingen kunnen worden bijgewerkt",
        httpStatus.BAD_REQUEST,
      );
    }

    await prisma.order.update({
      where: {
        id: orderId,
      },
      data: {
        status: "refunded",
      },
    });
    await orderRefundedTemplate(
      customerName,
      customerEmail,
      "Bestelling terugbetaald",
      refundedData,
    );
  } else if (status === "shipped") {
    if (order.status !== "ready") {
      throw new AppError(
        "Alleen bestellingen met status 'ready' kunnen op 'shipped' worden gezet",
      );
    }

    if (order.deliveryMethod === "delivery" && !options.carrier) {
      throw new AppError(
        "Selecteer een vervoerder voordat u de bestelling verzendt",
        httpStatus.BAD_REQUEST,
      );
    }

    const shipment =
      order.deliveryMethod === "delivery"
        ? await shippingService.createShipment({
            orderId,
            carrier: options.carrier,
            productCombinationId: options.productCombinationId,
          })
        : null;

    await prisma.order.update({
      where: {
        id: orderId,
      },
      data: {
        status: "shipped",
      },
    });
    const shippedData = {
      orderNumber: displayOrderNumber,
      shippedDate: formatAmsterdamDateTime(new Date()),
      estimatedDelivery: order?.deliveryTime as string,
      courierName: shipment
        ? shippingService.getCarrierLabel(options.carrier)
        : "Afhalen",
      trackingNumber:
        shipment?.trackingId ||
        shipment?.barcode ||
        (order?.trackingNumber as string),
      trackingLink:
        shipment?.trackingUrl || `${config.client_url}/profile/${orderId}`,

      items: [
        {
          name: (order?.banner?.name || (order?.banner?.occasion ? `${formatLabel(order.banner.occasion)} Banner` : "Banner")) as string,
          quantity: order?.quantity as number,
          price: order?.banner?.price as number,
          image: order?.banner?.imageUrl as string, // ⚠️ imageUrl → image
        },
      ],
      totalAmount: order?.total as number,
      deliveryAddress: `${order?.addresses?.houseNumber || ""}, ${
        order?.addresses?.street || ""
      }, ${order?.addresses?.city || ""}, ${order?.addresses?.zipCode || ""}`,
      supportLink: `${config.client_url}/contact`, // optional
    };

    if (order.deliveryMethod === "pickup") {
      await orderReadyTemplate(
        customerName,
        customerEmail,
        "Bestelling klaar voor afhalen",
        {
          ...orderReadyData,
          isPickup: true,
        },
      );
    } else {
      await orderShippedTemplate(
        customerName,
        customerEmail,
        "Bestelling verzonden",
        shippedData,
      );
    }
  }
  return order;
};

const manageUsers = async (
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

  for (const key of Object.keys(cleanFilter)) {
    if (
      cleanFilter[key] === "" ||
      cleanFilter[key] === "all" ||
      cleanFilter[key] === undefined ||
      cleanFilter[key] === null
    ) {
      delete cleanFilter[key];
    }
  }

  const andConditions: any[] = [{ role: "user" }];

  if (Object.keys(cleanFilter).length > 0) {
    andConditions.push(cleanFilter);
  }

  if (searchTerm) {
    const search = orderUserSearchableFields.map((field) => ({
      [field]: {
        contains: searchTerm,
        mode: "insensitive",
      },
    }));

    andConditions.push({
      OR: search,
    });
  }

  const where = { AND: andConditions };

  const users = await prisma.user.findMany({
    where,
    select: {
      id: true,
      name: true,
      email: true,
      status: true,
      phone: true,
      role: true,
      image: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: {
      [sortBy]: sortOrder,
    },
    take: limit,
    skip,
  });

  const total = await prisma.user.count({ where });

  return {
    users,
    metaData: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

const updateUserStatus = async (
  userId: string,
  status: "active" | "inactive" | "blocked",
) => {
  const user = await prisma.user.update({
    where: {
      id: userId,
    },
    data: {
      status,
    },
    select: {
      id: true,
      name: true,
      email: true,
      status: true,
      phone: true,
      role: true,
      image: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return user;
};

const dashboardStats = async (
  range?: string,
  startDate?: string,
  endDate?: string,
) => {
  const now = new Date();
  const dateFilter: any = {};

  if (startDate || endDate || range === "custom") {
    if (startDate) {
      dateFilter.gte = getAmsterdamMidnight(startDate);
    }
    if (endDate) {
      dateFilter.lte = getAmsterdamEndOfDay(endDate);
    }
  } else if (range === "today") {
    dateFilter.gte = getAmsterdamMidnight();
  } else if (range === "7d") {
    dateFilter.gte = getAmsterdamDaysAgoMidnight(6);
  } else if (range === "30d") {
    dateFilter.gte = getAmsterdamDaysAgoMidnight(29);
  }

  const hasDateFilter = Boolean(dateFilter.gte || dateFilter.lte);

  // Revenue is counted immediately upon payment, excluding cancelled and refunded orders
  const paidOrderCondition = {
    paymentStatus: "paid" as const,
    status: { notIn: ["cancelled" as const, "refunded" as const] },
  };

  const totalUsers = await prisma.user.count({
    where: hasDateFilter ? { createdAt: dateFilter } : {},
  });
  const totalActiveUsers = await prisma.user.count({
    where: {
      status: "active",
      ...(hasDateFilter ? { createdAt: dateFilter } : {}),
    },
  });

  const totalOrders = await prisma.order.count({
    where: hasDateFilter ? { createdAt: dateFilter } : {},
  });
  const totalDeliveredOrders = await prisma.order.count({
    where: {
      status: "delivered",
      ...(hasDateFilter ? { createdAt: dateFilter } : {}),
    },
  });
  const totalProcessingOrders = await prisma.order.count({
    where: {
      status: "processing",
      ...(hasDateFilter ? { createdAt: dateFilter } : {}),
    },
  });
  const totalCancelledOrders = await prisma.order.count({
    where: {
      status: "cancelled",
      ...(hasDateFilter ? { createdAt: dateFilter } : {}),
    },
  });
  const totalPendingOrders = await prisma.order.count({
    where: {
      status: "pending",
      ...(hasDateFilter ? { createdAt: dateFilter } : {}),
    },
  });
  const totalReadyOrders = await prisma.order.count({
    where: {
      status: "ready",
      ...(hasDateFilter ? { createdAt: dateFilter } : {}),
    },
  });
  const totalShippedOrders = await prisma.order.count({
    where: {
      status: "shipped",
      ...(hasDateFilter ? { createdAt: dateFilter } : {}),
    },
  });
  const totalRefundedOrders = await prisma.order.count({
    where: {
      status: "refunded",
      ...(hasDateFilter ? { createdAt: dateFilter } : {}),
    },
  });

  const totalRevenueData = await prisma.order.aggregate({
    _sum: {
      total: true,
    },
    where: {
      ...paidOrderCondition,
      ...(hasDateFilter ? { createdAt: dateFilter } : {}),
    },
  });

  const totalDeliveredRevenue = Math.round((totalRevenueData._sum.total || 0) * 100) / 100;
  const totalCancelledRevenueData = await prisma.order.aggregate({
    _sum: {
      total: true,
    },
    where: {
      status: "cancelled",
      ...(hasDateFilter ? { createdAt: dateFilter } : {}),
    },
  });
  const totalCancelledRevenue = Math.round((totalCancelledRevenueData._sum.total || 0) * 100) / 100;

  const totalRefundedRevenueData = await prisma.order.aggregate({
    _sum: {
      total: true,
    },
    where: {
      status: "refunded",
      ...(hasDateFilter ? { createdAt: dateFilter } : {}),
    },
  });
  const totalRefundedRevenue = Math.round((totalRefundedRevenueData._sum.total || 0) * 100) / 100;

  // Sales trend logic depending on range
  let salesTrend: { month: string; revenue: number }[] = [];
  const dutchMonths = ["Jan", "Feb", "Mrt", "Apr", "Mei", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dec"];

  if (range === "today") {
    const startOfToday = getAmsterdamMidnight();

    const todayOrders = await prisma.order.findMany({
      where: {
        ...paidOrderCondition,
        createdAt: { gte: startOfToday },
      },
      select: {
        total: true,
        createdAt: true,
      },
    });

    const salesTrendMap: Record<string, number> = {};
    for (let i = 0; i < 24; i++) {
      const hourStr = `${String(i).padStart(2, "0")}:00`;
      salesTrendMap[hourStr] = 0;
    }

    todayOrders.forEach((order) => {
      const hourStr = getAmsterdamHourLabel(order.createdAt);
      if (salesTrendMap[hourStr] !== undefined) {
        salesTrendMap[hourStr] += order.total || 0;
      }
    });

    salesTrend = Object.entries(salesTrendMap).map(([label, revenue]) => ({
      month: label,
      revenue: Math.round(revenue * 100) / 100,
    }));
  } else if (range === "7d") {
    const sevenDaysAgo = getAmsterdamDaysAgoMidnight(6);

    const last7DaysOrders = await prisma.order.findMany({
      where: {
        ...paidOrderCondition,
        createdAt: { gte: sevenDaysAgo },
      },
      select: {
        total: true,
        createdAt: true,
      },
    });

    const salesTrendMap: Record<string, number> = {};
    const orderedLabels: string[] = [];

    for (let i = 6; i >= 0; i--) {
      const d = getAmsterdamDaysAgoMidnight(i);
      const label = getAmsterdamDayWeekdayLabel(d);
      salesTrendMap[label] = 0;
      orderedLabels.push(label);
    }

    last7DaysOrders.forEach((order) => {
      const label = getAmsterdamDayWeekdayLabel(order.createdAt);
      if (salesTrendMap[label] !== undefined) {
        salesTrendMap[label] += order.total || 0;
      }
    });

    salesTrend = orderedLabels.map((label) => ({
      month: label,
      revenue: Math.round(salesTrendMap[label] * 100) / 100,
    }));
  } else if (range === "30d") {
    const thirtyDaysAgo = getAmsterdamDaysAgoMidnight(29);

    const last30DaysOrders = await prisma.order.findMany({
      where: {
        ...paidOrderCondition,
        createdAt: { gte: thirtyDaysAgo },
      },
      select: {
        total: true,
        createdAt: true,
      },
    });

    const salesTrendMap: Record<string, number> = {};
    const orderedLabels: string[] = [];

    for (let i = 29; i >= 0; i--) {
      const d = getAmsterdamDaysAgoMidnight(i);
      const label = getAmsterdamDayMonthLabel(d);
      salesTrendMap[label] = 0;
      orderedLabels.push(label);
    }

    last30DaysOrders.forEach((order) => {
      const label = getAmsterdamDayMonthLabel(order.createdAt);
      if (salesTrendMap[label] !== undefined) {
        salesTrendMap[label] += order.total || 0;
      }
    });

    salesTrend = orderedLabels.map((label) => ({
      month: label,
      revenue: Math.round(salesTrendMap[label] * 100) / 100,
    }));
  } else if (range === "custom" || (startDate && endDate)) {
    const start = dateFilter.gte || (startDate ? getAmsterdamMidnight(startDate) : getAmsterdamMidnight());
    const end = dateFilter.lte || (endDate ? getAmsterdamEndOfDay(endDate) : getAmsterdamEndOfDay());

    const customOrders = await prisma.order.findMany({
      where: {
        ...paidOrderCondition,
        createdAt: {
          gte: start,
          lte: end,
        },
      },
      select: {
        total: true,
        createdAt: true,
      },
    });

    const diffDays = Math.ceil(Math.abs(end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const salesTrendMap: Record<string, number> = {};
    const orderedLabels: string[] = [];

    if (diffDays <= 62) {
      // Day-by-day points
      let cur = new Date(start);
      while (cur <= end) {
        const label = getAmsterdamDayMonthLabel(cur);
        if (!orderedLabels.includes(label)) {
          orderedLabels.push(label);
          salesTrendMap[label] = 0;
        }
        cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
      }

      customOrders.forEach((order) => {
        const label = getAmsterdamDayMonthLabel(order.createdAt);
        if (salesTrendMap[label] !== undefined) {
          salesTrendMap[label] += order.total || 0;
        }
      });
    } else {
      // Month-by-month points
      const startParts = getAmsterdamComponents(start);
      const endParts = getAmsterdamComponents(end);
      let y = startParts.year;
      let m = startParts.month;
      while (y < endParts.year || (y === endParts.year && m <= endParts.month)) {
        const mLabel = `${ALL_DUTCH_MONTHS[m - 1]} ${y}`;
        orderedLabels.push(mLabel);
        salesTrendMap[mLabel] = 0;
        m++;
        if (m > 12) {
          m = 1;
          y++;
        }
      }

      customOrders.forEach((order) => {
        const label = getAmsterdamMonthYearLabel(order.createdAt);
        if (salesTrendMap[label] !== undefined) {
          salesTrendMap[label] += order.total || 0;
        }
      });
    }

    salesTrend = orderedLabels.map((label) => ({
      month: label,
      revenue: Math.round(salesTrendMap[label] * 100) / 100,
    }));
  } else {
    // Monthly Sales trend for last 6 months (All-time or default in Amsterdam timezone)
    const currentAms = getAmsterdamComponents();
    const orderedMonthKeys: { monthNum: number; year: number; label: string }[] = [];
    const salesTrendMap: Record<string, number> = {};

    for (let i = 5; i >= 0; i--) {
      let m = currentAms.month - i;
      let y = currentAms.year;
      while (m < 1) {
        m += 12;
        y -= 1;
      }
      const label = ALL_DUTCH_MONTHS[m - 1];
      orderedMonthKeys.push({ monthNum: m, year: y, label });
      salesTrendMap[label] = 0;
    }

    const oldestBucket = orderedMonthKeys[0];
    const sixMonthsAgoStart = getAmsterdamMidnight(new Date(Date.UTC(oldestBucket.year, oldestBucket.monthNum - 1, 1)));

    const monthlyOrders = await prisma.order.findMany({
      where: {
        ...paidOrderCondition,
        createdAt: {
          gte: sixMonthsAgoStart,
        },
      },
      select: {
        total: true,
        createdAt: true,
      },
    });

    monthlyOrders.forEach((order) => {
      const monthLabel = getAmsterdamMonthLabel(order.createdAt);
      if (salesTrendMap[monthLabel] !== undefined) {
        salesTrendMap[monthLabel] += order.total || 0;
      }
    });

    salesTrend = orderedMonthKeys.map(({ label }) => ({
      month: label,
      revenue: Math.round(salesTrendMap[label] * 100) / 100,
    }));
  }

  // Trends calculation (Month-over-Month in Amsterdam timezone)
  const nowAms = getAmsterdamComponents();
  const startOfCurrentMonth = getAmsterdamMidnight(new Date(Date.UTC(nowAms.year, nowAms.month - 1, 1)));

  let lastMonthNum = nowAms.month - 1;
  let lastMonthYear = nowAms.year;
  if (lastMonthNum < 1) {
    lastMonthNum = 12;
    lastMonthYear -= 1;
  }
  const startOfLastMonth = getAmsterdamMidnight(new Date(Date.UTC(lastMonthYear, lastMonthNum - 1, 1)));
  const endOfLastMonth = new Date(startOfCurrentMonth.getTime() - 1);

  // Revenue MoM
  const currentMonthRevenueData = await prisma.order.aggregate({
    _sum: { total: true },
    where: {
      ...paidOrderCondition,
      createdAt: { gte: startOfCurrentMonth },
    },
  });
  const currentMonthRevenue = currentMonthRevenueData._sum.total || 0;

  const lastMonthRevenueData = await prisma.order.aggregate({
    _sum: { total: true },
    where: {
      ...paidOrderCondition,
      createdAt: {
        gte: startOfLastMonth,
        lte: endOfLastMonth,
      },
    },
  });
  const lastMonthRevenue = lastMonthRevenueData._sum.total || 0;

  // Orders MoM
  const currentMonthOrders = await prisma.order.count({
    where: { createdAt: { gte: startOfCurrentMonth } },
  });
  const lastMonthOrders = await prisma.order.count({
    where: {
      createdAt: {
        gte: startOfLastMonth,
        lte: endOfLastMonth,
      },
    },
  });

  // Users MoM
  const currentMonthUsers = await prisma.user.count({
    where: { createdAt: { gte: startOfCurrentMonth } },
  });
  const lastMonthUsers = await prisma.user.count({
    where: {
      createdAt: {
        gte: startOfLastMonth,
        lte: endOfLastMonth,
      },
    },
  });

  const getPercentageChange = (current: number, previous: number) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 100);
  };

  const revenueTrendVal = getPercentageChange(currentMonthRevenue, lastMonthRevenue);
  const ordersTrendVal = getPercentageChange(currentMonthOrders, lastMonthOrders);
  const usersTrendVal = getPercentageChange(currentMonthUsers, lastMonthUsers);

  // Recent 5 Orders
  const recentOrders = await prisma.order.findMany({
    take: 5,
    orderBy: {
      createdAt: "desc",
    },
    include: {
      user: {
        select: {
          name: true,
          email: true,
        },
      },
    },
  });

  // Recent 5 Users
  const recentUsers = await prisma.user.findMany({
    take: 5,
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      name: true,
      email: true,
      status: true,
      createdAt: true,
    },
  });

  const totalUndeliveredOrders = totalPendingOrders + totalProcessingOrders + totalReadyOrders + totalShippedOrders;

  const totalUndeliveredRevenueData = await prisma.order.aggregate({
    _sum: {
      total: true,
    },
    where: {
      status: {
        in: ["pending", "processing", "ready", "shipped"],
      },
      ...(hasDateFilter ? { createdAt: dateFilter } : {}),
    },
  });
  const totalUndeliveredRevenue = Math.round((totalUndeliveredRevenueData._sum.total || 0) * 100) / 100;

  // Fetch order items to aggregate top selling designs and material breakdown
  const orderItems = await prisma.orderItem.findMany({
    where: {
      ...(hasDateFilter ? { createdAt: dateFilter } : {}),
      order: paidOrderCondition,
    },
    select: {
      quantity: true,
      price: true,
      hasEyelets: true,
      banner: {
        select: {
          id: true,
          headline: true,
          imageUrl: true,
          isTemplate: true,
          isReadymade: true,
          sourceTemplateId: true,
          price: true,
          material: true,
          width: true,
          height: true,
        },
      },
    },
  });

  const salesMap: Record<
    string,
    {
      id: string;
      headline: string;
      imageUrl: string;
      price: number;
      salesCount: number;
      revenue: number;
    }
  > = {};

  const materialBreakdown = { pvc: 0, mesh: 0 };
  const sizeMap: Record<string, number> = {};
  let eyeletsCount = 0;
  let noEyeletsCount = 0;

  orderItems.forEach((item) => {
    if (!item.banner) return;

    // Material breakdown
    if (item.banner.material) {
      const mat = item.banner.material.toLowerCase();
      if (mat.includes("pvc")) {
        materialBreakdown.pvc += item.quantity || 0;
      } else if (mat.includes("mesh")) {
        materialBreakdown.mesh += item.quantity || 0;
      }
    }

    // Eyelets breakdown
    if (item.hasEyelets) {
      eyeletsCount += item.quantity || 0;
    } else {
      noEyeletsCount += item.quantity || 0;
    }

    // Size breakdown
    if (item.banner.width && item.banner.height) {
      const sizeKey = `${item.banner.width}x${item.banner.height} cm`;
      sizeMap[sizeKey] = (sizeMap[sizeKey] || 0) + (item.quantity || 0);
    }

    // Top selling designs aggregation
    const designId = item.banner.sourceTemplateId || item.banner.id;
    const headline = item.banner.headline || "Custom Ontwerp";

    if (!salesMap[designId]) {
      salesMap[designId] = {
        id: designId,
        headline,
        imageUrl: item.banner.imageUrl || "",
        price: item.banner.price || 0,
        salesCount: 0,
        revenue: 0,
      };
    }

    salesMap[designId].salesCount += item.quantity || 0;
    salesMap[designId].revenue += (item.price || 0) * (item.quantity || 0);
  });

  const topSellingDesigns = Object.values(salesMap)
    .sort((a, b) => b.salesCount - a.salesCount)
    .slice(0, 5)
    .map(d => ({
      ...d,
      revenue: Math.round(d.revenue * 100) / 100,
    }));

  const popularSizes = Object.entries(sizeMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([size, count]) => ({ size, count }));

  const totalPaidOrders = await prisma.order.count({
    where: {
      ...paidOrderCondition,
      ...(hasDateFilter ? { createdAt: dateFilter } : {}),
    },
  });

  const averageOrderValue = totalPaidOrders > 0
    ? Math.round((totalDeliveredRevenue / totalPaidOrders) * 100) / 100
    : 0;

  const eyeletsBreakdown = {
    withEyelets: eyeletsCount,
    withoutEyelets: noEyeletsCount,
    percentage: eyeletsCount + noEyeletsCount > 0
      ? Math.round((eyeletsCount / (eyeletsCount + noEyeletsCount)) * 100)
      : 0
  };

  return {
    totalUsers,
    totalActiveUsers,
    totalOrders,
    totalUndeliveredOrders,
    totalUndeliveredRevenue,
    totalDeliveredOrders,
    totalProcessingOrders,
    totalCancelledOrders,
    totalPendingOrders,
    totalReadyOrders,
    totalShippedOrders,
    totalRefundedOrders,
    totalPaidOrders,
    totalDeliveredRevenue,
    totalPaidRevenue: totalDeliveredRevenue,
    totalCancelledRevenue,
    totalRefundedRevenue,
    salesTrend,
    recentOrders,
    recentUsers,
    topSellingDesigns,
    materialBreakdown,
    popularSizes,
    averageOrderValue,
    eyeletsBreakdown,
    trends: {
      revenue: { value: Math.abs(revenueTrendVal), isUp: revenueTrendVal >= 0 },
      orders: { value: Math.abs(ordersTrendVal), isUp: ordersTrendVal >= 0 },
      users: { value: Math.abs(usersTrendVal), isUp: usersTrendVal >= 0 },
    },
  };
};

const totalTransaction = async (
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

  for (const key of Object.keys(cleanFilter)) {
    if (
      cleanFilter[key] === "" ||
      cleanFilter[key] === "all" ||
      cleanFilter[key] === undefined ||
      cleanFilter[key] === null
    ) {
      delete cleanFilter[key];
    }
  }

  const andConditions: any[] = [];

  if (cleanFilter.status) {
    if (
      cleanFilter.status === "unpaid" ||
      cleanFilter.status === "failed_pending" ||
      cleanFilter.status === "failed_or_pending"
    ) {
      delete cleanFilter.status;
      andConditions.push({
        status: { in: ["pending", "failed", "expired", "cancelled"] },
      });
    }
  }

  if (Object.keys(cleanFilter).length > 0) {
    andConditions.push(cleanFilter);
  }

  if (searchTerm) {
    andConditions.push({
      OR: [
        {
          transactionId: {
            contains: searchTerm,
            mode: "insensitive",
          },
        },
      ],
    });
  }

  const where = andConditions.length > 0 ? { AND: andConditions } : {};

  const [
    payments,
    total,
    paidVolumeAggregate,
    unpaidVolumeAggregate,
    paidCount,
    pendingCount,
    failedCount,
    totalAllPayments,
  ] = await Promise.all([
    prisma.payment.findMany({
      where,
      include: {
        order: true,
      },
      orderBy: {
        [sortBy]: sortOrder,
      },
      take: limit,
      skip,
    }),
    prisma.payment.count({ where }),
    prisma.payment.aggregate({
      _sum: {
        amount: true,
      },
      where: {
        status: "paid",
      },
    }),
    prisma.payment.aggregate({
      _sum: {
        amount: true,
      },
      where: {
        status: { in: ["pending", "failed", "expired", "cancelled"] },
      },
    }),
    prisma.payment.count({
      where: {
        status: "paid",
      },
    }),
    prisma.payment.count({
      where: {
        status: "pending",
      },
    }),
    prisma.payment.count({
      where: {
        status: "failed",
      },
    }),
    prisma.payment.count(),
  ]);

  const totalPaidVolume =
    Math.round((paidVolumeAggregate._sum.amount || 0) * 100) / 100;
  const totalUnpaidVolume =
    Math.round((unpaidVolumeAggregate._sum.amount || 0) * 100) / 100;
  const failedOrPendingCount = Math.max(0, totalAllPayments - paidCount);

  return {
    payments,
    metaData: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
    stats: {
      totalPaidVolume,
      totalUnpaidVolume,
      totalOverallVolume:
        Math.round((totalPaidVolume + totalUnpaidVolume) * 100) / 100,
      paidCount,
      pendingCount,
      failedCount,
      totalCount: totalAllPayments,
      successfulCount: paidCount,
      failedOrPendingCount,
    },
  };
};

const createDecoration = async (data: any) => {
  const { categoryId } = JSON.parse(data.data);
  const decoration = await prisma.decoration.create({
    data: {
      image: data.image,
      categoryId,
    },
  });
  return decoration;
};

const deleteDecoration = async (id: string) => {
  await prisma.decoration.delete({
    where: {
      id,
    },
  });
  return true;
};

const getAllDecoration = async (
  page: number,
  limit: number,
  skip: number,
  filter: any,
  sortBy: string,
  sortOrder: "asc" | "desc",
) => {
  const cleanFilter = { ...filter };
  for (const key of Object.keys(cleanFilter)) {
    if (
      cleanFilter[key] === "" ||
      cleanFilter[key] === "all" ||
      cleanFilter[key] === undefined ||
      cleanFilter[key] === null
    ) {
      delete cleanFilter[key];
    }
  }

  const where = Object.keys(cleanFilter).length > 0 ? cleanFilter : undefined;

  const [decorations, total] = await prisma.$transaction([
    prisma.decoration.findMany({
      where,
      orderBy: {
        [sortBy]: sortOrder,
      },
      include: {
        category: true,
      },
      take: limit,
      skip,
    }),
    prisma.decoration.count({ where }),
  ]);

  return {
    decorations,
    metaData: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

const createDecorationCategory = async (name: string) => {
  const isExist = await prisma.decorationCategory.findUnique({
    where: {
      name,
    },
  });

  if (isExist) {
    throw new AppError("Decoratiecategorie bestaat al");
  }
  const category = await prisma.decorationCategory.create({
    data: {
      name: name.toUpperCase(),
    },
  });
  return category;
};

const getAllDecorationCategory = async () => {
  const categories = await prisma.decorationCategory.findMany();
  return categories;
};

const updateDecorationCategory = async (id: string, name: string) => {
  const isExist = await prisma.decorationCategory.findUnique({
    where: {
      id,
    },
  });

  if (!isExist) {
    throw new AppError("Decoratiecategorie niet gevonden");
  }
  const category = await prisma.decorationCategory.update({
    where: {
      id,
    },
    data: {
      name,
    },
  });
  return category;
};

const deleteDecorationCategory = async (id: string) => {
  const isExist = await prisma.decorationCategory.findUnique({
    where: { id },
  });

  if (!isExist) {
    throw new AppError("Decoratiecategorie niet gevonden");
  }

  await prisma.$transaction(async (tx) => {
    await tx.decoration.deleteMany({
      where: {
        categoryId: id,
      },
    });

    await tx.decorationCategory.delete({
      where: { id },
    });
  });

  return true;
};

const getSingleOrder = async (orderId: string) => {
  const order = await prisma.order.findUnique({
    where: {
      id: orderId,
    },
    include: {
      user: true,
      banner: true,
      addresses: true,
      payment: true,
      items: {
        include: {
          banner: true,
        },
      },
      shipments: true,
    },
  });

  return order;
};

type UpdateOrderAddressPayload = {
  name?: string;
  phone?: string;
  email?: string;
  houseNumber?: string;
  street?: string;
  city?: string;
  zipCode?: string;
  companyName?: string;
  address?: string;
  country?: string;
};

const updateOrderAddress = async (
  orderId: string,
  payload: UpdateOrderAddressPayload,
) => {
  const order = await prisma.order.findUnique({
    where: {
      id: orderId,
    },
    include: {
      addresses: true,
    },
  });

  if (!order) {
    throw new AppError("Bestelling niet gevonden", httpStatus.NOT_FOUND);
  }

  const existingAddress = order.addresses;

  const name = payload.name !== undefined ? payload.name.trim() : (existingAddress?.name || "");
  const phone = payload.phone !== undefined ? payload.phone.trim() : (existingAddress?.phone || "");
  const email = payload.email !== undefined ? payload.email.trim() : (existingAddress?.email || "");
  const street = payload.street !== undefined ? payload.street.trim() : (existingAddress?.street || "");
  const houseNumber = payload.houseNumber !== undefined ? payload.houseNumber.trim() : (existingAddress?.houseNumber || "");
  const zipCode = payload.zipCode !== undefined ? payload.zipCode.trim() : (existingAddress?.zipCode || "");
  const city = payload.city !== undefined ? payload.city.trim() : (existingAddress?.city || "");
  const companyName = payload.companyName !== undefined ? (payload.companyName?.trim() || null) : (existingAddress?.companyName || null);
  const extraAddress = payload.address !== undefined ? (payload.address?.trim() || null) : (existingAddress?.address || null);
  const country = payload.country !== undefined ? (payload.country?.trim().toUpperCase() || "NL") : (existingAddress?.country || "NL");

  await prisma.address.upsert({
    where: {
      orderId,
    },
    update: {
      name,
      phone,
      email,
      street,
      houseNumber,
      zipCode,
      city,
      companyName,
      address: extraAddress,
      country,
    },
    create: {
      orderId,
      userId: order.userId || null,
      name,
      phone,
      email,
      street,
      houseNumber,
      zipCode,
      city,
      companyName,
      address: extraAddress,
      country,
    },
  });

  if (order.isGuest) {
    await prisma.order.update({
      where: { id: orderId },
      data: {
        guestName: name,
        guestEmail: email,
        guestPhone: phone,
      },
    });
  }

  return getSingleOrder(orderId);
};

const createFaq = async (data: { category: string; question: string; answer: string }) => {
  const faq = await prisma.faq.create({
    data,
  });
  return faq;
};

const updateFaq = async (id: string, data: Partial<{ category: string; question: string; answer: string }>) => {
  const isExist = await prisma.faq.findUnique({
    where: { id },
  });

  if (!isExist) {
    throw new AppError("FAQ niet gevonden", httpStatus.NOT_FOUND);
  }

  const faq = await prisma.faq.update({
    where: { id },
    data,
  });
  return faq;
};

const deleteFaq = async (id: string) => {
  const isExist = await prisma.faq.findUnique({
    where: { id },
  });

  if (!isExist) {
    throw new AppError("FAQ niet gevonden", httpStatus.NOT_FOUND);
  }

  await prisma.faq.delete({
    where: { id },
  });
  return true;
};

const getFaqs = async () => {
  const faqs = await prisma.faq.findMany({
    orderBy: {
      createdAt: "desc"
    }
  });
  return faqs;
};

const createTemplateCategory = async (data: {
  name: string;
  slug?: string;
  isActive?: boolean;
  metaTitle?: string;
  metaDescription?: string;
  h1Title?: string;
  introText?: string;
  seoDescription?: string;
}) => {
  const name = data.name?.trim();

  if (!name) {
    throw new AppError("Categorienaam is verplicht", httpStatus.BAD_REQUEST);
  }

  const slug = data.slug?.trim()
    ? generateSlug(data.slug)
    : await generateUniqueTemplateCategorySlug(name);

  const category = await prisma.templateCategory.create({
    data: {
      name,
      slug,
      isActive: data.isActive ?? true,
      metaTitle: data.metaTitle || null,
      metaDescription: data.metaDescription || null,
      h1Title: data.h1Title || null,
      introText: data.introText || null,
      seoDescription: data.seoDescription || null,
    },
  });

  return category;
};

const getAllTemplateCategories = async () => {
  const categories = await prisma.templateCategory.findMany({
    orderBy: [
      { position: "asc" },
      { createdAt: "desc" },
    ],
  });

  return categories;
};

const updateTemplateCategory = async (
  id: string,
  data: Partial<{
    name: string;
    slug: string;
    isActive: boolean;
    metaTitle: string | null;
    metaDescription: string | null;
    h1Title: string | null;
    introText: string | null;
    seoDescription: string | null;
  }>,
) => {
  const isExist = await prisma.templateCategory.findUnique({
    where: { id },
  });

  if (!isExist) {
    throw new AppError("Templatecategorie niet gevonden", httpStatus.NOT_FOUND);
  }

  const updateData: any = {};

  if (data.name !== undefined) {
    const name = data.name.trim();
    if (!name) {
      throw new AppError("Categorienaam is verplicht", httpStatus.BAD_REQUEST);
    }
    updateData.name = name;
  }

  if (data.slug !== undefined) {
    updateData.slug = await generateUniqueTemplateCategorySlug(data.slug, id);
  } else if (data.name !== undefined && data.name !== isExist.name) {
    updateData.slug = await generateUniqueTemplateCategorySlug(data.name, id);
  }

  if (data.isActive !== undefined) updateData.isActive = data.isActive;

  if (data.metaTitle !== undefined) updateData.metaTitle = data.metaTitle || null;
  if (data.metaDescription !== undefined) updateData.metaDescription = data.metaDescription || null;
  if (data.h1Title !== undefined) updateData.h1Title = data.h1Title || null;
  if (data.introText !== undefined) updateData.introText = data.introText || null;
  if (data.seoDescription !== undefined) updateData.seoDescription = data.seoDescription || null;

  const category = await prisma.templateCategory.update({
    where: { id },
    data: updateData,
  });

  return category;
};

const deleteTemplateCategory = async (id: string) => {
  const isExist = await prisma.templateCategory.findUnique({
    where: { id },
  });

  if (!isExist) {
    throw new AppError("Templatecategorie niet gevonden", httpStatus.NOT_FOUND);
  }

  await prisma.$transaction(async (tx) => {
    await tx.banner.updateMany({
      where: {
        templateCategoryId: id,
      },
      data: {
        templateCategoryId: null,
      },
    });

    await tx.templateCategory.delete({
      where: { id },
    });
  });

  return true;
};

const generateUniqueTuinposterCategorySlug = async (
  name: string,
  currentId?: string,
): Promise<string> => {
  const baseSlug = generateSlug(name || "category");
  let slug = baseSlug;
  let counter = 1;

  while (true) {
    const isExist = await prisma.tuinposterCategory.findFirst({
      where: {
        slug,
        ...(currentId ? { id: { not: currentId } } : {}),
      },
    });

    if (!isExist) {
      return slug;
    }

    slug = `${baseSlug}-${counter}`;
    counter++;
  }
};

const createTuinposterCategory = async (data: {
  name: string;
  slug?: string;
  isActive?: boolean;
  metaTitle?: string;
  metaDescription?: string;
  h1Title?: string;
  introText?: string;
  seoDescription?: string;
}) => {
  const name = data.name?.trim();

  if (!name) {
    throw new AppError("Categorienaam is verplicht", httpStatus.BAD_REQUEST);
  }

  const slug = data.slug?.trim()
    ? generateSlug(data.slug)
    : await generateUniqueTuinposterCategorySlug(name);

  const category = await prisma.tuinposterCategory.create({
    data: {
      name,
      slug,
      isActive: data.isActive ?? true,
      metaTitle: data.metaTitle || null,
      metaDescription: data.metaDescription || null,
      h1Title: data.h1Title || null,
      introText: data.introText || null,
      seoDescription: data.seoDescription || null,
    },
  });

  return category;
};

const getAllTuinposterCategories = async () => {
  const categories = await prisma.tuinposterCategory.findMany({
    orderBy: [
      { position: "asc" },
      { createdAt: "desc" },
    ],
  });

  return categories;
};

const updateTuinposterCategory = async (
  id: string,
  data: Partial<{
    name: string;
    slug: string;
    isActive: boolean;
    metaTitle: string | null;
    metaDescription: string | null;
    h1Title: string | null;
    introText: string | null;
    seoDescription: string | null;
  }>,
) => {
  const isExist = await prisma.tuinposterCategory.findUnique({
    where: { id },
  });

  if (!isExist) {
    throw new AppError("Tuinpostercategorie niet gevonden", httpStatus.NOT_FOUND);
  }

  const updateData: any = {};

  if (data.name !== undefined) {
    const name = data.name.trim();
    if (!name) {
      throw new AppError("Categorienaam is verplicht", httpStatus.BAD_REQUEST);
    }
    updateData.name = name;
  }

  if (data.slug !== undefined) {
    updateData.slug = await generateUniqueTuinposterCategorySlug(data.slug, id);
  } else if (data.name !== undefined && data.name !== isExist.name) {
    updateData.slug = await generateUniqueTuinposterCategorySlug(data.name, id);
  }

  if (data.isActive !== undefined) updateData.isActive = data.isActive;

  if (data.metaTitle !== undefined) updateData.metaTitle = data.metaTitle || null;
  if (data.metaDescription !== undefined) updateData.metaDescription = data.metaDescription || null;
  if (data.h1Title !== undefined) updateData.h1Title = data.h1Title || null;
  if (data.introText !== undefined) updateData.introText = data.introText || null;
  if (data.seoDescription !== undefined) updateData.seoDescription = data.seoDescription || null;

  const category = await prisma.tuinposterCategory.update({
    where: { id },
    data: updateData,
  });

  return category;
};

const deleteTuinposterCategory = async (id: string) => {
  const isExist = await prisma.tuinposterCategory.findUnique({
    where: { id },
  });

  if (!isExist) {
    throw new AppError("Tuinpostercategorie niet gevonden", httpStatus.NOT_FOUND);
  }

  await prisma.$transaction(async (tx) => {
    await tx.banner.updateMany({
      where: {
        tuinposterCategoryId: id,
      },
      data: {
        tuinposterCategoryId: null,
      },
    });

    await tx.tuinposterCategory.delete({
      where: { id },
    });
  });

  return true;
};

const resolveTuinposterCategory = async (parsedData: any) => {
  if (parsedData.tuinposterCategoryId || parsedData.categoryId) {
    const category = await prisma.tuinposterCategory.findUnique({
      where: { id: parsedData.tuinposterCategoryId || parsedData.categoryId },
    });

    if (!category) {
      throw new AppError("Tuinposter categorie niet gevonden", httpStatus.NOT_FOUND);
    }

    return category;
  }

  const categorySlug = parsedData.tuinposterCategorySlug || parsedData.category;
  if (categorySlug) {
    return prisma.tuinposterCategory.findFirst({
      where: {
        slug: categorySlug,
      },
    });
  }

  return null;
};

const resolveTemplateCategory = async (parsedData: any) => {
  if (parsedData.templateCategoryId || parsedData.categoryId) {
    const category = await prisma.templateCategory.findUnique({
      where: { id: parsedData.templateCategoryId || parsedData.categoryId },
    });

    if (!category) {
      throw new AppError("Templatecategorie niet gevonden", httpStatus.NOT_FOUND);
    }

    return category;
  }

  const categorySlug = parsedData.templateCategorySlug || parsedData.category;
  if (categorySlug) {
    return prisma.templateCategory.findFirst({
      where: {
        slug: categorySlug,
      },
    });
  }

  return null;
};

const createTemplate = async (payload: any, file?: Express.Multer.File) => {
  let parsedData = payload;
  if (typeof payload === "string" || (payload.data && typeof payload.data === "string")) {
    parsedData = JSON.parse(payload.data || payload);
  }

  const width = Number(parsedData?.width || 0);
  const height = Number(parsedData?.height || 0);

  if (Number.isNaN(width) || Number.isNaN(height) || width <= 0 || height <= 0) {
    throw new AppError(
      "Ongeldige template-afmetingen. Breedte en hoogte moeten positieve getallen zijn.",
      400,
    );
  }

  assertNoDummyContent(parsedData.headline, "headline");
  assertNoDummyContent(parsedData.name, "name");
  assertNoDummyContent(parsedData.description, "description");
  assertNoDummyContent(parsedData.metaTitle, "metaTitle");
  assertNoDummyContent(parsedData.metaDescription, "metaDescription");
  assertNoDummyContent(parsedData.h1Title, "h1Title");
  assertNoDummyContent(parsedData.seoDescription, "seoDescription");

  let imageUrl = "";
  let originalImageUrl: string | null = null;
  let mockupUrl: string | null = null;
  let mockupFirstUrl: string | null = null;
  let mockupHedgeUrl: string | null = null;
  let mockupPartyUrl: string | null = null;
  let mockupRailingUrl: string | null = null;
  let mockupLawnNewUrl: string | null = null;
  let mockupGardenUrl: string | null = null;

  const isReadymade = parsedData.isReadymade === true || parsedData.isReadymade === "true";

  let templateCategory = null;
  let tuinCategory = null;
  if (isReadymade) {
    tuinCategory = await resolveTuinposterCategory(parsedData);
  } else {
    templateCategory = await resolveTemplateCategory(parsedData);
  }

  let isBusinessCategory = templateCategory?.slug?.toLowerCase() === "business" || 
                           templateCategory?.slug?.toLowerCase() === "zakelijk" || 
                           templateCategory?.slug?.toLowerCase() === "corporate" ||
                           templateCategory?.name?.toLowerCase().includes("business") ||
                           templateCategory?.name?.toLowerCase().includes("zakelijk");

  if (!isBusinessCategory && !isReadymade && parsedData.categoryIds && parsedData.categoryIds.length > 0) {
    const cats = await prisma.templateCategory.findMany({
      where: { id: { in: parsedData.categoryIds } }
    });
    isBusinessCategory = cats.some(c => 
      c.slug?.toLowerCase() === "business" || 
      c.slug?.toLowerCase() === "zakelijk" || 
      c.slug?.toLowerCase() === "corporate" ||
      c.name?.toLowerCase().includes("business") ||
      c.name?.toLowerCase().includes("zakelijk")
    );
  }

  const subcategoryId = parsedData.templateSubcategoryId || parsedData.subcategoryId;
  if (!isBusinessCategory && !isReadymade && subcategoryId) {
    const subcat = await prisma.templateSubcategory.findUnique({
      where: { id: subcategoryId },
      include: { templateCategory: true }
    });
    if (subcat) {
      isBusinessCategory = 
        subcat.slug?.toLowerCase() === "business" ||
        subcat.slug?.toLowerCase() === "zakelijk" ||
        subcat.slug?.toLowerCase() === "corporate" ||
        subcat.name?.toLowerCase().includes("business") ||
        subcat.name?.toLowerCase().includes("zakelijk") ||
        subcat.templateCategory?.slug?.toLowerCase() === "business" ||
        subcat.templateCategory?.slug?.toLowerCase() === "zakelijk" ||
        subcat.templateCategory?.slug?.toLowerCase() === "corporate" ||
        subcat.templateCategory?.name?.toLowerCase().includes("business") ||
        subcat.templateCategory?.name?.toLowerCase().includes("zakelijk");
    }
  }

  if (file) {
    originalImageUrl = await uploadImageToS3(file);
    try {
      imageUrl = await uploadOptimizedImageToS3(file);
    } catch (err) {
      console.error("Image optimization failed, falling back to original:", err);
      imageUrl = originalImageUrl;
    }

    try {
      if (isReadymade) {
        // Tuinposters (Garden posters) generate single wooden fence mockup
        const gardenBuffer = await generateGardenMockup(file.buffer);
        const uploadedGarden = await uploadBufferToS3({
          buffer: gardenBuffer,
          key: `mockups/${Date.now()}-mockup.webp`,
          contentType: "image/webp",
        });
        mockupUrl = uploadedGarden;
      } else if (isBusinessCategory) {
        // Business category generates 7 custom mockups
        const mockups = await generateBusinessMockups(file.buffer);
        const uploadMockup = async (buffer: Buffer, name: string) => {
          return uploadBufferToS3({
            buffer,
            key: `mockups/${Date.now()}-${name}.webp`,
            contentType: "image/webp",
          });
        };

        const [t1, t2, t3, t4, t5, t6, t7] = await Promise.all([
          uploadMockup(mockups.template1, "template1"),
          uploadMockup(mockups.template2, "template2"),
          uploadMockup(mockups.template3, "template3"),
          uploadMockup(mockups.template4, "template4"),
          uploadMockup(mockups.template5, "template5"),
          uploadMockup(mockups.template6, "template6"),
          uploadMockup(mockups.template7, "template7"),
        ]);

        mockupFirstUrl = t1;
        mockupHedgeUrl = t2;
        mockupPartyUrl = t3;
        mockupRailingUrl = t4;
        mockupLawnNewUrl = t5;
        mockupGardenUrl = t6;
        mockupUrl = t7;
      } else {
        // Banners generate all 6 mockups
        const mockups = await generateAllMockups(file.buffer);
        const uploadMockup = async (buffer: Buffer, name: string) => {
          return uploadBufferToS3({
            buffer,
            key: `mockups/${Date.now()}-${name}.webp`,
            contentType: "image/webp",
          });
        };

        const [first, hedge, party, railing, lawnNew, garden] = await Promise.all([
          uploadMockup(mockups.first, "first"),
          uploadMockup(mockups.hedge, "hedge"),
          uploadMockup(mockups.party, "party"),
          uploadMockup(mockups.railing, "railing"),
          uploadMockup(mockups.lawnNew, "lawn-new"),
          uploadMockup(mockups.garden, "garden"),
        ]);

        mockupFirstUrl = first;
        mockupHedgeUrl = hedge;
        mockupPartyUrl = party;
        mockupRailingUrl = railing;
        mockupLawnNewUrl = lawnNew;
        mockupGardenUrl = garden;
        mockupUrl = garden; // fallback for backwards compatibility
      }
    } catch (err) {
      console.error("Mockup generation failed:", err);
    }
  } else if (parsedData.imageUrl) {
    imageUrl = parsedData.imageUrl;
    originalImageUrl = parsedData.originalImageUrl || null;
    mockupUrl = parsedData.mockupUrl || null;
    mockupFirstUrl = parsedData.mockupFirstUrl || null;
    mockupHedgeUrl = parsedData.mockupHedgeUrl || null;
    mockupPartyUrl = parsedData.mockupPartyUrl || null;
    mockupRailingUrl = parsedData.mockupRailingUrl || null;
    mockupLawnNewUrl = parsedData.mockupLawnNewUrl || null;
    mockupGardenUrl = parsedData.mockupGardenUrl || null;
  } else {
    throw new AppError("Template-afbeelding is verplicht.", 400);
  }

  const areaM2 = (width / 100) * (height / 100);
  const pricePerM2 = areaM2 < 1 ? 25 : 20;
  const calculatedPrice = areaM2 * pricePerM2;
  const fallbackPrice = Math.max(calculatedPrice, 11.95);
  // For global templates/readymades, the base starting price is always 11.95 EUR (60x40 cm price)
  const finalPrice = 11.95;

  const headline = parsedData.headline || "Template Headline";
  const slug = await generateUniqueBannerSlug(parsedData.slug || headline);
  
  const sku = file ? (file.originalname ? path.parse(file.originalname).name : null) : (parsedData.sku || null);

  const template = await prisma.banner.create({
    data: {
      templateCategoryId: templateCategory?.id || null,
      templateCategoryIds: !isReadymade ? (parsedData.categoryIds || (templateCategory?.id ? [templateCategory.id] : [])) : [],
      templateSubcategoryId: parsedData.templateSubcategoryId || null,
      tuinposterCategoryId: tuinCategory?.id || null,
      tuinposterCategoryIds: isReadymade ? (parsedData.categoryIds || (tuinCategory?.id ? [tuinCategory.id] : [])) : [],
      occasion: parsedData.occasion || templateCategory?.slug || tuinCategory?.slug || "custom",
      style: parsedData.style || "Template",
      headline,
      slug,
      sku,
      name: parsedData.name || null,
      description: parsedData.description || null,
      sizeType: parsedData.sizeType || "custom",
      sizeLabel: parsedData.sizeLabel || "Custom Size",
      width,
      height,
      imageUrl,
      price: Number(finalPrice.toFixed(2)),
      isTemplate: true,
      isReadymade,
      mockupUrl,
      mockupFirstUrl,
      mockupHedgeUrl,
      mockupPartyUrl,
      mockupRailingUrl,
      mockupLawnNewUrl,
      mockupGardenUrl,
      variant: 0,
      status: "GENERATED",

      canvasJSON: parsedData.canvasJSON ? await processCanvasJsonImages(parsedData.canvasJSON) : null,
      metaTitle: parsedData.metaTitle || null,
      metaDescription: parsedData.metaDescription || null,
      h1Title: parsedData.h1Title || null,
      introText: parsedData.introText || null,
      seoDescription: parsedData.seoDescription || null,
      svgMaskId: parsedData.svgMaskId || null,
    },
  });

  return template;
};

const updateTemplate = async (templateId: string, payload: any, file?: Express.Multer.File) => {
  const isExist = await prisma.banner.findUnique({
    where: { id: templateId, isTemplate: true },
  });

  if (!isExist) {
    throw new AppError("Template niet gevonden", httpStatus.NOT_FOUND);
  }

  let parsedData = payload;
  if (typeof payload === "string" || (payload.data && typeof payload.data === "string")) {
    parsedData = JSON.parse(payload.data || payload);
  }

  const isReadymade = parsedData.isReadymade !== undefined
    ? (parsedData.isReadymade === true || parsedData.isReadymade === "true")
    : isExist.isReadymade;

  if (parsedData.headline !== undefined) assertNoDummyContent(parsedData.headline, "headline");
  if (parsedData.name !== undefined) assertNoDummyContent(parsedData.name, "name");
  if (parsedData.description !== undefined) assertNoDummyContent(parsedData.description, "description");
  if (parsedData.metaTitle !== undefined) assertNoDummyContent(parsedData.metaTitle, "metaTitle");
  if (parsedData.metaDescription !== undefined) assertNoDummyContent(parsedData.metaDescription, "metaDescription");
  if (parsedData.h1Title !== undefined) assertNoDummyContent(parsedData.h1Title, "h1Title");
  if (parsedData.seoDescription !== undefined) assertNoDummyContent(parsedData.seoDescription, "seoDescription");

  const updateData: any = {};

  if (parsedData.occasion !== undefined) updateData.occasion = parsedData.occasion;
  if (parsedData.sku !== undefined) updateData.sku = parsedData.sku;
  if (file) {
    updateData.sku = file.originalname ? path.parse(file.originalname).name : null;
  }

  if (parsedData.categoryIds !== undefined) {
    if (isReadymade) {
      updateData.tuinposterCategoryIds = parsedData.categoryIds;
      updateData.tuinposterCategoryId = parsedData.categoryIds[0] || null;
      updateData.templateCategoryIds = [];
      updateData.templateCategoryId = null;
    } else {
      updateData.templateCategoryIds = parsedData.categoryIds;
      updateData.templateCategoryId = parsedData.categoryIds[0] || null;
      updateData.tuinposterCategoryIds = [];
      updateData.tuinposterCategoryId = null;
    }
  } else if (
    parsedData.templateCategoryId !== undefined ||
    parsedData.categoryId !== undefined ||
    parsedData.templateCategorySlug !== undefined ||
    parsedData.category !== undefined ||
    parsedData.tuinposterCategoryId !== undefined ||
    parsedData.tuinposterCategorySlug !== undefined
  ) {
    if (isReadymade) {
      const tuinCategory = await resolveTuinposterCategory(parsedData);
      updateData.tuinposterCategoryId = tuinCategory?.id || null;
      updateData.tuinposterCategoryIds = tuinCategory ? [tuinCategory.id] : [];
      updateData.templateCategoryId = null;
      updateData.templateCategoryIds = [];
      if (parsedData.occasion === undefined && tuinCategory) {
        updateData.occasion = tuinCategory.slug;
      }
    } else {
      const templateCategory = await resolveTemplateCategory(parsedData);
      updateData.templateCategoryId = templateCategory?.id || null;
      updateData.templateCategoryIds = templateCategory ? [templateCategory.id] : [];
      updateData.tuinposterCategoryId = null;
      updateData.tuinposterCategoryIds = [];
      if (parsedData.occasion === undefined && templateCategory) {
        updateData.occasion = templateCategory.slug;
      }
    }
  }
  if (parsedData.style !== undefined) updateData.style = parsedData.style;
  if (parsedData.headline !== undefined) {
    updateData.headline = parsedData.headline;
    if (parsedData.slug) {
      updateData.slug = await generateUniqueBannerSlug(parsedData.slug, templateId);
    } else if (parsedData.headline !== isExist.headline) {
      updateData.slug = await generateUniqueBannerSlug(parsedData.headline, templateId);
    }
  } else if (parsedData.slug !== undefined) {
    updateData.slug = await generateUniqueBannerSlug(parsedData.slug, templateId);
  }
  if (parsedData.name !== undefined) updateData.name = parsedData.name;
  if (parsedData.description !== undefined) updateData.description = parsedData.description;
  if (parsedData.sizeType !== undefined) updateData.sizeType = parsedData.sizeType;
  if (parsedData.sizeLabel !== undefined) updateData.sizeLabel = parsedData.sizeLabel;
  if (parsedData.canvasJSON !== undefined) updateData.canvasJSON = await processCanvasJsonImages(parsedData.canvasJSON);
  if (parsedData.metaTitle !== undefined) updateData.metaTitle = parsedData.metaTitle;
  if (parsedData.metaDescription !== undefined) updateData.metaDescription = parsedData.metaDescription;
  if (parsedData.h1Title !== undefined) updateData.h1Title = parsedData.h1Title;
  if (parsedData.seoDescription !== undefined) updateData.seoDescription = parsedData.seoDescription;
  if (parsedData.svgMaskId !== undefined) {
    updateData.svgMaskId = parsedData.svgMaskId || null;
  }

  let width = isExist.width;
  let height = isExist.height;

  if (parsedData.width !== undefined) {
    width = Number(parsedData.width);
    updateData.width = width;
  }
  if (parsedData.height !== undefined) {
    height = Number(parsedData.height);
    updateData.height = height;
  }

  // For global templates/readymades, the base starting price is always 11.95 EUR (60x40 cm price)
  updateData.price = 11.95;
  updateData.priceInclVat = 11.95;
  updateData.priceExclVat = 9.88;
  updateData.vatAmount = 2.07;
  updateData.vatRate = 0.21;

  updateData.isReadymade = isReadymade;

  if (parsedData.templateSubcategoryId !== undefined) {
    updateData.templateSubcategoryId = parsedData.templateSubcategoryId || null;
  }

  if (file) {
    const originalUrl = await uploadImageToS3(file);
    updateData.originalImageUrl = originalUrl;

    if (isExist.originalImageUrl) {
      const oldOriginalKey = getS3KeyFromUrl(isExist.originalImageUrl);
      if (oldOriginalKey) {
        await deleteImageFromS3(oldOriginalKey);
      }
    }

    let imageUrl = originalUrl;
    try {
      imageUrl = await uploadOptimizedImageToS3(file);
    } catch (err) {
      console.error("Image optimization failed on update, falling back to original:", err);
    }
    updateData.imageUrl = imageUrl;

    if (isExist.imageUrl) {
      const oldKey = getS3KeyFromUrl(isExist.imageUrl);
      if (oldKey) {
        await deleteImageFromS3(oldKey);
      }
    }
  }

  // Fetch templateCategory to check if Business category
  let templateCategory = null;
  if (updateData.templateCategoryId) {
    templateCategory = await prisma.templateCategory.findUnique({
      where: { id: updateData.templateCategoryId }
    });
  } else if (isExist.templateCategoryId) {
    templateCategory = await prisma.templateCategory.findUnique({
      where: { id: isExist.templateCategoryId }
    });
  }

  let isBusinessCategory = templateCategory?.slug?.toLowerCase() === "business" || 
                           templateCategory?.slug?.toLowerCase() === "zakelijk" || 
                           templateCategory?.slug?.toLowerCase() === "corporate" ||
                           templateCategory?.name?.toLowerCase().includes("business") ||
                           templateCategory?.name?.toLowerCase().includes("zakelijk");

  const currentCategoryIds = updateData.templateCategoryIds || isExist.templateCategoryIds || [];
  if (!isBusinessCategory && !isReadymade && currentCategoryIds.length > 0) {
    const cats = await prisma.templateCategory.findMany({
      where: { id: { in: currentCategoryIds } }
    });
    isBusinessCategory = cats.some(c => 
      c.slug?.toLowerCase() === "business" || 
      c.slug?.toLowerCase() === "zakelijk" || 
      c.slug?.toLowerCase() === "corporate" ||
      c.name?.toLowerCase().includes("business") ||
      c.name?.toLowerCase().includes("zakelijk")
    );
  }

  const subcategoryId = updateData.templateSubcategoryId || isExist.templateSubcategoryId;
  if (!isBusinessCategory && !isReadymade && subcategoryId) {
    const subcat = await prisma.templateSubcategory.findUnique({
      where: { id: subcategoryId },
      include: { templateCategory: true }
    });
    if (subcat) {
      isBusinessCategory = 
        subcat.slug?.toLowerCase() === "business" ||
        subcat.slug?.toLowerCase() === "zakelijk" ||
        subcat.slug?.toLowerCase() === "corporate" ||
        subcat.name?.toLowerCase().includes("business") ||
        subcat.name?.toLowerCase().includes("zakelijk") ||
        subcat.templateCategory?.slug?.toLowerCase() === "business" ||
        subcat.templateCategory?.slug?.toLowerCase() === "zakelijk" ||
        subcat.templateCategory?.slug?.toLowerCase() === "corporate" ||
        subcat.templateCategory?.name?.toLowerCase().includes("business") ||
        subcat.templateCategory?.name?.toLowerCase().includes("zakelijk");
    }
  }

  if (file) {
    try {
      if (isReadymade) {
        // Tuinposters (Garden posters) generate single wooden fence mockup
        const gardenBuffer = await generateGardenMockup(file.buffer);
        const uploadedGarden = await uploadBufferToS3({
          buffer: gardenBuffer,
          key: `mockups/${Date.now()}-mockup.webp`,
          contentType: "image/webp",
        });
        updateData.mockupUrl = uploadedGarden;
      } else if (isBusinessCategory) {
        // Business category generates 7 custom mockups
        const mockups = await generateBusinessMockups(file.buffer);
        const uploadMockup = async (buffer: Buffer, name: string) => {
          return uploadBufferToS3({
            buffer,
            key: `mockups/${Date.now()}-${name}.webp`,
            contentType: "image/webp",
          });
        };

        const [t1, t2, t3, t4, t5, t6, t7] = await Promise.all([
          uploadMockup(mockups.template1, "template1"),
          uploadMockup(mockups.template2, "template2"),
          uploadMockup(mockups.template3, "template3"),
          uploadMockup(mockups.template4, "template4"),
          uploadMockup(mockups.template5, "template5"),
          uploadMockup(mockups.template6, "template6"),
          uploadMockup(mockups.template7, "template7"),
        ]);

        updateData.mockupFirstUrl = t1;
        updateData.mockupHedgeUrl = t2;
        updateData.mockupPartyUrl = t3;
        updateData.mockupRailingUrl = t4;
        updateData.mockupLawnNewUrl = t5;
        updateData.mockupGardenUrl = t6;
        updateData.mockupUrl = t7;
      } else {
        // Banners generate all 6 mockups
        const mockups = await generateAllMockups(file.buffer);
        const uploadMockup = async (buffer: Buffer, name: string) => {
          return uploadBufferToS3({
            buffer,
            key: `mockups/${Date.now()}-${name}.webp`,
            contentType: "image/webp",
          });
        };

        const [first, hedge, party, railing, lawnNew, garden] = await Promise.all([
          uploadMockup(mockups.first, "first"),
          uploadMockup(mockups.hedge, "hedge"),
          uploadMockup(mockups.party, "party"),
          uploadMockup(mockups.railing, "railing"),
          uploadMockup(mockups.lawnNew, "lawn-new"),
          uploadMockup(mockups.garden, "garden"),
        ]);

        updateData.mockupFirstUrl = first;
        updateData.mockupHedgeUrl = hedge;
        updateData.mockupPartyUrl = party;
        updateData.mockupRailingUrl = railing;
        updateData.mockupLawnNewUrl = lawnNew;
        updateData.mockupGardenUrl = garden;
        updateData.mockupUrl = garden; // fallback
      }

      // Clean up old mockups
      const oldMockups = [
        isExist.mockupFirstUrl,
        isExist.mockupHedgeUrl,
        isExist.mockupPartyUrl,
        isExist.mockupRailingUrl,
        isExist.mockupLawnNewUrl,
        isExist.mockupGardenUrl,
        isExist.mockupUrl,
      ].filter(Boolean);

      for (const oldUrl of oldMockups) {
        const oldKey = getS3KeyFromUrl(oldUrl as string);
        if (oldKey) {
          await deleteImageFromS3(oldKey);
        }
      }
    } catch (err) {
      console.error("Mockups generation failed on update:", err);
    }
  }

  const updatedTemplate = await prisma.banner.update({
    where: { id: templateId },
    data: updateData,
  });

  return updatedTemplate;
};

const deleteTemplate = async (templateId: string) => {
  const isExist = await prisma.banner.findUnique({
    where: { id: templateId, isTemplate: true },
  });

  if (!isExist) {
    throw new AppError("Template niet gevonden", httpStatus.NOT_FOUND);
  }

  // 1. Delete associated template reviews to prevent relational constraints block
  await prisma.templateReview.deleteMany({
    where: { templateId },
  });

  // 2. Set sourceTemplateId of copies to null to prevent relational constraints block
  await prisma.banner.updateMany({
    where: { sourceTemplateId: templateId },
    data: { sourceTemplateId: null },
  });

  // 3. Delete background image from S3 (safeguarded to avoid blocking database deletion)
  if (isExist.imageUrl) {
    const key = getS3KeyFromUrl(isExist.imageUrl);
    if (key) {
      try {
        await deleteImageFromS3(key);
      } catch (s3Error) {
        console.error("Failed to delete template image from S3:", s3Error);
      }
    }
  }

  if (isExist.originalImageUrl) {
    const key = getS3KeyFromUrl(isExist.originalImageUrl);
    if (key) {
      try {
        await deleteImageFromS3(key);
      } catch (s3Error) {
        console.error("Failed to delete original template image from S3:", s3Error);
      }
    }
  }

  // 4. Delete the template banner itself
  await prisma.banner.delete({
    where: { id: templateId },
  });

  return true;
};

const getAllTemplates = async (
  page: number,
  limit: number,
  skip: number,
  occasion?: string,
  categoryId?: string,
  category?: string,
  isReadymade?: boolean,
  searchTerm?: string,
) => {
  const where: any = {
    isTemplate: true,
    isReadymade: isReadymade ?? false,
  };

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
      const templateCategory = await prisma.templateCategory.findFirst({
        where: {
          slug: category,
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

  const [templates, total] = await prisma.$transaction([
    prisma.banner.findMany({
      where,
      orderBy: {
        createdAt: "desc",
      },
      take: limit,
      skip,
      select: bannerListSelect,
    }),
    prisma.banner.count({ where }),
  ]);

  return {
    templates,
    metaData: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

const createBackgroundImage = async (data: any) => {
  let name = data.name;

  if (data.data && typeof data.data === "string") {
    try {
      const parsed = JSON.parse(data.data);
      if (parsed.name) {
        name = parsed.name;
      }
    } catch (e) {
      console.error("Failed to parse background data:", e);
    }
  }

  name = name || "Background";

  const backgroundImage = await prisma.backgroundImage.create({
    data: {
      name,
      imageUrl: data.imageUrl,
    },
  });
  return backgroundImage;
};

const deleteBackgroundImage = async (id: string) => {
  await prisma.backgroundImage.delete({
    where: { id },
  });
  return true;
};

const getAllBackgroundImages = async () => {
  const backgrounds = await prisma.backgroundImage.findMany({
    orderBy: {
      createdAt: "desc",
    },
  });
  return backgrounds;
};

const generateUniqueTemplateSubcategorySlug = async (
  templateCategoryId: string,
  name: string,
  currentId?: string,
): Promise<string> => {
  const baseSlug = generateSlug(name || "subcategory");
  let slug = baseSlug;
  let counter = 1;

  while (true) {
    const isExist = await prisma.templateSubcategory.findFirst({
      where: {
        templateCategoryId,
        slug,
        ...(currentId ? { id: { not: currentId } } : {}),
      },
    });

    if (!isExist) {
      return slug;
    }

    slug = `${baseSlug}-${counter}`;
    counter++;
  }
};

const createTemplateSubcategory = async (data: {
  name: string;
  templateCategoryId: string;
  slug?: string;
  isActive?: boolean;
  metaTitle?: string;
  metaDescription?: string;
  h1Title?: string;
  introText?: string;
  seoDescription?: string;
}) => {
  const name = data.name?.trim();
  const templateCategoryId = data.templateCategoryId;

  if (!name) {
    throw new AppError("Subcategorienaam is verplicht", httpStatus.BAD_REQUEST);
  }
  if (!templateCategoryId) {
    throw new AppError("Templatecategorie-ID is verplicht", httpStatus.BAD_REQUEST);
  }

  const slug = data.slug?.trim()
    ? generateSlug(data.slug)
    : await generateUniqueTemplateSubcategorySlug(templateCategoryId, name);

  const subcategory = await prisma.templateSubcategory.create({
    data: {
      name,
      slug,
      templateCategoryId,
      isActive: data.isActive ?? true,
      metaTitle: data.metaTitle || null,
      metaDescription: data.metaDescription || null,
      h1Title: data.h1Title || null,
      introText: data.introText || null,
      seoDescription: data.seoDescription || null,
    },
  });

  return subcategory;
};

const getAllTemplateSubcategories = async (query: { templateCategoryId?: string }) => {
  const subcategories = await prisma.templateSubcategory.findMany({
    where: query.templateCategoryId ? { templateCategoryId: query.templateCategoryId } : {},
    include: {
      templateCategory: true,
    },
    orderBy: [
      { position: "asc" },
      { createdAt: "desc" },
    ],
  });

  return subcategories;
};

const updateTemplateSubcategory = async (
  id: string,
  data: Partial<{
    name: string;
    slug: string;
    isActive: boolean;
    templateCategoryId: string;
    metaTitle: string | null;
    metaDescription: string | null;
    h1Title: string | null;
    introText: string | null;
    seoDescription: string | null;
  }>,
) => {
  const isExist = await prisma.templateSubcategory.findUnique({
    where: { id },
  });

  if (!isExist) {
    throw new AppError("Templatesubcategorie niet gevonden", httpStatus.NOT_FOUND);
  }

  const updateData: any = {};

  if (data.name !== undefined) {
    const name = data.name.trim();
    if (!name) {
      throw new AppError("Subcategorienaam is verplicht", httpStatus.BAD_REQUEST);
    }
    updateData.name = name;
  }

  const templateCategoryId = data.templateCategoryId || isExist.templateCategoryId;

  if (data.slug !== undefined) {
    updateData.slug = await generateUniqueTemplateSubcategorySlug(templateCategoryId, data.slug, id);
  } else if (data.name !== undefined && data.name !== isExist.name) {
    updateData.slug = await generateUniqueTemplateSubcategorySlug(templateCategoryId, data.name, id);
  }

  if (data.isActive !== undefined) updateData.isActive = data.isActive;
  if (data.templateCategoryId !== undefined) updateData.templateCategoryId = data.templateCategoryId;

  if (data.metaTitle !== undefined) updateData.metaTitle = data.metaTitle || null;
  if (data.metaDescription !== undefined) updateData.metaDescription = data.metaDescription || null;
  if (data.h1Title !== undefined) updateData.h1Title = data.h1Title || null;
  if (data.introText !== undefined) updateData.introText = data.introText || null;
  if (data.seoDescription !== undefined) updateData.seoDescription = data.seoDescription || null;

  const subcategory = await prisma.templateSubcategory.update({
    where: { id },
    data: updateData,
  });

  return subcategory;
};

const deleteTemplateSubcategory = async (id: string) => {
  const isExist = await prisma.templateSubcategory.findUnique({
    where: { id },
  });

  if (!isExist) {
    throw new AppError("Templatesubcategorie niet gevonden", httpStatus.NOT_FOUND);
  }

  await prisma.$transaction(async (tx) => {
    await tx.banner.updateMany({
      where: {
        templateSubcategoryId: id,
      },
      data: {
        templateSubcategoryId: null,
      },
    });

    await tx.templateSubcategory.delete({
      where: { id },
    });
  });

  return true;
};

const reorderTemplateSubcategories = async (ids: string[]) => {
  return prisma.$transaction(
    ids.map((id, index) =>
      prisma.templateSubcategory.update({
        where: { id },
        data: { position: index },
      })
    )
  );
};

const reorderTemplateCategories = async (ids: string[]) => {
  return prisma.$transaction(
    ids.map((id, index) =>
      prisma.templateCategory.update({
        where: { id },
        data: { position: index },
      })
    )
  );
};

const reorderTuinposterCategories = async (ids: string[]) => {
  return prisma.$transaction(
    ids.map((id, index) =>
      prisma.tuinposterCategory.update({
        where: { id },
        data: { position: index },
      })
    )
  );
};

export const adminService = {
  totalOrder,
  getOrderStatusSummary,
  manageOrder,
  manageUsers,
  updateUserStatus,
  dashboardStats,
  totalTransaction,
  createDecoration,
  deleteDecoration,
  createDecorationCategory,
  getAllDecorationCategory,
  getAllDecoration,
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
  createTuinposterCategory,
  getAllTuinposterCategories,
  updateTuinposterCategory,
  deleteTuinposterCategory,
  reorderTuinposterCategories,
  createTemplateSubcategory,
  getAllTemplateSubcategories,
  updateTemplateSubcategory,
  deleteTemplateSubcategory,
  reorderTemplateSubcategories,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  getAllTemplates,
  createBackgroundImage,
  deleteBackgroundImage,
  getAllBackgroundImages,
};
