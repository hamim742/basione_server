import { Router } from "express";
import { userRoutes } from "../modules/user/user.routes";
import { authRoutes } from "../modules/auth/auth.routes";
import { bannerRoutes } from "../modules/banner/banner.routes";
import { orderRoutes } from "../modules/order/order.routes";
import { paymentRoutes } from "../modules/payment/payment.routes";
import { adminRoutes } from "../modules/admin/admin.route";
import { decorationRoutes } from "../modules/decorations/decorations.routes";
import { blogRoutes } from "../modules/blog/blog.routes";
import { aggregateRoutes } from "../modules/aggregate/aggregate.routes";
import { chatbotRoutes } from "../modules/chatbot/chatbot.routes";
import { fontRoutes } from "../modules/font/font.routes";
import { shippingRoutes } from "../modules/shipping/shipping.routes";
import { templateReviewRoutes } from "../modules/templateReview/templateReview.routes";
import { contactRoutes } from "../modules/contact/contact.routes";
import { svgMaskRoutes } from "../modules/svgMask/svgMask.routes";
import { webwinkelkeurRoutes } from "../modules/webwinkelkeur/webwinkelkeur.routes";
import { cartRoutes } from "../modules/cart/cart.routes";
import { alertBarRoutes } from "../modules/alertBar/alertBar.routes";
import { notificationRoutes } from "../modules/notification/notification.routes";
import { wishlistRoutes } from "../modules/wishlist/wishlist.routes";
import { couponRoutes } from "../modules/coupon/coupon.routes";
import { designRequestRoutes } from "../modules/designRequest/designRequest.routes";
import { pricingSettingRoutes } from "../modules/pricingSetting/pricingSetting.routes";
import { partyCategoryRoutes } from "../modules/partyCategory/partyCategory.routes";
import { partyProductRoutes } from "../modules/partyProduct/partyProduct.routes";

export const router = Router();


const routes = [
  {
    path: "/coupon",
    route: couponRoutes,
  },
  {
    path: "/notification",
    route: notificationRoutes,
  },
  {
    path: "/cart",
    route: cartRoutes,
  },
  {
    path: "/wishlist",
    route: wishlistRoutes,
  },
  {
    path: "/user",
    route: userRoutes,
  },
  {
    path: "/auth",
    route: authRoutes,
  },
  {
    path: "/banner",
    route: bannerRoutes,
  },
  {
    path: "/order",
    route: orderRoutes,
  },
  {
    path: "/payment",
    route: paymentRoutes,
  },
  {
    path: "/admin",
    route: adminRoutes,
  },
  {
    path: "/decorations",
    route: decorationRoutes,
  },
  {
    path: "/blog",
    route: blogRoutes,
  },
  {
    path: "/aggregate",
    route: aggregateRoutes,
  },
  {
    path: "/chatbot",
    route: chatbotRoutes,
  },
  {
    path: "/fonts",
    route: fontRoutes,
  },
  {
    path: "/shipping",
    route: shippingRoutes,
  },
  {
    path: "/template-review",
    route: templateReviewRoutes,
  },
  {
    path: "/contact",
    route: contactRoutes,
  },
  {
    path: "/svg-mask",
    route: svgMaskRoutes,
  },
  {
    path: "/webwinkelkeur",
    route: webwinkelkeurRoutes,
  },
  {
    path: "/alert-bar",
    route: alertBarRoutes,
  },
  {
    path: "/design-request",
    route: designRequestRoutes,
  },
  {
    path: "/pricing-settings",
    route: pricingSettingRoutes,
  },
  {
    path: "/party-category",
    route: partyCategoryRoutes,
  },
  {
    path: "/party-product",
    route: partyProductRoutes,
  },
];


routes.forEach((route) => {
  router.use(route.path, route.route);
});
