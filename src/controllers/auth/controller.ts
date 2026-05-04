import { Request, Response } from 'express';
import { validateEmail, validatePassword } from '../../helpers/validation-helpers';
import { db } from '../../../db';
import { IUser } from '../../models/users/users';
import bcrypt from 'bcryptjs';
import userHelpers from '../../helpers/user-helpers';
require('dotenv').config();

class AuthController {
    static async registration(req: Request, res: Response) {
        try {
            const { login, password, name, surname, lastname } = req.body;
            const avatar = `/files/avatar.jpg`;

            if (validateEmail(login) && validatePassword(password) && name && surname) {
                const saltRounds = 10;
                const hashedPassword = await bcrypt.hash(password, saltRounds);

                try {
                    const result = await db.query<IUser>(
                        `INSERT INTO users (login, password, name, surname, lastname, avatar) 
                        VALUES ($1, $2, $3, $4, $5, $6) 
                        RETURNING id, login, name, surname, lastname, status, avatar`,
                        [login, hashedPassword, name, surname, lastname, avatar]
                    );

                    if (result.rows[0]) {
                        const token = userHelpers.generateAccessToken(result.rows[0].id);
                        userHelpers.setTokenToTheResponse(res, token);

                        res.status(200).json({ message: "Успешная регистрация", user: result.rows[0] });
                        return;
                    }
                }
                catch(error: any) {
                    if (error.code === '23505') { 
                        res.status(400).json({ message: 'Пользователь с таким логином уже существует' });
                        return
                    }
                    throw error;
                }
            }

            res.status(400).json({ 
                message: `
                    Ошибка при регистрации. 
                    Данные пользователя не должны быть пустыми и должны соответствовать заданной структуре
                ` 
            });
            return;
        }
        catch (error) {
            res.status(500).json({ message: "Ошибка при регистрации" });
            console.log(error);
            return;
        }
    }
    static async login(req: Request, res: Response) {
        try {
            const { login, password } = req.body;

            if (login && password) {
                const result = await db.query<IUser>(
                    `SELECT id, login, password, name, surname, lastname, status, avatar
                    FROM users
                    WHERE login = $1`,
                    [login]
                );
                const user = result.rows[0];

                if (!user) {
                    res.status(401).json({ message: 'Неверный логин или пароль' });
                    return
                }

                if (user.password) {
                    const isPasswordValid = await bcrypt.compare(password, user.password);

                    if (!isPasswordValid) {
                        res.status(500).json({ message: 'Неверный логин или пароль' });
                        return;
                    }

                    const { password: _, ...userWithoutPassword } = user;

                    const token = userHelpers.generateAccessToken(user.id);
                    userHelpers.setTokenToTheResponse(res, token);

                    res.status(200).json({
                        message: 'Успешный вход',
                        user: userWithoutPassword
                    });
                    return;
                }
            }
            res.status(400).json({ message: "Логин и пароль не должны быть пустыми" });
            return;
        }
        catch (error) {
            res.status(500).json({ message: "Ошибка при входе" });
            console.log(error);
            return;
        }
    }
    static async logout(req: Request, res: Response) {
        try {
            res.clearCookie("token");
            res.status(200).send('Успешный выход из аккаунта');
            return;
        }
        catch (error) {
            console.error(error);
            res.status(500).send('Ошибка выхода из аккаунта');
            return;
        }
    }
}

export default AuthController;