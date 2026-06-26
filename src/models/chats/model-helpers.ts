import { db } from "../../../db";

export const ensureChatExists = async (chatId: number) => {
	const chatInfo = await db.query(
		` SELECT * from chats WHERE id = $1`,
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