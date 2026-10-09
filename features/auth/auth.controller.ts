import { type Request, type Response } from 'express';
import { database } from '../../lib/db.js';
import bcrypt from 'bcrypt';
import crypto from "crypto";
import { sendWelcomeEmail, sendPasswordResetEmail, sendResetSuccessEmail, sendVerificationEmail } from "../../email/email.js";
import { generateToken, handleControllerError } from '../../lib/utils.js';
import { encryptSecret, decryptSecret } from '../../lib/recovery.js';
import { decodeImageData, uploadProfilePhoto } from '../../lib/storage.js';
import { hasFace } from '../../lib/faceMatch.js';
import { HttpError } from '../../lib/errors.js';

type s = string;
type n = string;
type InsertedUser = {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
};

//login
export const login = async ( req: Request, res: Response ) => {
  try {
    const { email, password } : { email: s, password: n } = req.body;

    // Basic validation
    if(!email || !password) return res.status(400).json({
      success: false,  
      message: 'Email and password are required' 
    });

    // Trim and normalize inputs
    const trimmedEmail = email.trim().toLowerCase();

    const { data: user, error: userError } = await database
      .from('users')
      .select('id, first_name, last_name, email, password, is_verified, active_status, deleted_at')
      .eq('email', trimmedEmail)
      .single<{
        id: number,
        first_name: string,
        last_name: string | null, 
        email: string, 
        password: string, 
        is_verified: boolean,
        active_status: string,   
        deleted_at: string | null,
        reason: string | null
      }>();

    // Handle potential errors during the database query
    if (userError || !user){
      return res.status(400).json({
        success: false,
        message: 'Invalid email or password'
      });
    };

    if(!user.password) {
      return res.status(500).json({
        success: false,
        message: 'Account data is incomplete. Please contact support.'
      });
    };
    
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if(!isPasswordValid) return res.status(400).json({
      success: false,
      message: 'Invalid email or password'
    });


    if(!user.is_verified) {
      return res.status(403).json({ 
        success: false, 
        message: 'Email is not verified. Please check your inbox.' 
      });
    };

    if(user.deleted_at || user.active_status !== 'active') {
      return  res.status(403).json({
        success: false,
        message: `Account is ${user.active_status}. Please contact support.`
      });
    };

    const { data: userRole, error: roleError } = await database
      .rpc('get_user_role', { param_user_id: user.id });

    if (roleError) {
      console.log('Error fetching user role:', roleError);
      throw new Error(roleError.message);
    };

    if (!userRole) {
      console.log('User role not found for user ID:', user.id);
      return res.status(403).json({ success: false, message: "Not authorized. Please contact support." });
    };

    // Generate a secure random token
    const token = await generateToken(user.id, user.first_name, user.last_name, user.email, userRole, res);
    const expires_at = new Date();
		expires_at.setDate(expires_at.getDate() + 7); // 7days

    // Store the token in the database (hashed, like every other token type - a DB leak
    // should not hand out ready-to-use session cookies)
    const hashedSessionToken = crypto.createHash('sha256').update(token).digest('hex');
    const { error: tokenError } = await database
      .from('tokens')
      .insert({
        token: hashedSessionToken,
        expires_at,
        token_type: 'cookie_token_login'
      });

    if (tokenError) {
      console.log('Error storing auth token during login:', tokenError);
      throw new Error(tokenError.message);
    };

    return res.status(200).json( {
      success: true,
      // the cookie is what web clients actually use; the desktop app (no cookie jar) reads
      // this token instead and sends it back as `Authorization: Bearer <token>`
      token,
      user: {
        id: user.id,
        first_name: user.first_name,
        last_name: user?.last_name,
        email: user.email,
        role: userRole,
      },
      message: 'User logged in successfully'
    } );
  } catch (error: unknown) {
    return handleControllerError(res, error, "login controller");
  };
};

//signup
export const signup = async ( req: Request, res: Response ) => {
  try {
    const { firstName, lastName, email, password, role = 'student' } : { firstName: s, lastName: s | null, email: s, password: n, role?: s } = req.body;
    
    // Basic validation
    if(!firstName || !email || !password) return res.status(400).json({
      success: false,  
      message: 'All fields are required' 
    });
    if(role !== 'student' && role !== 'professor' && role !== 'examiner') return res.status(400).json({
      success: false,
      message: 'Role must be student, professor or examiner'
    });
    if(password.toString().length < 6 ) return res.status(400).json({
      success: false,
      message: 'Password must be at least 6 characters long'
    });

    // Trim and normalize inputs
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedFirstName = firstName.trim();
    const trimmedLastName = lastName ? lastName.trim() : null;

    const { data: userExists, error: userExistsError } = await database
      .from('users')
      .select('email')
      .eq('email', trimmedEmail)
      .maybeSingle();

    // Handle potential errors during the database query
    if (userExistsError){
      console.log('Error checking existing user:', userExistsError);
      throw new Error(userExistsError.message);
    };

    // If user already exists, respond accordingly
    if (userExists) {
      // User exists and is active
      return res.status(409).json({
        success: false,  
        message: 'Email is already registered. Please check your email or log in.' 
      });
    };

    const hashedPassword: string = await bcrypt.hash(password, 10);

    // Insert new user into the database
    const { data: newUser , error: newUserError } = await database
      .from('users')
      .insert([{
        first_name: trimmedFirstName, 
        last_name: trimmedLastName, 
        email: trimmedEmail, 
        password: hashedPassword,
      }])
      .select('id, email, first_name, last_name')
      .single<InsertedUser>();

    // Handle potential errors during user creation
    if (newUserError) {
      console.log('Error creating new user:', newUserError);
      throw new Error(newUserError.message);
    };
    
    if (!newUser) {
      console.log('New user data is null after insertion');
      throw new Error('New user data is null after insertion');
    };
    
    // Assign the chosen role to the user
    const roleTable = role === 'professor' ? 'professors' : role === 'examiner' ? 'examiners' : 'students';
    const { error: roleError } = await database
      .from(roleTable)
      .insert({ user_id: newUser.id });

    if (roleError) {
      console.log('Error assigning role to new user:', roleError);
      throw new Error(roleError.message);
    };
    
    // Generate email verification token
    const token = crypto.randomBytes(20).toString('hex');

    //Check if can send email
    const { data: canSend, error: canSendError } = await database
      .rpc('can_send_email', {
        param_user_id: newUser.id,
        param_email_type: 'verify_account_email',
        param_email: trimmedEmail,
      });

    if (canSendError) {
      console.log('Error checking email send capability:', canSendError);
      throw new Error(canSendError.message);
    };

    if (canSend !== true) {
      return res.status(400).json({ message: 'Email limit reached or cooldown active' });
    };

    // Set token expiration time
    const expires_at: Date = new Date();
    expires_at.setHours(expires_at.getHours() + 1); // Token expires in 1 hour

    // Hash the token before storing
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    // Store the token before sending the email: a send failure after this is recoverable
    // (resend through verifyEmail), a send that goes out before the token exists is not
    const { data: tokenData, error: tokenError } = await database
      .from('tokens')
      .insert({
        token: hashedToken,
        token_type: 'verify_account_email',
        expires_at,
      })
      .select('id')
      .single<{id: number}>()

    if (tokenError) {
      console.log('Error storing verification token during signup:', tokenError);
      throw new Error(tokenError.message);
    };

    if (!tokenData) {
      console.log('Token data is null after insertion');
      throw new Error('Token data is null after insertion');
    };

    const { error: userTokenError } = await database
      .from('users_tokens')
      .insert({ user_id: newUser.id, token_id: tokenData.id });

    if (userTokenError) {
      console.log('Error linking verification token to user:', userTokenError);
      throw new Error(userTokenError.message);
    };

    // Send verification email
    const isSent = await sendVerificationEmail(trimmedEmail, token);
    if (!isSent)
      return res.status(400).json({ message: "Message is not sent (Error in signup controller)" });

    return res.status( 200 ).json( { success: true, message: 'User signed up successfully. Please verify your email address.' } );
  } catch (error: unknown) {
    return handleControllerError(res, error, "signup controller");
  };
};

// +998 followed by 9 digits - the frontend normalizes spaces/dashes out before sending, but this
// is the actual boundary, so it checks again rather than trusting that
const isValidUzPhone = (value: string): boolean => /^\+998\d{9}$/.test(value);

// students created this way have no real inbox of their own - "humoyun@magi.com" rather than
// something they'd need to own - so a collision just means trying the next suffix
const uniqueLogin = async (firstName: string): Promise<string> => {
  const base = firstName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'student';
  for (let suffix = 0; suffix < 50; suffix++) {
    const candidate = `${base}${suffix || ''}@magi.com`;
    const { data, error } = await database.from('users').select('email').eq('email', candidate).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return candidate;
  };
  return `${base}${crypto.randomInt(1000, 9999)}@magi.com`;
};

// a random 5-digit code for the given role table/column - not the users.id primary key, which is
// never meant to be shown to anyone. For students this also ends up on proctoring photos.
const uniqueRoleCode = async (table: 'students' | 'professors', column: 'student_code' | 'professor_code'): Promise<string> => {
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = String(crypto.randomInt(0, 100_000)).padStart(5, '0');
    const { data, error } = await database.from(table).select(column).eq(column, candidate).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return candidate;
  };
  throw new Error(`Could not generate a unique ${column}`);
};

// a professor creating a student directly: no email to verify, login and password are both
// generated, and a recoverable copy of the password is kept so the professor can look it up if
// the student forgets it - the account is active immediately either way
export const createStudent = async (req: Request, res: Response) => {
  try {
    const { firstName, lastName, phone, parentPhone, parentRelation }:
      { firstName: s, lastName: s | null, phone?: s, parentPhone?: s, parentRelation?: s } = req.body;

    if (!firstName) return res.status(400).json({
      success: false,
      message: 'firstName is required',
    });

    const trimmedFirstName = firstName.trim();
    const trimmedLastName = lastName ? lastName.trim() : null;
    const trimmedPhone = phone?.trim() || null;
    const trimmedParentPhone = parentPhone?.trim() || null;

    if (trimmedPhone && !isValidUzPhone(trimmedPhone)) return res.status(400).json({
      success: false,
      message: 'Phone must be in the format +998XXXXXXXXX',
    });
    if (trimmedParentPhone && !isValidUzPhone(trimmedParentPhone)) return res.status(400).json({
      success: false,
      message: 'Parent phone must be in the format +998XXXXXXXXX',
    });
    if (trimmedPhone && trimmedParentPhone && trimmedPhone === trimmedParentPhone) return res.status(400).json({
      success: false,
      message: 'The student and parent phone numbers cannot be the same',
    });

    const email = await uniqueLogin(trimmedFirstName);
    const studentCode = await uniqueRoleCode('students', 'student_code');
    const generatedPassword = crypto.randomBytes(6).toString('base64url');
    const hashedPassword = await bcrypt.hash(generatedPassword, 10);

    const { data: newUser, error: newUserError } = await database
      .from('users')
      .insert([{
        first_name: trimmedFirstName,
        last_name: trimmedLastName,
        email,
        password: hashedPassword,
        is_verified: true,
        active_status: 'active',
      }])
      .select('id, email, first_name, last_name')
      .single<InsertedUser>();

    if (newUserError) throw new Error(newUserError.message);
    if (!newUser) throw new Error('New user data is null after insertion');

    const { error: roleError } = await database.from('students').insert({
      user_id: newUser.id,
      student_code: studentCode,
      recovery_secret: encryptSecret(generatedPassword),
      created_by: req.user!.id,
      phone: trimmedPhone,
      parent_phone: trimmedParentPhone,
      parent_relation: parentRelation?.trim() || null,
    });
    if (roleError) throw new Error(roleError.message);

    return res.status(201).json({
      success: true,
      student: { id: newUser.id, first_name: newUser.first_name, last_name: newUser.last_name, email: newUser.email },
      student_code: studentCode,
      password: generatedPassword,
    });
  } catch (error: unknown) {
    return handleControllerError(res, error, "createStudent controller");
  };
};

// every student this professor created directly, newest first - shows up here even before being
// linked to a module, which listing module rosters alone would miss
export const listCreatedStudents = async (req: Request, res: Response) => {
  try {
    const { data: rows, error } = await database
      .from('students')
      .select('user_id, student_code, phone, parent_phone, parent_relation, profile_photo_url')
      .eq('created_by', req.user!.id)
      .order('user_id', { ascending: false });

    if (error) throw new Error(error.message);
    if (!rows?.length) return res.status(200).json({ success: true, students: [] });

    const { data: users, error: usersError } = await database
      .from('users')
      .select('id, first_name, last_name, email')
      .in('id', rows.map((row) => row.user_id));

    if (usersError) throw new Error(usersError.message);

    const userById = new Map((users ?? []).map((u) => [u.id, u]));
    const students = rows
      .map((row) => {
        const user = userById.get(row.user_id);
        if (!user) return null;
        return {
          ...user,
          student_code: row.student_code,
          phone: row.phone,
          parent_phone: row.parent_phone,
          parent_relation: row.parent_relation,
          profile_photo_url: row.profile_photo_url,
        };
      })
      .filter((s) => s !== null);

    return res.status(200).json({ success: true, students });
  } catch (error: unknown) {
    return handleControllerError(res, error, "listCreatedStudents controller");
  };
};

// a professor looking up a student's credentials because they forgot them - only works for
// accounts created through createStudent above; self-signup accounts have no recovery_secret
export const getStudentCredentials = async (req: Request, res: Response) => {
  try {
    const studentId = Number(req.params.id);
    if (!Number.isInteger(studentId)) return res.status(400).json({ success: false, message: 'Invalid student id' });

    const { data: user, error: userError } = await database
      .from('users')
      .select('email')
      .eq('id', studentId)
      .maybeSingle<{ email: string }>();
    if (userError) throw new Error(userError.message);
    if (!user) return res.status(404).json({ success: false, message: 'Student not found' });

    const { data: student, error: studentError } = await database
      .from('students')
      .select('student_code, recovery_secret')
      .eq('user_id', studentId)
      .maybeSingle<{ student_code: string | null; recovery_secret: string | null }>();
    if (studentError) throw new Error(studentError.message);
    if (!student?.recovery_secret) return res.status(404).json({
      success: false,
      message: 'No recoverable credentials for this account (it was not created by a professor)',
    });

    return res.status(200).json({
      success: true,
      email: user.email,
      student_code: student.student_code,
      password: decryptSecret(student.recovery_secret),
    });
  } catch (error: unknown) {
    return handleControllerError(res, error, "getStudentCredentials controller");
  };
};

// mirrors createStudent above, for a professor creating another professor directly
export const createProfessor = async (req: Request, res: Response) => {
  try {
    const { firstName, lastName, phone }: { firstName: s, lastName: s | null, phone?: s } = req.body;

    if (!firstName) return res.status(400).json({
      success: false,
      message: 'firstName is required',
    });

    const trimmedFirstName = firstName.trim();
    const trimmedLastName = lastName ? lastName.trim() : null;
    const trimmedPhone = phone?.trim() || null;

    if (trimmedPhone && !isValidUzPhone(trimmedPhone)) return res.status(400).json({
      success: false,
      message: 'Phone must be in the format +998XXXXXXXXX',
    });

    const email = await uniqueLogin(trimmedFirstName);
    const professorCode = await uniqueRoleCode('professors', 'professor_code');
    const generatedPassword = crypto.randomBytes(6).toString('base64url');
    const hashedPassword = await bcrypt.hash(generatedPassword, 10);

    const { data: newUser, error: newUserError } = await database
      .from('users')
      .insert([{
        first_name: trimmedFirstName,
        last_name: trimmedLastName,
        email,
        password: hashedPassword,
        is_verified: true,
        active_status: 'active',
      }])
      .select('id, email, first_name, last_name')
      .single<InsertedUser>();

    if (newUserError) throw new Error(newUserError.message);
    if (!newUser) throw new Error('New user data is null after insertion');

    const { error: roleError } = await database.from('professors').insert({
      user_id: newUser.id,
      professor_code: professorCode,
      recovery_secret: encryptSecret(generatedPassword),
      created_by: req.user!.id,
      phone: trimmedPhone,
    });
    if (roleError) throw new Error(roleError.message);

    return res.status(201).json({
      success: true,
      professor: { id: newUser.id, first_name: newUser.first_name, last_name: newUser.last_name, email: newUser.email },
      professor_code: professorCode,
      password: generatedPassword,
    });
  } catch (error: unknown) {
    return handleControllerError(res, error, "createProfessor controller");
  };
};

// every professor this professor created directly, newest first
export const listCreatedProfessors = async (req: Request, res: Response) => {
  try {
    const { data: rows, error } = await database
      .from('professors')
      .select('user_id, professor_code, phone')
      .eq('created_by', req.user!.id)
      .order('user_id', { ascending: false });

    if (error) throw new Error(error.message);
    if (!rows?.length) return res.status(200).json({ success: true, professors: [] });

    const { data: users, error: usersError } = await database
      .from('users')
      .select('id, first_name, last_name, email')
      .in('id', rows.map((row) => row.user_id));

    if (usersError) throw new Error(usersError.message);

    const userById = new Map((users ?? []).map((u) => [u.id, u]));
    const professors = rows
      .map((row) => {
        const user = userById.get(row.user_id);
        if (!user) return null;
        return { ...user, professor_code: row.professor_code, phone: row.phone };
      })
      .filter((p) => p !== null);

    return res.status(200).json({ success: true, professors });
  } catch (error: unknown) {
    return handleControllerError(res, error, "listCreatedProfessors controller");
  };
};

// a professor looking up another professor's credentials because they forgot them - only works
// for accounts created through createProfessor above
export const getProfessorCredentials = async (req: Request, res: Response) => {
  try {
    const professorId = Number(req.params.id);
    if (!Number.isInteger(professorId)) return res.status(400).json({ success: false, message: 'Invalid professor id' });

    const { data: user, error: userError } = await database
      .from('users')
      .select('email')
      .eq('id', professorId)
      .maybeSingle<{ email: string }>();
    if (userError) throw new Error(userError.message);
    if (!user) return res.status(404).json({ success: false, message: 'Professor not found' });

    const { data: professor, error: professorError } = await database
      .from('professors')
      .select('professor_code, recovery_secret')
      .eq('user_id', professorId)
      .maybeSingle<{ professor_code: string | null; recovery_secret: string | null }>();
    if (professorError) throw new Error(professorError.message);
    if (!professor?.recovery_secret) return res.status(404).json({
      success: false,
      message: 'No recoverable credentials for this account (it was not created by a professor)',
    });

    return res.status(200).json({
      success: true,
      email: user.email,
      professor_code: professor.professor_code,
      password: decryptSecret(professor.recovery_secret),
    });
  } catch (error: unknown) {
    return handleControllerError(res, error, "getProfessorCredentials controller");
  };
};

// a logged-in user changing their own password - any role
export const changePassword = async (req: Request, res: Response) => {
  try {
    const { currentPassword, newPassword }: { currentPassword: s, newPassword: s } = req.body;

    if (!currentPassword || !newPassword) return res.status(400).json({
      success: false,
      message: 'currentPassword and newPassword are required',
    });
    if (newPassword.toString().length < 6) return res.status(400).json({
      success: false,
      message: 'New password must be at least 6 characters long',
    });

    const { data: user, error } = await database
      .from('users')
      .select('password')
      .eq('id', req.user!.id)
      .maybeSingle<{ password: string }>();
    if (error) throw new Error(error.message);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const matches = await bcrypt.compare(currentPassword, user.password);
    if (!matches) return res.status(400).json({ success: false, message: 'Current password is incorrect' });

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const { error: updateError } = await database.from('users').update({ password: hashedPassword }).eq('id', req.user!.id);
    if (updateError) throw new Error(updateError.message);

    // the password just changed, so any recovery_secret a professor had on file is now stale -
    // only accounts createStudent/createProfessor made have one, this is a no-op otherwise
    await database.from('students').update({ recovery_secret: null }).eq('user_id', req.user!.id);
    await database.from('professors').update({ recovery_secret: null }).eq('user_id', req.user!.id);

    return res.status(200).json({ success: true, message: 'Password changed' });
  } catch (error: unknown) {
    return handleControllerError(res, error, "changePassword controller");
  };
};

// the logged-in user's own current password, so the password-change form can pre-fill it
// instead of asking them to recall it - only available for accounts created with a recoverable
// password (same recovery_secret a professor would look up for them, see getStudentCredentials)
export const getMyCurrentPassword = async (req: Request, res: Response) => {
  try {
    const table = req.user!.role === 'student' ? 'students' : 'professors';
    const { data: row, error } = await database
      .from(table)
      .select('recovery_secret')
      .eq('user_id', req.user!.id)
      .maybeSingle<{ recovery_secret: string | null }>();
    if (error) throw new Error(error.message);

    return res.status(200).json({ success: true, password: row?.recovery_secret ? decryptSecret(row.recovery_secret) : null });
  } catch (error: unknown) {
    return handleControllerError(res, error, "getMyCurrentPassword controller");
  };
};

// the logged-in user's own full profile - role-specific fields (phone, student_code, the
// reference photo) layer on top of the base user record for students
export const getMyProfile = async (req: Request, res: Response) => {
  try {
    const { data: user, error } = await database
      .from('users')
      .select('id, first_name, last_name, email')
      .eq('id', req.user!.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (req.user!.role === 'student') {
      const { data: student, error: studentError } = await database
        .from('students')
        .select('student_code, phone, parent_phone, parent_relation, profile_photo_url')
        .eq('user_id', req.user!.id)
        .maybeSingle();
      if (studentError) throw new Error(studentError.message);
      return res.status(200).json({ success: true, profile: { ...user, ...student } });
    }

    return res.status(200).json({ success: true, profile: user });
  } catch (error: unknown) {
    return handleControllerError(res, error, "getMyProfile controller");
  };
};

// a student setting their own reference photo - gives staff something to compare the
// identity_check photo taken during an exam against
export const setMyProfilePhoto = async (req: Request, res: Response) => {
  try {
    const { data: existing, error: fetchError } = await database
      .from('students')
      .select('profile_photo_url')
      .eq('user_id', req.user!.id)
      .single();
    if (fetchError) throw new Error(fetchError.message);
    if (existing?.profile_photo_url) throw new HttpError(409, 'A reference photo is already set and cannot be retaken.');

    const { bytes } = decodeImageData(req.body?.image);
    if (!(await hasFace(bytes))) throw new HttpError(400, 'invalid photo: no face detected');

    const url = await uploadProfilePhoto(req.user!.id, req.body?.image);
    const { error } = await database.from('students').update({ profile_photo_url: url }).eq('user_id', req.user!.id);
    if (error) throw new Error(error.message);
    return res.status(200).json({ success: true, profile_photo_url: url });
  } catch (error: unknown) {
    return handleControllerError(res, error, "setMyProfilePhoto controller");
  };
};

//logout
export const logout = async (req: Request, res: Response) => {
  try {
    const token = req.cookies.jwt;

    // revoke the session row so protectRoute refuses this cookie even if it leaks or lingers in a browser
    if (token) {
      const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
      const { error: revokeError } = await database
        .from('tokens')
        .update({ revoked: true })
        .eq('token', hashedToken)
        .eq('token_type', 'cookie_token_login');

      if (revokeError) console.log('Error revoking session token during logout:', revokeError.message);
    };

    const isProduction = process.env.NODE_ENV === 'production';
    res.clearCookie("jwt", {
      httpOnly: true,
      sameSite: isProduction ? "none" : "lax",
      secure: isProduction ? true : false,
      path: "/",
    });
    return res.status(200).json({ success: true, message: "Logged out successfully" });
  } catch (error: unknown) {
    return handleControllerError(res, error, "logout controller");
  };
};

//verify account
export const verifyAccount = async ( req: Request, res: Response ) => {
  try {
    const {token} = req.params as { token: s };
    if (!token) return res.status(400).json({ success: false, message: "Token is required" });
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    
    const { data: tokenRecord, error: tokenError } = await database
      .from('tokens')
      .select('id, token_type, revoked, expires_at')
      .eq('token', hashedToken)
      .eq('token_type', 'verify_account_email')
      .maybeSingle<{id: number, token_type: string, revoked: boolean, expires_at: Date}>();

    if (tokenError) {
      console.log('Error fetching token record:', tokenError);
      throw new Error(tokenError.message);
    };
    // If no token record found
    if (!tokenRecord) {
      return res.status(400).json({ success: false, message: "Invalid or expired token" });
    }
    if(tokenRecord && tokenRecord.revoked === true) return res.status(400).json({ success: false, message: "Invalid token" });
   
    const { data: userToken, error: userTokenError } = await database
      .from('users_tokens')
      .select('user_id')
      .eq('token_id', tokenRecord.id)
      .maybeSingle<{user_id: number}>();

    if (userTokenError) {
      console.log('Error fetching user ID for token:', userTokenError);
      throw new Error(userTokenError.message);
    }

    if (!userToken) {
      return res.status(400).json({ success: false, message: "Invalid token" });
    }

    // Check if token has expired
    const expiresAt = new Date(tokenRecord.expires_at);
    const now = new Date();
    if (now >= expiresAt) return res.status(400).json({ success: false, message: "Token has expired" });
    
    // Update user's is_verified status
    const { data: updatedUser, error: updateError } = await database
      .from('users')
      .update({ is_verified: true, active_status: 'active', updated_at: now })
      .eq('id', userToken.user_id)
      .select('id, email, first_name')
      .single<{id: number, email: string, first_name: string}>();
    if (updateError) {
      console.log('Error updating user verification status:', updateError);
      throw new Error(updateError.message);
    };

    if (!updatedUser) {
      console.log('User not found after verification update for user_id:', userToken.user_id);
      throw new Error('User verification failed: user record not found.');
    };

    // Accounts created before roles were stored at signup have no role yet, default them to student
    const { data: existingRole, error: existingRoleError } = await database
      .rpc('get_user_role', { param_user_id: updatedUser.id });

    if (existingRoleError) {
      console.log('Error checking role of verified user:', existingRoleError);
      throw new Error(existingRoleError.message);
    };

    if (!existingRole) {
      const { error: insertStudentRoleError } = await database
        .from('students')
        .insert([{
          user_id: updatedUser.id
        }]);

      if (insertStudentRoleError) {
        console.log('Error assigning student role to new user:', insertStudentRoleError);
        throw new Error(insertStudentRoleError.message);
      };
    };
    

    // Revoke the used token
    await database
      .from('tokens')
      .update({ revoked: true, updated_at: now, expires_at: now })
      .eq('token', hashedToken)
      .eq('token_type', 'verify_account_email');
    
    // Send welcome email
    const isSent = await sendWelcomeEmail(updatedUser.email);
    if (!isSent) {
      console.log("Welcome email not sent");
      throw new Error("Welcome email not sent");
    };

    return res.status(200).json({ success: true, message: "Account verified successfully" });
  } catch (error: unknown) {
    return handleControllerError(res, error, "verifyAccount controller");
  }
};

//verify email
export const verifyEmail = async ( req: Request, res: Response) => {
  try {
    const { email }= req.body;

    //Validate email
    if (!email) return res.status(400).json({ success: false, message: "Email is required" });
    const trimmedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      console.log("Invalid email format");
      throw new Error("Invalid email format");
    };

    //Check if user exists
    const { data: user, error: userError } = await database
      .from('users')
      .select('id, is_verified, active_status, deleted_at')
      .eq('email', trimmedEmail)
      .maybeSingle<{id: number, is_verified: boolean, active_status: string, deleted_at: Date}>();

    if (userError) {
      console.log('Error fetching user for email verification:', userError);
      throw new Error(userError.message);
    };
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    if (user.is_verified) return res.status(400).json({ success: false, message: "Email is already verified" });
    if (user.deleted_at || user.active_status !== 'pending') return res.status(400).json({ success: false, message: `Account is ${user.active_status}. Please contact support.` });

    const {data: canSend, error: canSendError } = await database
      .rpc('can_send_email', {
        param_user_id: user.id,
        param_email_type: 'verify_account_email',
        param_email: trimmedEmail,
      });
    if (canSendError) {
      console.log('Error checking email send capability:', canSendError);
      throw new Error(canSendError.message);
    };

    if (canSend === true) {
      // Generate email verification token
      const token = crypto.randomBytes(20).toString('hex'); 
      const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

      // Set token expiration time
      const expires: Date = new Date();
      expires.setHours(expires.getHours() + 1); // Token expires in 1 hour

      const { data: sendToken, error: sendTokenError } = await database
        .from('tokens')
        .insert({
          token: hashedToken,
          token_type: 'verify_account_email',
          expires_at: expires,
        })
        .select()
        .single<{id: number}>();

      if (sendTokenError) {
        console.log('Error storing verification token:', sendTokenError);
        throw new Error(sendTokenError.message);
      };

      const { error: userTokenError } = await database
        .from('users_tokens')
        .insert({ user_id: user.id, token_id: sendToken.id });

      if (userTokenError) {
        console.log('Error linking token to user:', userTokenError);
        throw new Error(userTokenError.message);
      };

      // Send verification email (token is already stored, so a send failure here is recoverable)
      const isSent = await sendVerificationEmail(trimmedEmail, token);
      if (!isSent) {
        console.log("Verification email not sent");
        return res.status(400).json({ success: false, message: "Message is not sent (Error in verifyEmail controller)" });
      };

      return res.status(200).json({ success: true, message: "Verification email sent successfully" });
    } else {
      //Email cannot be sent due to limits
      return  res.status(400).json({ success: false, message: 'Email limit reached or cooldown active' });
    };
  } catch (error: unknown) {
    return handleControllerError(res, error, "verifyEmail controller") 
  };
};

//forgot password
export const forgotPassword = async ( req: Request, res: Response ) => {
  
  try {
    const { email } : { email: s } = req.body;
    // Basic validation
    if(!email) return res.status(400).json({
      success: false,  
      message: 'Email is required' 
    });

    // Trim and normalize inputs
    const trimmedEmail = email.trim().toLowerCase();
    //Check if user exists
    const { data: user, error: userError } = await database
      .from('users')
      .select('id, email, is_verified, active_status, deleted_at')
      .eq('email', trimmedEmail)
      .maybeSingle<{id: number, email: string, is_verified: boolean, active_status: string, deleted_at: string | null}>();
    if (userError) {
      console.log('Error fetching user for password reset:', userError);
      throw new Error(userError.message)
    };
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    if (!user.is_verified) return res.status(403).json({ success: false, message: "Email is not verified" });
    if (user.deleted_at || user.active_status !== 'active') return res.status(403).json({ success: false, message: `Account is ${user.active_status}. Please contact support.` });

    //Check if can send email
    const {data: canSend, error: canSendError } = await database
      .rpc('can_send_email', {
        param_user_id: user.id,
        param_email_type: 'reset_password_account_email',
        param_email: trimmedEmail,
      });
    if (canSendError) {
      console.log('Error checking email send capability:', canSendError);
      throw new Error(canSendError.message);
    };

    if (canSend === true) {

      // Generate password reset token
      const token = crypto.randomBytes(20).toString('hex'); 
      const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

      // Set token expiration time
      const expires_at: Date = new Date();
      expires_at.setHours(expires_at.getHours() + 1); // Token expires in 1 hour

      // Store the token in the database
      const { data: storedToken, error: sendTokenError } = await database
        .from('tokens')
        .insert({
          token: hashedToken,
          token_type: 'update_account_password',
          expires_at,
          revoked: false,
        })
        .select()
        .single<{id: number}>();

      if (sendTokenError) {
        console.log('Error storing password reset token:', sendTokenError);
        throw new Error(sendTokenError.message);
      };

      //  Link token to user
      const { error: userTokenError } = await database
        .from('users_tokens')
        .insert({ user_id: user.id, token_id: storedToken.id });

      if (userTokenError) {
        console.log('Error linking token to user:', userTokenError);
        throw new Error(userTokenError.message);
      };

      const resetUrl = `${process.env.CLIENT_URL}/reset-password/${token}`;
      // Send password reset email

      const isSent = await sendPasswordResetEmail(trimmedEmail, resetUrl);

      if (!isSent) {
        console.log("Password reset email not sent");
        return res.status(400).json({ 
          success: false, 
          message: "Message is not sent" 
        });
      };

    } else {
      //Email cannot be sent due to limits
      return  res.status(400).json({ 
        success: false, 
        message: 'Email limit reached or cooldown active' 
      });
    };

    return res.status(200).json({ 
      success: true, 
      message: "Password reset email sent successfully" 
    });
  } catch (error: unknown) {
    return handleControllerError(res, error, "forgotPassword controller");
  }
};

//reset password
export const resetPassword = async ( req: Request, res: Response ) => {
  try {
    const { token } = req.params as { token: s } ;
    const { newPassword } : { newPassword: s } = req.body;

    // Basic validation
    if(!newPassword) return res.status(400).json({
      success: false,  
      message: 'New password is required' 
    });
    if( newPassword.toString().length < 6 ) return res.status(400).json({
      success: false,
      message: 'Password must be at least 6 characters long'
    });
    if(!token) return res.status(400).json({
      success: false,  
      message: 'Token is invalid or expired' 
    });

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const { data: tokenRecord, error: tokenError } = await database
      .from('tokens')
      .select('id, token, expires_at, revoked')
      .eq('token', hashedToken)
      .eq('token_type', 'update_account_password')
      .maybeSingle();
    if (tokenError) {
      console.log('Error fetching password reset token record:', tokenError);
      throw new Error(tokenError.message);
    };

    if (!tokenRecord) {
      return res.status(400).json({ success: false, message: "Invalid or expired token" });
    };
    if(tokenRecord && tokenRecord.revoked === true) return res.status(400).json({ success: false, message: "Invalid token" });
    
    const { data: getUserIdByToken, error: userIdError } = await database
      .from('users_tokens')
      .select('user_id')
      .eq('token_id', tokenRecord.id)
      .maybeSingle();
    
    if (userIdError) {
      console.log('Error fetching user ID by token:', userIdError);
      throw new Error(userIdError.message);
    };
    if (!getUserIdByToken) {
      return res.status(400).json({ success: false, message: "Invalid token" });
    };

    // Check if token has expired
    const expiresAt = new Date(tokenRecord.expires_at);
    const now = new Date();
    if (now >= expiresAt) return res.status(400).json({ success: false, message: "Token has expired" });

    // Hash the new password
    const hashedPassword: string = await bcrypt.hash(newPassword, 10);

    // Update user's password
    const { data: updatedUser, error: updateError } = await database
      .from('users') 
      .update({ password: hashedPassword, updated_at: now })
      .eq('id', getUserIdByToken.user_id)
      .select('email')
      .single<{email: string}>();
    if (updateError) {
      console.log('Error updating user password:', updateError);
      throw new Error(updateError.message);
    };

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Revoke the used token
    await database
      .from('tokens')
      .update({ revoked: true, updated_at: now })
      .eq('token', hashedToken)
      .eq('token_type', 'update_account_password'); 
    
    // Send password reset success email
    const isSent = await sendResetSuccessEmail(updatedUser.email);
    if (!isSent) {
      console.log("Password reset success email not sent");
      throw new Error("Password reset success email not sent");
    };

    return res.status(200).json({ success: true, message: "Password has been reset successfully" });
  } catch (error: unknown) {
    return handleControllerError(res, error, "resetPassword controller");
  };
};

//get user (current logged in user)
export const getUser = async (req: Request, res: Response) => {
	try {
		return res.status(200).json(req.user);
	} catch (error: unknown) {
    return handleControllerError(res, error, "checkAuthStatus controller");
	};
};