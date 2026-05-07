import { Request, Response } from 'express';
import { db } from '../../../db';
import userHelpers from '../../helpers/user-helpers';
import fsHelpers from '../../helpers/fs-helpers';

interface IBasicUserInfo {
    username?: string,
    name?: string,
    surname?: string,
    date_of_birth?: string,
    status?: string,
    avatar?: string
}

const updateBasicUserInfo = async (userId: number, userInfo: IBasicUserInfo) => {
    // Разрешенные поля (они же ключи интерфейса)
    const allowedFields: (keyof IBasicUserInfo)[] = [
        "username", "name", "surname", "date_of_birth", "status", "avatar"
    ];
    // 1. Отфильтруем только те поля, которые:
    //    - есть в переданном объекте,
    //    - не undefined,
    //    - разрешены.
    const entriesToUpdate = Object.entries(userInfo).filter(([key, value]) => {
        return allowedFields.includes(key as keyof IBasicUserInfo) && value !== undefined;
    });

    if (entriesToUpdate.length === 0) {
        // Нет полей для обновления
        return { status: 400, message: "Нет допустимых полей для обновления" };
    }

    // 2. Формируем части SQL-запроса динамически
    //    SET "field1" = $2, "field2" = $3, ...
    const setClauses = entriesToUpdate.map((_, idx) => `"${entriesToUpdate[idx][0]}" = $${idx + 2}`);
    const setString = setClauses.join(", ");

    // 3. Значения для параметров: сначала userId ($1), затем значения полей в том же порядке
    const values = [userId, ...entriesToUpdate.map(([, value]) => value)];

    try {
        await db.query(
            `
                UPDATE users
                SET ${setString}
                WHERE id = $1
            `,
            values
        );
        return { status: 200, message: "Данные успешно обновлены" };
    } catch (error) {
        console.error("Ошибка обновления пользователя:", error);
        return { status: 500, message: "Ошибка сохранения данных пользователя" };
    }
};

class UserProfileController {
    static async getProfile(req: Request, res: Response) {
        try {
            const user = await userHelpers.getUserFromToken(req);
            res.status(200).json({ message: "Успешное получение профиля пользователя", user });
            return;
        }
        catch (error) {
            res.status(500).json({ message: "Ошибка получения информации о профиле пользователя" });
            console.log(error);
            return;
        }
    }
    static async changeUserStatus(req: Request, res: Response) {
        try {
            const userId = userHelpers.getUserIdFromToken(req);
            const { status } = req.body;

            if (typeof status === "string") {
                const updatedUserStatus = await db.query(
                    ` 
                        UPDATE users 
                        SET status = $2 
                        WHERE id = $1
                        RETURNING id as "userId", status
                    `,
                    [userId, status]
                );

                if (updatedUserStatus.rows.length === 0) {
                    res.status(500).json({ message: "Ошибка при сохранении статуса пользователя" });
                    return;
                }   

                res.status(200).json({ message: "Успешное изменение статуса пользователя" });
                return;
            }

            res.status(400).json({ 
                message: "Ошибка при изменении статуса пользователя. Статус может быть только строкой" 
            });
            return;
        }
        catch (error) {
            res.status(500).json({ message: "Ошибка при изменении статуса пользователя" });
            console.log(error);
            return;
        }
    }
    static async changeUserAvatar(req: Request, res: Response) {
        try {
            const user = await userHelpers.getUserFromToken(req);

            if (user) {
                if (req.files && Array.isArray(req.files.files)) {
                    res.status(400).json({ 
                        message: "Ошибка при сохранении аватара пользователя. Должно быть загружено не более 1 файла" 
                    });
                    return;
                }
                if (req.files && !fsHelpers.areAllImages(req.files)) {
                    res.status(400).json({ 
                        message: "Ошибка при сохранении аватара пользователя. Некорректный тип файла" 
                    });
                    return;
                }

                const userAvatarLink = req.files 
                    ? (await fsHelpers.uploadFiles(req.files, `/files`)).filelist[0].url
                    : `${ process.env.HOST_URL }/files/avatar.jpg`;
                
                const updatedUserAvatar = await db.query(
                    ` 
                        UPDATE users 
                        SET avatar = $2 
                        WHERE id = $1
                        RETURNING id as "userId", avatar
                    `,
                    [user?.id, userAvatarLink]
                );

                if (updatedUserAvatar.rows.length === 0) {
                    res.status(500).json({ message: "Ошибка при сохранении аватара пользователя" });
                    return;
                }

                //Удаляем файл предыдущего аватара из статики
                if (process.env.HOST_URL && user.avatar !== `${ process.env.HOST_URL }/files/avatar.jpg`) {
                    await fsHelpers.removeFiles([user?.avatar]);
                }   

                res.status(200).json({ message: "Успешное сохранение аватара пользователя", avatar: userAvatarLink });
                return;
            }

            res.status(400).json({ message: "Ошибка при изменении аватара пользователя. Пользователь не найден" });
            return;
        }
        catch (error) {
            res.status(500).json({ message: "Ошибка при изменении аватара пользователя" });
            console.log(error);
            return;
        }
    }
    static async changeBasicUserInfo(req: Request, res: Response) {
        try {
            const userId = userHelpers.getUserIdFromToken(req);
            const updateUserDataResponse = await updateBasicUserInfo(userId, { ...req.body });
            res.status(updateUserDataResponse.status).json({ message: updateUserDataResponse.message });
            return;
        }
        catch (error) {
            res.status(500).json({ message: "Ошибка смены информации о пользователе" });
            console.log(error);
            return;
        }
    }
}

export default UserProfileController;