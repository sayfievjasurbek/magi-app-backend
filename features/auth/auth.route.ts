import express, {type Request, type Response} from 'express';
import {forgotPassword, login, logout, resetPassword, signup, createStudent, listCreatedStudents, getStudentDetail, updateStudent, deleteStudent, resetStudentPhoto, getStudentCredentials, createProfessor, listCreatedProfessors, getProfessorDetail, getProfessorCredentials, changePassword, getMyProfile, updateMyProfile, getMyCurrentPassword, setMyProfilePhoto, checkMyIdentity, verifyAccount, verifyEmail, getUser} from './auth.controller.js';
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
router.post("/create-professor", protectRoute, requireRole('professor'), createProfessor);
router.post("/me/photo", protectRoute, requireRole('student'), setMyProfilePhoto);
router.post("/me/identity-check", protectRoute, requireRole('student'), checkMyIdentity);
router.patch("/me/password", protectRoute, changePassword);
router.patch("/me/profile", protectRoute, updateMyProfile);
router.patch("/students/:id", protectRoute, requireRole('professor'), updateStudent);


//get
router.get("/get-user", protectRoute, getUser);
router.get("/students", protectRoute, requireRole('professor'), listCreatedStudents);
router.get("/students/:id", protectRoute, requireRole('professor'), getStudentDetail);
router.get("/students/:id/credentials", protectRoute, requireRole('professor'), getStudentCredentials);
router.delete("/students/:id", protectRoute, requireRole('professor'), deleteStudent);
router.delete("/students/:id/photo", protectRoute, requireRole('professor'), resetStudentPhoto);
router.get("/professors", protectRoute, requireRole('professor'), listCreatedProfessors);
router.get("/professors/:id", protectRoute, requireRole('professor'), getProfessorDetail);
router.get("/professors/:id/credentials", protectRoute, requireRole('professor'), getProfessorCredentials);
router.get("/me/profile", protectRoute, getMyProfile);
router.get("/me/password", protectRoute, getMyCurrentPassword);



export default router;