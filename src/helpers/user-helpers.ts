import { Request, Response } from "express";
import { IUser } from "../models/users/users";
import { db } from "../../db";
import jwt, { JwtPayload } from "jsonwebtoken";

require('dotenv').config();

async function getUserFromToken(req: Request) {
    try {
        const token = req.cookies.token; 
        const payload = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;
        const userId = payload.id;
        const result = await db.query<IUser>(
            `SELECT 
                id, 
                name, 
                surname, 
                lastname,
                username,
                date_of_birth, 
                status, 
                avatar 
            FROM users WHERE id = $1`,
            [userId]
        );
        const user = result.rows[0];
        user.avatar = `${ process.env.HOST_URL }${user.avatar}`;
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

function getUserIdFromToken(req: Request) {
    const payload = jwt.verify(req.cookies?.token, process.env.JWT_SECRET!) as JwtPayload;
    const userId = payload.id;
    return userId;
}

export default { 
    getUserFromToken, 
    generateAccessToken, 
    setTokenToTheResponse,
    getUserIdFromToken
};