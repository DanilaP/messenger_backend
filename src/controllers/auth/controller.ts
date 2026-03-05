import { Request, Response } from 'express';
import { validateEmail } from '../../helpers/validation-helpers';
import { db } from '../../models/db';
import { IUser } from '../../models/users/users';
import bcrypt from 'bcryptjs';

class AuthController {
    static async registration(req: Request, res: Response) {
        try {
            const { login, password, name, surname, lastname } = req.body;

            if (validateEmail(login) && password && name && surname) {
                const saltRounds = 10;
                const hashedPassword = await bcrypt.hash(password, saltRounds);

                try {
                    const result = await db.query<IUser>(
                        `INSERT INTO users (login, password, name, surname, lastname) 
                        VALUES ($1, $2, $3, $4, $5) 
                        RETURNING id, login, name, surname, lastname, status`,
                        [login, hashedPassword, name, surname, lastname]
                    );
                    if (result.rows[0]) {
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
}

export default AuthController;