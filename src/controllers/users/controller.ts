import { Request, Response } from 'express';
import { db } from '../../../db';
import { IUser } from '../../models/users/users';
import userHelpers from '../../helpers/user-helpers';

class UsersController {
    static async getUserInfo(req: Request, res: Response) {
        try {
            const user = await userHelpers.getUserFromToken(req);
            res.status(200).json({ message: "Успешное получение данных пользователя", user });
            return;
        }
        catch (error) {
            res.status(400).json({ message: "Ошибка получения данных пользователя" });
            console.log(error);
            return;
        }
    }
    static async getUsersList(req: Request, res: Response) {
        try {
            const searchString = req.query.searchString;
            
            let query = 'SELECT id, name, surname, lastname, username, status, avatar FROM users';
            const params: any[] = [];

            if (searchString && typeof searchString === 'string' && searchString.trim() !== '') {
                const searchPattern = `%${ searchString.trim() }%`;
                query += ' WHERE username ILIKE $1';
                params.push(searchPattern);
            }

            const usersList = await db.query<Partial<IUser>>(query, params);

            res.status(200).json({ message: "Успешное получение пользователей", users: usersList.rows });
            return;
        }
        catch (error) {
            res.status(400).json({ message: "Ошибка получения списка пользователей" });
            console.log(error);
            return;
        }
    }
}

export default UsersController;