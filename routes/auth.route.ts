import express, {type Request, type Response} from 'express';
import {forgotPassword, login, logout, resetPassword, signup, verifyAccount, verifyEmail, getUser} from '../controllers/auth.controller.js';
import {protectRoute} from '../middleware/auth.middleware.js';


const router = express.Router();


//post
router.post('/login', login);
router.post("/signup", signup);
router.post("/email-verification/:token", verifyAccount);
router.post("/verify-email", verifyEmail);
router.post("/logout", logout);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password/:token", resetPassword);


//get
router.get("/get-user", protectRoute, getUser);



export default router;