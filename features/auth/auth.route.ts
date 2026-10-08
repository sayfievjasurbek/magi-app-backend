import express, {type Request, type Response} from 'express';
import {forgotPassword, login, logout, resetPassword, signup, createStudent, getStudentCredentials, verifyAccount, verifyEmail, getUser} from './auth.controller.js';
import {protectRoute} from '../../middleware/auth.middleware.js';
import {requireRole} from '../../middleware/role.middleware.js';


const router = express.Router();


//post
router.post('/login', login);
router.post("/signup", signup);
router.post("/email-verification/:token", verifyAccount);
router.post("/verify-email", verifyEmail);
router.post("/logout", logout);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password/:token", resetPassword);
router.post("/create-student", protectRoute, requireRole('professor'), createStudent);


//get
router.get("/get-user", protectRoute, getUser);
router.get("/students/:id/credentials", protectRoute, requireRole('professor'), getStudentCredentials);



export default router;