import { db } from "../../../db";

interface IBasicUserInfo {
    username?: string,
    name?: string,
    surname?: string,
    date_of_birth?: string,
    status?: string,
    avatar?: string
}

export const updateBasicUserInfo = async (userId: number, userInfo: IBasicUserInfo) => {
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