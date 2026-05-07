interface IBasicPublicationInfo {
    text?: string,
    archived?: boolean
}

export const changeBasicPublicationInfo = async (
    client: any,
    userId: number, 
    publicationId: number, 
    publicationInfo: IBasicPublicationInfo
) => {
    // Разрешенные поля (они же ключи интерфейса)
    const allowedFields: (keyof IBasicPublicationInfo)[] = ["text", "archived"];
    // 1. Отфильтруем только те поля, которые:
    //    - есть в переданном объекте,
    //    - не undefined,
    //    - разрешены.
    const entriesToUpdate = Object.entries(publicationInfo).filter(([key, value]) => {
        return allowedFields.includes(key as keyof IBasicPublicationInfo) && value !== undefined;
    });
    // Нет полей для обновления
    if (entriesToUpdate.length === 0) {
        return { status: 400, message: "Нет допустимых полей для обновления" };
    }
    // 2. Формируем части SQL-запроса динамически
    //    SET "field1" = $3, "field2" = $4, ...
    const setClauses = entriesToUpdate.map((_, idx) => `"${entriesToUpdate[idx][0]}" = $${idx + 3}`);
    const setString = setClauses.join(", ");
    // 3. Значения для параметров: сначала userId ($1), затем значения полей в том же порядке
    const values = [userId, publicationId, ...entriesToUpdate.map(([, value]) => value)];

    try {
        await client.query(
            `
                UPDATE publications
                SET ${setString}
                WHERE user_id = $1 and id = $2
            `,
            values
        );
        return { status: 200, message: "Данные о публикации успешно обновлены" };
    } catch (error) {
        console.error("Ошибка обновления публикации:", error);
        return { status: 500, message: "Ошибка сохранения данных публикации" };
    }
}