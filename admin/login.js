const { noTryCatch } = require("../functions/notrycatch");
const { connectDB, disconnectDB } = require("../configurations/connectpg");
const { encrypt, matched } = require("../functions/decryptencryptpassword");
const { StatusCodes } = require("http-status-codes");
const { createcode } = require("../functions/createcode");
const { createJWT, decodeJWT } = require("../functions/createJWT");
const customError = require("../functions/customerror");
const { sendmail } = require("../functions/nodemailer");
const { add_query } = require("../crud_query/add");

const loginController = noTryCatch(async (req, res,next) => {
  const role='admin';
  let { username_email, password} = req.body;
  if(!(username_email&&password))
  return next(
    new customError("provide username_email and password", StatusCodes.NOT_FOUND)
  );

  const client = await connectDB();
  let pgres = await client.query(
    `select * from admin_CREDENTIAL where (email=$1 or username=$2) and verified='verified'`,
    [username_email,username_email]
  );

  if (pgres.rows.length == 0)
    return res.json({ msg: "invalid email or username or password or role" });

  const username = pgres.rows[0].username;
  encode_password = await matched(password, pgres.rows[0].password);
  if (encode_password) {
    const access_token = createJWT(
      { username, role },
      { expiresIn: "1 yr" },
      "access"
    );
    const refresh_token = createJWT(
      { username, role },
      { expiresIn: "1 yr" },
      "refresh"
    );
    res.cookie("access_token",access_token)
    res.cookie("refresh_token", refresh_token, { httpOnly: true ,secure:true});
    return res.json({"token":access_token});
  } else {
    return res.json({ msg: "email or password is incorrect" });
  }
});

const registerController = noTryCatch(async (req, res, next) => {
const role='admin';
const {warcode}=req.body;
if(warcode!=='aashishbro')
return next(new customError('Code not accessed',400))
  const {email,password,photo,longitude,latitude,phone_number,about,username}=req.body;
  if(!(email&&password&&username&&longitude&&latitude&&phone_number&&about&&photo))
  return next(new customError('fill out form first',400))

  const client = await connectDB();
  if(password.length<8)
  return next(
    new customError("password must be of 8 character",StatusCodes.NOT_ACCEPTABLE)
  );

  let create_table_query=`CREATE TABLE IF NOT EXISTS admin_CREDENTIAL (
    email VARCHAR(320) NOT NULL unique,
    password VARCHAR(100) NOT NULL CHECK (LENGTH(password) >= 8 AND
                                           password ~ '[A-Z]' AND
                                           password ~ '[0-9]' AND
                                           password ~ '[a-z]' AND
                                           password ~ '[^A-Za-z0-9]'),
    username varchar(100) primary key,
    verified varchar(10) not null default 'pending' check(verified in ('pending','verified')),
    id serial)`;
 
    await client.query(create_table_query);
    await client.query(`create table if not exists admin_PROFILE(
      photo text[] not null,
      longitude numeric,
      latitude numeric,
      phone_number bigint check(phone_number/1000000000=9),
      about text,
      username varchar(100) primary key references admin_CREDENTIAL ON DELETE CASCADE on update cascade,
      id serial
  )`)


  let pgres 
  pgres = await client.query(
    `select * from ${role}_CREDENTIAL where email=$1`,
    [email]
  );

  if (pgres.rows.length != 0)
    return next(
      new customError("Email is already used or send for request", StatusCodes.NOT_FOUND)
    );


  const code = createcode();
  const token = createJWT({...req.body,code}, {
    expiresIn: 60 * 60,
  },"register");
  await sendmail(email, code, next);
  res.cookie("email_token", token, {
    httpOnly: true,
    secure: true,
    maxAge:12000000
  });
  return res.status(StatusCodes.OK).json({ msg: "email is sent" }); //remove code later
});

const emailverifyController = noTryCatch(async (req, res, next) => {
  const token = req.cookies.email_token;
  const { email, username,photo,longitude,latitude,phone_number,about,code,password} = decodeJWT(token,"register");
  if(!req.body.code)
  return  next(
    new customError("code is not provided null", StatusCodes.NOT_FOUND)
  );

  const client = await connectDB();
  const verified='verified';
  if (code == req.body.code) {
    const e_password = await encrypt(password);
    let {query,values}=await add_query({email,username,password:e_password,verified},'admin_credential')
    await client.query(query,values)

    let query_values=await add_query({photo,longitude,latitude,phone_number,about,username},'admin_profile')
      
      await client.query(query_values.query,query_values.values)
      res.clearCookie('email_token')
     return res.status(200).json({ msg: "registered success" });
    }
    else {
    res.json({ msg: "Incorrect OTP code" });
  }
});



const updatePasswordController = noTryCatch(async (req, res) => {

  const {username} = req.body.user
  let { oldPassword, newPassword } = req.body;
  const client = await connectDB();
  const pgres = await client.query(
    `select * from admin_credential where username=$1`,
    [username]
  );
  const oldPasswordEncrypt = pgres.rows[0].password;
  const ispasswordsame = await matched(oldPassword, oldPasswordEncrypt);
  
  if (ispasswordsame) {
    newPassword = await encrypt(newPassword);
    await client.query(
      `update admin_credential set password=$1 where username=$2`,
      [newPassword, username]
    );
    res.status(StatusCodes.OK).json({
      msg: `Password is updated into ${newPassword}`,
    });
  } else {
    return res.json({ msg: "password is incorrect" });
  }
});

//for the forgetting of password
const requestresetpasswordController = noTryCatch(async (req, res, next) => {
const role='admin';  
const { email} = req.body;
  const client = await connectDB();
  let pgres = await client.query(
    `select * from admin_credential where email=$1`,
    [email]
  );

  if (pgres.rows.length == 0)
    return next(
      new customError("Email is not registered", StatusCodes.NOT_FOUND)
    );

  const code = createcode();
  const token = createJWT({ email, code,role},{expiresIn:'1 yr'},'register');
  await sendmail(email, code, next);
  res.cookie("reset_password_token", token, {
    httpOnly: true,
    secure: true,
    maxAge:120000,
    path:'/resetpassword'
  });
  return res.status(StatusCodes.OK).json({"msg":"email has been sent"}); //remove code later
});


const resetpasswordController = noTryCatch(async (req, res) => {
  let { password } = req.body;
  if(req.body.code && req,body.password)
  return next(new customError('some value of req.body is null',400))

  let token=req.cookies.reset_password_token;
  const {code,role,email} = decodeJWT(token);
  if (code == req.body.code) {
    const newPassword = await encrypt(password);
    const client = await connectDB();
    await client.query(
      `update admin_credential set password=$1 where email=$2`,
      [newPassword, email]
    );
    res.json({ msg: "updated successfully" });
  } else {
    res.json({ msg: "incorrect code" });
  }
});

const approveRequest=noTryCatch(async(req,res,next)=>{
  const {role,username,message,verified}=req.body;

  if(!['admin','vendor','customer'].includes(role))
  return next(new customError('role is invalid',400))

  const client=await connectDB();
  const pgres=await client.query(`select email from ${role}_credential where username=$1`,[username])
  console.log(pgres.rows[0].email)
 const email=pgres.rows[0].email
  if(verified!='verified')
  {
    await sendmail(email,message,next)
  return res.status(200).json({"msg":"message sent"})  
  }
  await client.query(`update  ${role}_credential set verified=$2 where username=$1`,[username,verified])
  await sendmail(email,'you are verified as a '+role,next)
  return res.status(200).json({"msg":"role is changed"})
})



module.exports = {
  registerController,
  emailverifyController,
  loginController,
  updatePasswordController,
  requestresetpasswordController,
  resetpasswordController,approveRequest
};
