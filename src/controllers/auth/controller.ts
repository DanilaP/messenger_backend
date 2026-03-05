import { Request, Response } from 'express';
import { validateEmail } from '../../helpers/validation-helpers';
import User from '../../models/user/user';
import helpers from '../../helpers/user-helpers';

class AuthController {
    static async registration(req: Request, res: Response) {
        try {
            const { login, password, name, surname, lastname } = req.body;
            const user = await User.findOne({ login }, { password: 0 });

            if (login && password && name && surname && validateEmail(login)) {
                if (user) {
                    res.status(400).json({ message: "Данный пользователь уже существует" });
                    return;
                }
                else {
                    const user = new User({
                        login,
                        password, 
                        name,
                        surname,
                        lastname: lastname || ""
                    });

                    await user.save();

                    const token = helpers.generateAccessToken(user._id);
                    helpers.setTokenToTheResponse(res, token);
                    
                    res.status(200).json({ message: "Регистрация прошла успешно", user: user });
                    return;
                }
            }
            else {
                res.status(400).json({ message: "Данные, указанные при регистрации, не должны быть пустыми" });
                return;
            }
        }
        catch (error) {
            res.status(500).json({ message: "Ошибка регистрации" });
            console.log(error);
            return;
        }
    }
    static async login(req: Request, res: Response) {
        try {
            const { login, password } = req.body;
            const user = await User.findOne({ login });

            if (!user) {
                res.status(400).json({ message: "Пользователя не существует" });
                return;
            }
            else {
                if (password === user.password) {
                    const token = helpers.generateAccessToken(user._id);
                    helpers.setTokenToTheResponse(res, token);
                    res.status(200).json({ message: "Успешный вход", user });
                    return;
                }
                else {
                    res.status(400).json({ message: "Неверный пароль" });
                    return;
                }
            }
        }
        catch (error) {
            res.status(500).json({ message: "Ошибка входа" });
            console.log(error);
            return;
        }
    }
    static async logout(req: Request, res: Response) {
        try {
            res.clearCookie("token");
            res.status(200).send({ message: "Успешный выход из аккаунта" });
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