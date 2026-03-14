import { Router, type IRouter } from "express";
import healthRouter from "./health";
import experimentsRouter from "./experiments";

const router: IRouter = Router();

router.use(healthRouter);
router.use(experimentsRouter);

export default router;
