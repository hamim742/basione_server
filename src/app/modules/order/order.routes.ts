import { Router } from "express";
import { orderController } from "./order.controller";
import { checkAuth, optionalAuth } from "../../middleware/checkAuth";

const router = Router();

router.post("/create-order", optionalAuth("user"), orderController.createOrder);

router.post("/checkout", optionalAuth("user"), orderController.checkOut);


router.get("/my-orders", checkAuth("user"), orderController.getMyOrders);

router.get("/my-designs", checkAuth("user"), orderController.getMyDesigns);

router.get("/guest/:id", orderController.getGuestOrder);

router.get("/track", orderController.trackOrder);

// Public API endpoints to get all customer information from orders (guest & registered users)
router.get("/customer-orders", orderController.getAllCustomerOrders);
router.get("/public/customers", orderController.getAllCustomerOrders);

router.get("/:id", checkAuth("user", "admin"), orderController.getSingleOrder);

router.patch("/cancel/:id", checkAuth("user"), orderController.cancledOrder);

export const orderRoutes = router;
