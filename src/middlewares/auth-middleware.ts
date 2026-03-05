import { NextFunction, Request, Response } from "express";

const AuthMiddleware = (req: Request, res: Response, next: NextFunction) => {

    if (req.path.includes("auth/login") || req.path.includes("auth/registration")) {
        return next();
    }
    else {
        const token = req.cookies?.token;
        if (!token) {
            return res.status(401).json({ message: "Требуется авторизация" });
        }
        return next(); 
    }
    
};

export default AuthMiddleware;