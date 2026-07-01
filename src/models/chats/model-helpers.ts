import { db } from "../../../db";

interface IBasicChatInfo {
	name?: string,
	description?: string
}

export const changeBasicChatInfo = async (updatedFields: IBasicChatInfo, chatId: number) => {
// Разрешенные поля (они же ключи интерфейса)
	const allowedFields: (keyof IBasicChatInfo)[] = ["name", "description"];
	// 1. Отфильтруем только те поля, которые:
	//    - есть в переданном объекте,
	//    - не undefined,
	//    - разрешены.
	const entriesToUpdate = Object.entries(updatedFields).filter(([key, value]) => {
		return allowedFields.includes(key as keyof IBasicChatInfo) && value !== undefined;
	});
	// Нет полей для обновления
	if (entriesToUpdate.length === 0) {
		return { status: 404, message: "Нет допустимых полей для обновления" };
	}
	// 2. Формируем части SQL-запроса динамически
	//    SET "field1" = $3, "field2" = $4, ...
	const setClauses = entriesToUpdate.map((_, idx) => `"${entriesToUpdate[idx][0]}" = $${idx + 2}`);
	const setString = setClauses.join(", ");
	// 3. Значения для параметров: сначала chatId ($1), затем значения полей в том же порядке
	const values = [chatId, ...entriesToUpdate.map(([, value]) => value)];

	await db.query(
		`
			UPDATE chats
			SET ${setString}
			WHERE id = $1
		`,
		values
	);
	return { status: 200, message: "Данные о чате успешно обновлены" };

};

export const ensureChatExists = async (chatId: number) => {
	const chatInfo = await db.query(
		`SELECT * from chats WHERE id = $1`,
		[chatId]
	);
	return chatInfo.rows.length !== 0;
};

export const checkChatMember = async (chatId: number, userId: number) => {
	const memberInfo = await db.query(
		`SELECT * from chats_members WHERE chat_id = $1 and user_Id = $2`,
		[chatId, userId]
	);
	return memberInfo.rows.length !== 0;
};

