import { Request, Response } from "express";
import { IUser } from "../models/users/users";
import { db } from "../../db";
import jwt from "jsonwebtoken";

require('dotenv').config();

async function getUserFromToken(req: Request) {
    try {
        const token = req.cookies.token; 
        const userId = jwt.decode(token);
        const result = await db.query<IUser>(
            `SELECT * FROM users WHERE id = $1`,
            [userId]
        );
        const user = result.rows[0];
        return user;
    } 
    catch (error) {
        console.log(error);
        return null;
    }
}

function generateAccessToken(id: any) {
    const payload = {
        id: id,
    };
    const token = jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: "24h" });
    return token;
}

function setTokenToTheResponse(res: Response, token: string) {
    const responseWithCookies = res;
    responseWithCookies.cookie('token', token, {
        httpOnly: true,
        secure: false,
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'strict'
    });
}

export default { getUserFromToken, generateAccessToken, setTokenToTheResponse };