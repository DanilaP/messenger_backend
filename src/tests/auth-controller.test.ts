import { Request, Response } from 'express';
import AuthController from '../controllers/auth/controller';
import Helpers from '../helpers/user-helpers';
import User from '../models/user/user';

jest.mock('../models/user/user');
jest.mock('../helpers/user-helpers');

const mockResponse = () => {
    const res = {} as Response;
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    res.cookie = jest.fn().mockReturnValue(res);
    return res;
};

describe('Тестирование метода /auth/registration', () => {
    const req = {
        body: {
            email: 'user__email', 
            password: 'user__password',
            name: 'user__name',
        },
    } as Request;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it(`Метод возвращает объект с информацией о пользователе и сообщение о завершении при корректно переданных данных`, async () => {
        const res = mockResponse();
        
        (User.findOne as jest.Mock).mockResolvedValueOnce(null);
        (Helpers.generateAccessToken as jest.Mock).mockReturnValueOnce('token');
        
        await AuthController.registration(req, res);

        expect(Helpers.generateAccessToken).toHaveBeenCalledTimes(1);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(User).toHaveBeenCalledTimes(1);

        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            user: expect.anything(),
            message: "Регистрация прошла успешно"
        }));
    });

    it(`Метод возвращает 400 статус код и сообщение о завершении, если пользователь уже существует`, async () => {
        const res = mockResponse();
        
        (User.findOne as jest.Mock).mockResolvedValueOnce({ _id: 'some_id' });
        
        await AuthController.registration(req, res);

        expect(Helpers.generateAccessToken).toHaveBeenCalledTimes(0);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            message: "Данный пользователь уже существует"
        }));
    });

});

describe('Тестирование метода /auth/login', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });
    const req = {
        body: {
            email: 'user__email', 
            password: 'user__password'
        },
    } as Request;
    it('Метод возвращает 400 статус код и сообщение об отсутствии пользователя при некорректных данных', async () => {
        const res = mockResponse();

        (User.findOne as jest.Mock).mockResolvedValueOnce(null);

        await AuthController.login(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            message: "Пользователя не существует",
        }));
    })
    it('Метод возвращает 200 статус код и сообщение об успешном входе, при корректно введенных данных', async () => {
        const res = mockResponse();

        (User.findOne as jest.Mock).mockResolvedValueOnce({ password: "user__password" });

        await AuthController.login(req, res);
        
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            message: "Успешный вход",
        }));
    })
    it('Метод возвращает 400 статус код и сообщение о неверном пароле, при неверном пароле', async () => {
        const res = mockResponse();

        (User.findOne as jest.Mock).mockResolvedValueOnce({ password: "user__password__uncorrect" });

        await AuthController.login(req, res);
        
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            message: "Неверный пароль",
        }));
    })
})