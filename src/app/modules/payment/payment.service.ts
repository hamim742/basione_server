import { mollieClient } from "../../lib/mollie";
import { AppError } from "../../error/AppError";
import httpStatus from "http-status";
import { prisma } from "../../lib/prisma";
import { generateTransactionId } from "../../utils/generateTransactionId";
import { paymentSuccessTemplate } from "../../utils/emailTemplates/paymentSuccess";
import { orderConfirmedTemplate } from "../../utils/emailTemplates/orderConfirmation";
import { cancledOrder } from "../order/order.service";
import { formatLabel } from "../../utils/formatLable";
import { Prisma } from "@prisma/client";
import fs from "fs";
import crypto from "crypto";
import {
  generateAndSaveInvoice,
  markInvoiceAsSent,
} from "../invoice/invoice.service";
import { OrderConfirmedEmailData } from "../../../type/interface";
import { formatAmsterdamDateTime } from "../../utils/deliveryCalculator";
import { sendAdminPushNotification } from "../../utils/notification.service";

type TransactionClient = Prisma.TransactionClient;
type PaymentRequestUser = {
  id?: string;
  role?: string;
};

interface CreatePaymentPayload {
  orderId: string;
  amount: number;
  customerName: string;
  companyName?: string | null;
  customerEmail?: string;
  method?: string;
}

const getMolliePaymentIdFromJSON = (paymentJSON: Prisma.JsonValue | null) => {
  if (
    paymentJSON &&
    typeof paymentJSON === "object" &&
    !Array.isArray(paymentJSON)
  ) {
    if ("molliePaymentId" in paymentJSON) {
      const molliePaymentId = paymentJSON.molliePaymentId;
      if (typeof molliePaymentId === "string") return molliePaymentId;
    }
    if ("id" in paymentJSON) {
      const id = paymentJSON.id;
      if (typeof id === "string") return id;
    }
  }

  return null;
};

const isSecureStringEqual = (
  storedValue?: string | null,
  receivedValue?: string,
) => {
  if (!storedValue || !receivedValue) {
    return false;
  }

  const storedBuffer = Buffer.from(storedValue);
  const receivedBuffer = Buffer.from(receivedValue);

  if (storedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(storedBuffer, receivedBuffer);
};

const toFrontendDeliveryType = (deliveryType?: string | null) =>
  deliveryType ? deliveryType.replace(/_/g, "-") : deliveryType;

const ensurePaymentAccess = (
  payment: any,
  user?: PaymentRequestUser,
  guestToken?: string,
) => {
  const order = payment?.order;

  if (!order) {
    throw new AppError("Bestelling niet gevonden", httpStatus.NOT_FOUND);
  }

  if (order.isGuest) {
    if (!guestToken) {
      throw new AppError("Guest token is verplicht", httpStatus.UNAUTHORIZED);
    }

    const isExpired =
      order.guestTokenExpiresAt && order.guestTokenExpiresAt < new Date();

    if (isExpired || !isSecureStringEqual(order.guestOrderToken, guestToken)) {
      throw new AppError("Ongeldige guest token", httpStatus.FORBIDDEN);
    }

    return;
  }

  if (user?.role === "admin") {
    return;
  }

  if (!user?.id || order.userId !== user.id) {
    throw new AppError("Je bent niet geautoriseerd", httpStatus.UNAUTHORIZED);
  }
};

export const createPayment = async (
  payload: CreatePaymentPayload,
  userId?: string,
  tx?: TransactionClient,
) => {
  const db = tx || prisma;

  const { amount, orderId, customerName, companyName, customerEmail, method } = payload;

  const transactionId = generateTransactionId();
  const order = await db.order.findUnique({
    where: {
      id: orderId,
    },
    include: {
      addresses: true,
      items: {
        include: {
          banner: true,
        },
      },
    },
  });

  if (!order) {
    throw new AppError("Bestelling niet gevonden", httpStatus.NOT_FOUND);
  }

  const existingPendingPayment = await db.payment.findFirst({
    where: {
      orderId,
      status: "pending",
    },
  });

  if (existingPendingPayment) {
    await db.payment.delete({
      where: {
        id: existingPendingPayment.id,
      },
    });
  }

  const payment = await db.payment.create({
    data: {
      orderId,
      amount,
      transactionId,
      status: "pending",
      userId: userId || null,
    },
  });

  const displayName = companyName || customerName;
  const guestTokenQuery =
    order.isGuest && order.guestOrderToken
      ? `&token=${order.guestOrderToken}`
      : "";

  let billingAddress: any = undefined;
  if (order.addresses) {
    const addr = order.addresses;
    const fullName = addr.name || customerName || "";
    const parts = fullName.trim().split(/\s+/);
    const givenName = parts[0] || "Customer";
    const familyName = parts.slice(1).join(" ") || "Name";

    const cleanZip = (addr.zipCode || "").trim().replace(/\s+/g, "");
    let countryCode = "NL";
    if (/^[1-9][0-9]{3}[a-zA-Z]{2}$/.test(cleanZip)) {
      countryCode = "NL";
    } else if (/^[1-9][0-9]{3}$/.test(cleanZip)) {
      countryCode = "BE";
    }

    billingAddress = {
      givenName,
      familyName,
      email: addr.email || customerEmail || "",
      streetAndNumber: `${addr.street} ${addr.houseNumber}`.trim(),
      postalCode: addr.zipCode,
      city: addr.city,
      country: countryCode,
    };
  }

  const lines: any[] = [];
  const vatRate = order.vatRate || 0.21;
  const vatRatePercent = (vatRate * 100).toFixed(2);

  if (order.items && order.items.length > 0) {
    for (const item of order.items) {
      const unitEyeletsFee = Number(item.eyeletsFee || 0) / item.quantity;
      const itemUnitPrice = Number(item.price) + unitEyeletsFee;
      const itemTotal = Number(item.subtotal);
      const itemVatAmount = (itemTotal * vatRate) / (1 + vatRate);

      let itemDesc = "Spandoek Print";
      if (item.banner) {
        itemDesc = item.banner.name || item.banner.headline || `Banner (${item.banner.occasion || "Custom"})`;
      }

      const desc = item.hasEyelets ? `${itemDesc} (incl. Ringen)` : itemDesc;

      lines.push({
        type: "physical",
        description: desc,
        quantity: item.quantity,
        unitPrice: {
          currency: "EUR",
          value: itemUnitPrice.toFixed(2),
        },
        totalAmount: {
          currency: "EUR",
          value: itemTotal.toFixed(2),
        },
        vatRate: vatRatePercent,
        vatAmount: {
          currency: "EUR",
          value: itemVatAmount.toFixed(2),
        },
      });
    }
  }

  if (order.deliveryFee && order.deliveryFee > 0) {
    const deliveryTotal = Number(order.deliveryFee);
    const deliveryVatAmount = (deliveryTotal * vatRate) / (1 + vatRate);

    lines.push({
      type: "shipping_fee",
      description: "Verzendkosten (Delivery Fee)",
      quantity: 1,
      unitPrice: {
        currency: "EUR",
        value: deliveryTotal.toFixed(2),
      },
      totalAmount: {
        currency: "EUR",
        value: deliveryTotal.toFixed(2),
      },
      vatRate: vatRatePercent,
      vatAmount: {
        currency: "EUR",
        value: deliveryVatAmount.toFixed(2),
      },
    });
  }

  // Adjust for any small floating point rounding discrepancy
  let linesSum = 0;
  for (const line of lines) {
    linesSum += Number(line.totalAmount.value);
  }
  const paymentAmount = Number(amount);
  const diff = paymentAmount - linesSum;
  if (Math.abs(diff) > 0.001 && lines.length > 0) {
    const firstLine = lines[0];
    const newTotal = Number(firstLine.totalAmount.value) + diff;
    firstLine.totalAmount.value = newTotal.toFixed(2);
    firstLine.unitPrice.value = (newTotal / firstLine.quantity).toFixed(2);
    const newVat = (newTotal * vatRate) / (1 + vatRate);
    firstLine.vatAmount.value = newVat.toFixed(2);
  }

  if (lines.length === 0) {
    const totalVal = Number(amount);
    const vatVal = (totalVal * vatRate) / (1 + vatRate);
    lines.push({
      type: "physical",
      description: `Bestelling #${orderId}`,
      quantity: 1,
      unitPrice: {
        currency: "EUR",
        value: totalVal.toFixed(2),
      },
      totalAmount: {
        currency: "EUR",
        value: totalVal.toFixed(2),
      },
      vatRate: vatRatePercent,
      vatAmount: {
        currency: "EUR",
        value: vatVal.toFixed(2),
      },
    });
  }

  const checkout = await mollieClient.payments.create({
    amount: {
      currency: "EUR",
      value: Number(amount).toFixed(2),
    },
    ...(method ? { method: method as any } : {}),
    ...(billingAddress ? { billingAddress } : {}),
    lines,

    description: `Order #${orderId} - ${displayName}`,

    redirectUrl: `https://spandoekprint.nl/payment/success?paymentId=${payment.id}&orderId=${orderId}${guestTokenQuery}`,

    webhookUrl: `https://api.spandoekprint.nl/api/v1/payment/mollie/webhook`,

    cancelUrl: `https://spandoekprint.nl/payment/canceled?paymentId=${payment.id}&orderId=${orderId}${guestTokenQuery}`,

    metadata: {
      orderId,
      paymentId: payment.id,
      userId: userId || "",
      customerName,
      companyName: companyName || "",
      customerEmail: customerEmail || "",
    },
  });

  await db.payment.update({
    where: {
      id: payment.id,
    },
    data: {
      paymentJSON: {
        molliePaymentId: checkout.id,
        mollieStatus: checkout.status,
      },
    },
  });

  return {
    paymentId: payment.id,
    molliePaymentId: checkout.id,
    checkoutUrl: checkout.getCheckoutUrl(),
  };
};

const mollieWebhook = async (payId: string) => {
  if (!payId) {
    throw new AppError("Betalings-ID niet gevonden", httpStatus.BAD_REQUEST);
  }

  const payment = await mollieClient.payments.get(payId);
  await handleMolliePaymentUpdate(payment);

  return {
    message: "Betaling verwerkt",
  };
};

const handleMolliePaymentUpdate = async (payment: any) => {
  const { orderId, paymentId, userId } = (payment.metadata || {}) as any;

  if (!orderId || !paymentId) {
    throw new AppError("Betalingsmetadata ontbreekt", httpStatus.BAD_REQUEST);
  }

  const localPayment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      order: {
        include: {
          invoice: true,
        },
      },
    },
  });

  if (!localPayment) {
    throw new AppError("Betaling niet gevonden", httpStatus.NOT_FOUND);
  }

  const invoice = localPayment.order.invoice;
  const timeSinceCreation = invoice ? Date.now() - new Date(invoice.createdAt).getTime() : 0;
  if (
    localPayment.status === payment.status &&
    localPayment.order.paymentStatus === payment.status &&
    invoice &&
    (invoice.status === "sent" || timeSinceCreation < 60000)
  ) {
    return { message: "Al verwerkt" };
  }

  if (payment.status === "paid") {
    await paymentPaid(orderId, paymentId, userId, payment);
  } else if (payment.status === "failed") {
    const reason = "Payment failed by mollie";
    await paymentFailed(orderId, paymentId, reason);
  } else if (payment.status === "canceled") {
    const reason = "Payment canceled by user";
    await paymentCanceled(orderId, paymentId, reason);
  } else if (payment.status === "expired") {
    const reason = "Payment link expired";
    await paymentExpired(orderId, paymentId, reason);
  }

  return {
    message: `Betaling ${payment.status}`,
  };
};

const syncPaymentStatus = async (
  paymentId: string | undefined,
  user?: PaymentRequestUser,
  guestToken?: string,
) => {
  if (!paymentId) {
    throw new AppError("Betalings-ID niet gevonden", httpStatus.BAD_REQUEST);
  }

  const localPayment = await prisma.payment.findUnique({
    where: {
      id: paymentId,
    },
    include: {
      order: {
        select: {
          id: true,
          userId: true,
          isGuest: true,
          guestOrderToken: true,
          guestTokenExpiresAt: true,
          invoice: {
            select: {
              status: true,
            },
          },
        },
      },
    },
  });

  if (!localPayment) {
    throw new AppError("Betaling niet gevonden", httpStatus.NOT_FOUND);
  }

  ensurePaymentAccess(localPayment, user, guestToken);

  const molliePaymentId = getMolliePaymentIdFromJSON(localPayment.paymentJSON);

  const shouldSync =
    localPayment.status === "pending" ||
    (localPayment.status === "paid" &&
      localPayment.order?.invoice?.status !== "sent");

  if (molliePaymentId && shouldSync) {
    const molliePayment = await mollieClient.payments.get(molliePaymentId);
    await handleMolliePaymentUpdate(molliePayment);
  }

  const refreshedPayment = await prisma.payment.findUnique({
    where: {
      id: paymentId,
    },
    include: {
      order: {
        select: {
          id: true,
          bannerId: true,
          quantity: true,
          total: true,
          trackingNumber: true,
          deliveryFee: true,
          deliveryTime: true,
          deliveryType: true,
          deliveryMethod: true,
          deliveryLabel: true,
          hasEyelets: true,
          eyeletsFee: true,
          subtotal: true,
          priceExcludingVat: true,
          vatRate: true,
          vatAmount: true,
          status: true,
          paymentStatus: true,
          isGuest: true,
          guestEmail: true,
          guestName: true,
          guestPhone: true,
          createdAt: true,
          updatedAt: true,
          banner: {
            select: {
              id: true,
              name: true,
              headline: true,
              imageUrl: true,
              width: true,
              height: true,
              sizeLabel: true,
              price: true,
            },
          },
          items: {
            include: {
              banner: true,
            },
          },
          payment: {
            select: {
              id: true,
              amount: true,
              status: true,
              transactionId: true,
            },
          },
          addresses: {
            select: {
              id: true,
              name: true,
              companyName: true,
              phone: true,
              email: true,
              street: true,
              houseNumber: true,
              address: true,
              zipCode: true,
              city: true,
            },
          },
        },
      },
    },
  });

  if (!refreshedPayment?.order) {
    throw new AppError("Bestelling niet gevonden", httpStatus.NOT_FOUND);
  }

  const order = {
    ...refreshedPayment.order,
    deliveryType: toFrontendDeliveryType(refreshedPayment.order.deliveryType),
  };

  return {
    paymentId: refreshedPayment.id,
    paymentStatus: refreshedPayment.status,
    order,
  };
};

const paymentPaid = async (
  orderId: string,
  paymentId: string,
  userId: string | undefined,
  molliePayment: any,
) => {
  const cleanPayment = JSON.parse(JSON.stringify(molliePayment));

  /**
   * 1. Update payment status atomically from "pending" to "paid"
   */
  let updatedPayment;
  try {
    updatedPayment = await prisma.payment.update({
      where: {
        id: paymentId,
        status: "pending",
      },
      data: {
        status: "paid",
        paymentJSON: cleanPayment,
      },
    });
  } catch (error: any) {
    if (error.code === "P2025") {
      // console.log(
//         `Payment ${paymentId} already processed (status is not pending). Checking details...`,
//       );
      const existingPayment = await prisma.payment.findUnique({
        where: { id: paymentId },
        include: {
          order: {
            include: {
              invoice: true,
            },
          },
        },
      });

      if (existingPayment && existingPayment.status === "paid") {
        return {
          alreadyProcessed: true,
          order: existingPayment.order,
          payment: existingPayment,
          invoice: existingPayment.order?.invoice || null,
          shipment: null,
          shipmentCreated: false,
          orderEmailSent: false,
        };
      }

      if (!existingPayment || !existingPayment.order) {
        throw new AppError("Betaling of bestelling niet gevonden", httpStatus.NOT_FOUND);
      }

      updatedPayment = existingPayment;
    } else {
      throw error;
    }
  }

  /**
   * 2. Update order without transaction
   */
  const updatedOrder = await prisma.order.update({
    where: {
      id: orderId,
    },
    data: {
      paymentStatus: "paid",
      status: "processing",
    },
    include: {
      banner: true,
      user: true,
      addresses: true,
      invoice: true,
      items: {
        include: {
          banner: true,
          partyProduct: true,
        },
      },
    },
  });

  /**
   * 3. Get user
   */
  const paymentUserId = userId || updatedOrder.userId;
  const user = paymentUserId
    ? await prisma.user.findUnique({
        where: {
          id: paymentUserId,
        },
      })
    : null;

  if (!user && !updatedOrder.isGuest) {
    console.error("User not found:", {
      userId,
      orderUserId: updatedOrder.userId,
    });

    throw new AppError("Gebruiker niet gevonden", httpStatus.NOT_FOUND);
  }

  if (!updatedOrder || !updatedPayment) {
    throw new AppError("Betalingsgerelateerde gegevens niet gevonden", httpStatus.NOT_FOUND);
  }

  const customerName =
    user?.name ||
    updatedOrder.guestName ||
    updatedOrder.addresses?.name ||
    "Customer";
  const customerEmail =
    user?.email || updatedOrder.guestEmail || updatedOrder.addresses?.email;

  if (!customerEmail) {
    throw new AppError("E-mailadres van klant niet gevonden", httpStatus.BAD_REQUEST);
  }

  /**
   * Send push notification to admins for new paid order
   */
  sendAdminPushNotification({
    title: "Nieuwe Bestelling Ontvangen! 🛍️",
    body: `Bestelling #${updatedOrder.trackingNumber || orderId} is geplaatst door ${customerName}. Totaal: €${Number(updatedOrder.total || 0).toFixed(2)}`,
    data: {
      orderId: updatedOrder.id,
      trackingNumber: String(updatedOrder.trackingNumber || orderId),
      type: "NEW_ORDER",
    },
  }).catch((err) =>
    console.error("[PushNotification] Error sending new order push notification:", err),
  );

  /**
   * 4. Generate invoice
   */
  const invoice = await generateAndSaveInvoice({
    user,
    order: updatedOrder,
    payment: updatedPayment,
  });

  if (!invoice?.id) {
    console.error("Invoice generation failed:", invoice);

    throw new AppError(
      "Factuur genereren mislukt",
      httpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  if (invoice.status === "sent") {
    return {
      order: updatedOrder,
      payment: updatedPayment,
      invoice,
      shipment: null,
      shipmentCreated: false,
      orderEmailSent: false,
    };
  }

  /**
   * 5. Safe invoice file path
   */
  const safeInvoiceFilePath =
    invoice.invoiceFilePath && fs.existsSync(invoice.invoiceFilePath)
      ? invoice.invoiceFilePath
      : undefined;

  /**
   * 6. Send payment success email
   */
  try {
    await paymentSuccessTemplate({
      userName: customerName,
      email: customerEmail,
      amount: Number(updatedOrder.total || 0),
      transactionId: updatedPayment.transactionId,
      orderId: updatedOrder.trackingNumber || orderId,
      profileOrderId: updatedOrder.id,
      date: formatAmsterdamDateTime(updatedOrder.createdAt),
      invoiceUrl: invoice.invoiceUrl,
      invoiceNumber: invoice.invoiceNumber,

      // first test e attachment path safe kore pathacchi
      invoiceFilePath: safeInvoiceFilePath,
    });
  } catch (error: any) {
    console.error("paymentSuccessTemplate failed:", {
      name: error.name,
      message: error.message,
      code: error.code,
      command: error.command,
      response: error.response,
      responseCode: error.responseCode,
      stack: error.stack,
    });
  }

  /**
   * 7. Prepare order confirmation email data
   */
  const emailData: OrderConfirmedEmailData = {
    userName: updatedOrder.user?.name || customerName,
    email: updatedOrder.user?.email || customerEmail,

    orderId: updatedOrder.trackingNumber || orderId,
    dbOrderId: updatedOrder.id,
    orderDate: formatAmsterdamDateTime(updatedOrder.createdAt),
    estimatedDelivery: (updatedOrder as any).estimatedDeliveryDate || updatedOrder.deliveryTime,

    items: (updatedOrder as any).items && (updatedOrder as any).items.length > 0
      ? (updatedOrder as any).items.map((item: any) => ({
          name: item.partyProduct?.title
            ? item.partyProduct.title
            : `${formatLabel(item.banner?.occasion || "custom") || "Custom"} Banner`,
          quantity: Number(item.quantity || 1),
          price: Number(item.partyProduct?.priceInclVat || item.partyProduct?.price || item.banner?.price || item.price || 0),
          imageUrl: item.partyProduct?.featuredImage || item.partyProduct?.images?.[0] || item.banner?.imageUrl || "",
        }))
      : [
          {
            name: `${
              formatLabel(updatedOrder.banner?.occasion || "custom") || "Custom"
            } Banner`,
            quantity: Number(updatedOrder.quantity || 1),
            price: Number(updatedOrder.banner?.price || updatedOrder.total || 0),
            imageUrl: updatedOrder.banner?.imageUrl || "",
          },
        ],

    subtotal: Number(updatedOrder.subtotal || 0),
    deliveryFee: Number(updatedOrder.deliveryFee || 0),
    eyeletsFee: Number(updatedOrder.eyeletsFee || 0),
    priceExcludingVat: Number(updatedOrder.priceExcludingVat || 0),
    vatRate: Number(updatedOrder.vatRate || 0.21),
    vatAmount: Number(updatedOrder.vatAmount || 0),
    total: Number(updatedOrder.total || 0),

    shippingAddress: {
      name: updatedOrder.addresses?.name || null,
      companyName: updatedOrder.addresses?.companyName || null,
      phone: updatedOrder.addresses?.phone || null,
      email: updatedOrder.addresses?.email || null,
      street: updatedOrder.addresses?.street || null,
      houseNumber: updatedOrder.addresses?.houseNumber || null,
      address: updatedOrder.addresses?.address || null,
      zipCode: updatedOrder.addresses?.zipCode || null,
      city: updatedOrder.addresses?.city || null,
    },

    paymentMethod: "Mollie",

    invoiceNumber: invoice.invoiceNumber,
    invoiceUrl: invoice.invoiceUrl,

    // first e safe path use korchi
    invoiceFilePath: safeInvoiceFilePath,
  };

  /**
   * 8. Send order confirmation email
   */
  let orderEmailSent = false;

  try {
    // console.log("Calling orderConfirmedTemplate:", {
//       to: emailData.email,
//       orderId: emailData.orderId,
//       invoiceNumber: emailData.invoiceNumber,
//     });

    await orderConfirmedTemplate(emailData);

    orderEmailSent = true;
  } catch (error: any) {
    orderEmailSent = false;

    console.error("orderConfirmedTemplate failed:", {
      name: error.name,
      message: error.message,
      code: error.code,
      command: error.command,
      response: error.response,
      responseCode: error.responseCode,
      stack: error.stack,
    });
  }

  /**
   * 9. Mark invoice as sent only if order confirmation email sent
   */
  if (orderEmailSent) {
    try {
      await markInvoiceAsSent(invoice.id);
    } catch (error: any) {
      console.error("markInvoiceAsSent failed:", {
        name: error.name,
        message: error.message,
        stack: error.stack,
      });
    }
  }

  return {
    order: updatedOrder,
    payment: updatedPayment,
    invoice,
    shipment: null,
    shipmentCreated: false,
    orderEmailSent,
  };
};

const paymentFailed = async (
  orderId: string,
  paymentId: string,
  reason?: string,
) => {
  // Keep order as "pending" so the customer can retry payment.
  // Only the payment record is marked as "failed".
  await prisma.order.update({
    where: {
      id: orderId,
    },
    data: {
      paymentStatus: "failed",
      status: "pending",
    },
  });

  await prisma.payment.update({
    where: {
      id: paymentId,
    },
    data: {
      status: "failed",
    },
  });
};

const paymentCanceled = async (
  orderId: string,
  paymentId: string,
  reason?: string,
) => {
  await prisma.order.update({
    where: {
      id: orderId,
    },
    data: {
      paymentStatus: "cancelled",
      status: "cancelled",
    },
  });

  await prisma.payment.update({
    where: {
      id: paymentId,
    },
    data: {
      status: "cancelled",
    },
  });

  await cancledOrder(orderId, reason);
};

const paymentExpired = async (
  orderId: string,
  paymentId: string,
  reason?: string,
) => {
  await prisma.order.update({
    where: {
      id: orderId,
    },
    data: {
      paymentStatus: "expired",
      status: "cancelled",
    },
  });

  await prisma.payment.update({
    where: {
      id: paymentId,
    },
    data: {
      status: "expired",
    },
  });

  await cancledOrder(orderId, reason);
};

export const paymentService = {
  createPayment,
  mollieWebhook,
  syncPaymentStatus,
};
