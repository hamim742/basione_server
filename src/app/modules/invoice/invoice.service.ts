import httpStatus from "http-status";
import { generateInvoiceNumber } from "../../utils/generateInvoiceNumber";
import { generateInvoicePdf } from "./invoice.pdf";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../error/AppError";
import { uploadInvoicePdfToS3 } from "../../utils/savePdfInvoice";
import { formatAmsterdamDateTime } from "../../utils/deliveryCalculator";

type GenerateInvoicePayload = {
  user: any;
  order: any;
  payment: any;
};

const formatLabel = (value?: string | null) => {
  if (!value) return "Custom";

  return value
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const getDesignNumberFromTrackingNumber = (trackingNumber?: string | null) => {
  if (!trackingNumber) return null;

  const sequence = trackingNumber.split("-").pop();
  const numericSequence = Number(sequence);

  if (Number.isNaN(numericSequence) || numericSequence < 1) {
    return sequence || trackingNumber;
  }

  return String(numericSequence);
};

export const generateAndSaveInvoice = async ({
  user,
  order: inputOrder,
  payment,
}: GenerateInvoicePayload) => {
  try {
    const existingInvoice = await prisma.invoice.findUnique({
      where: {
        orderId: inputOrder.id,
      },
    });

    if (existingInvoice) {
      return existingInvoice;
    }

    let order = inputOrder as any;
    if (!order.items) {
      const fullOrder = await prisma.order.findUnique({
        where: { id: inputOrder.id },
        include: {
          banner: true,
          addresses: true,
          items: {
            include: {
              banner: true,
              partyProduct: true,
            },
          },
        },
      });
      if (fullOrder) {
        order = fullOrder as any;
      }
    }

    const invoiceNumber = await generateInvoiceNumber();

    const designNumber =
      order.banner?.designNumber ||
      getDesignNumberFromTrackingNumber(order.trackingNumber);

    const pdfBuffer = await generateInvoicePdf({
      invoiceNumber,

      orderId: order.id,

      order: {
        orderId: order.id,
        orderNumber: order.order || null,
        trackingNumber: order.trackingNumber || null,
      },

      company: {
        name: "Spandoekprint",
        street: "Neonweg 200",
        postalCity: "1362AE Almere",
        country: "Nederland",
      },

      orderDate: formatAmsterdamDateTime(order.createdAt),

      customer: {
        name: order.addresses?.name || user?.name || order.guestName || "Customer",
        companyName: order.addresses?.companyName || null,
        email: order.addresses?.email || user?.email || order.guestEmail || "",
        phone: order.addresses?.phone || null,
      },

      shippingAddress: {
        companyName: order.addresses?.companyName || null,
        street: order.addresses?.street || "",
        houseNumber: order.addresses?.houseNumber || "",
        address: order.addresses?.address || "",
        zipCode: order.addresses?.zipCode || "",
        city: order.addresses?.city || "",
      },

      banner: {
        name: `${formatLabel(order.banner?.occasion)} Banner`,
        quantity: Number(order.quantity || 1),
        unitPrice: Number(order.banner?.price || 0),
        imageUrl: null,

        designType: "Uploaded / Generated design",
        designFileName: order.banner?.fileName || null,
        designNumber,
        designReference:
          designNumber ||
          order.trackingNumber ||
          order.bannerId ||
          order.banner?.id ||
          order.id,
        size: order.banner?.size || null,
      },

      items: order.items && order.items.length > 0
        ? order.items.map((item: any, i: number) => {
            if (item.partyProduct) {
              return {
                name: item.partyProduct.title || "Feestartikel",
                quantity: Number(item.quantity || 1),
                unitPrice: Number(item.price ?? (item.partyProduct.priceInclVat || item.partyProduct.price || 0)),
                designType: "Feestartikel",
                designFileName: null,
                designNumber: item.partyProduct.sku || "-",
                designReference: item.partyProduct.sku || item.partyProductId || item.id,
                size: null,
              };
            }
            const itemDesignNumber =
              item.banner?.designNumber ||
              (i === 0
                ? getDesignNumberFromTrackingNumber(order.trackingNumber)
                : `${getDesignNumberFromTrackingNumber(order.trackingNumber)}-${i + 1}`);
            return {
              name: `${formatLabel(item.banner?.occasion || "custom")} Banner`,
              quantity: Number(item.quantity || 1),
              unitPrice: Number(item.price || 0),
              designType: "Uploaded / Generated design",
              designFileName: item.banner?.fileName || null,
              designNumber: itemDesignNumber,
              designReference: itemDesignNumber || order.trackingNumber || item.id,
              size: item.banner?.size || item.banner?.sizeLabel || null,
            };
          })
        : undefined,

      pricing: {
        subtotal: Number(order.subtotal || 0),
        discountAmount: Number(order.discountAmount || 0),
        couponCode: order.couponCode || null,
        deliveryFee: Number(order.deliveryFee || 0),
        eyeletsFee: Number(order.eyeletsFee || 0),
        priceExcludingVat: Number(order.priceExcludingVat || 0),
        vatRate: Number(order.vatRate || 0.21),
        vatAmount: Number(order.vatAmount || 0),
        total: Number(order.total || 0),
      },

      payment: {
        method: "Mollie",
        transactionId: payment.transactionId || payment.id || "",
      },
    });

    const savedPdf = await uploadInvoicePdfToS3({
      pdfBuffer,
      invoiceNumber,
    });

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber,
        invoiceUrl: savedPdf.fileUrl,
        invoiceFilePath: savedPdf.fileName,

        orderId: order.id,
        userId: user?.id || null,

        paymentId: payment?.id || "",

        amount: Number(order.total || 0),
        vatAmount: Number(order.vatAmount || 0),
        status: "generated",
      },
    });

    return invoice;
  } catch (error: any) {
    console.error("generateAndSaveInvoice failed:", {
      name: error.name,
      message: error.message,
      code: error.code,
      meta: error.meta,
      stack: error.stack,
    });

    throw error;
  }
};

export const markInvoiceAsSent = async (invoiceId: string) => {
  return prisma.invoice.update({
    where: {
      id: invoiceId,
    },
    data: {
      status: "sent",
      sentAt: new Date(),
    },
  });
};

export const getInvoiceByOrderId = async (orderId: string) => {
  const invoice = await prisma.invoice.findUnique({
    where: {
      orderId,
    },
  });

  if (!invoice) {
    throw new AppError("Factuur niet gevonden", httpStatus.NOT_FOUND);
  }

  return invoice;
};
