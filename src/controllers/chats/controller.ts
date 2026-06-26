import { Request, Response } from "express";
import { db } from "../../../db";
import { validateOnlyLettersAndNumbersStringValue } from "../../helpers/validation-helpers";
import { ensureUserExists } from "../../models/users/model-helpers";
import { IChatInvitation } from "../../models/chats_invitations/chats_invitations";
import { checkChatMember, ensureChatExists } from "../../models/chats/model-helpers";
import moment from "moment";
import fsHelpers from "../../helpers/fs-helpers";
import userHelpers from "../../helpers/user-helpers";

class ChatController {
	static async createChat(req: Request, res: Response) {
		const client = await db.getClient();

		try {
			await client.query("BEGIN");

			const userId = userHelpers.getUserIdFromToken(req);
			const { name, description } = req.body;

			//Проверка наличия обязательных полей
			if (!name || !description) {
				await client.query("ROLLBACK");
				res.status(400).json({ message: "Ошибка создания чата. Информация о чате не должна быть пустой" });
				return;
			}

			//Валидация значений обязательных полей
			if (validateOnlyLettersAndNumbersStringValue(name) && validateOnlyLettersAndNumbersStringValue(description)) {
				await client.query("ROLLBACK");
				res.status(400).json({ message: "Ошибка создания чата. Информация о чате должна соответствовать заданной структуре" });
				return;
			}

			//Проверка, что загружено не более одного файла
			const files = req.files;
			if (files && Array.isArray(files) && files.length > 1) {
				await client.query("ROLLBACK");
				res.status(400).json({ message: "Ошибка создания чата. Должно быть загружено не более 1 файла" });
				return;
			}

			//Создаём запись чата с базовым image
			const defaultImage = "/files/chat_base_avatar.png";
			const creationDate = moment().format("YYYY-MM-DD");

			const insertResult = await client.query(
				`
                    INSERT INTO chats (name, image, description, date_of_creation) 
                    VALUES ($1, $2, $3, $4) 
                    RETURNING id, name, image, description, date_of_creation
                `,
				[name, defaultImage, description, creationDate]
			);

			if (insertResult.rowCount === 0) {
				await client.query("ROLLBACK");
				res.status(500).json({ message: "Ошибка при сохранении информации о чате в базу данных" });
				return;
			}

			const chat = insertResult.rows[0];
			let finalImagePath = defaultImage;

			//Если передали файл - сохраняем его в статику
			if (req.files) {
				const uploadPath = `/chat-files/${chat.id}`;
				const uploadResult = await fsHelpers.uploadFiles(req.files, uploadPath);
				if (uploadResult.filelist && uploadResult.filelist.length > 0) {
					finalImagePath = uploadResult.filelist[0].url;
				}
			}

			//Обновляем запись с корректным путём к изображению (если оно изменилось)
			if (finalImagePath !== defaultImage) {
				await client.query(
					`UPDATE chats SET image = $1 WHERE id = $2`,
					[finalImagePath, chat.id]
				);
				chat.image = finalImagePath;
			}

			//Сохраняем информацию об участниках чата их ролях
			const chatMembersInsertResult = await client.query(
				`
                    INSERT INTO chats_members (chat_id, user_id) 
                    VALUES ($1, $2) 
                `,
				[chat.id, userId]
			);

			if (chatMembersInsertResult.rowCount === 0) {
				await client.query("ROLLBACK");
				res.status(500).json({ message: "Ошибка при сохранении информации об участниках чата" });
				return;
			}

			//Фиксируем транзакцию
			await client.query("COMMIT");

			res.status(200).json({
				message: "Чат успешно создан",
				chatInfo: { ...chat, image: finalImagePath }
			});
		} 
		catch (error) {
			await client.query("ROLLBACK");
			console.error("Ошибка создания чата:", error);
			res.status(500).json({ message: "Ошибка создания чата" });
		} 
		finally {
			client.release();
		}
	}
	static async sendInvitationToChat(req: Request, res: Response) {
		try {
			const { userId, chatId } = req.body;

			//Проверяем, что пользователь и чат существуют и, что данный пользователь - не участник чата
			const [userExists, chatExists, chatMemberExists] = await Promise.all([
				ensureUserExists(userId),
				ensureChatExists(chatId),
				checkChatMember(chatId, userId)
			]);

			if (userExists && chatExists && (chatMemberExists === false)) {
				const result = await db.query<IChatInvitation>(
					`
						INSERT INTO chats_invitations (chat_id, user_id) 
						VALUES ($1, $2) 
						RETURNING id, chat_id, user_id
					`,
					[chatId, userId]
				);

				res.status(200).json({ 
					message: "Успешное создание приглашения",
					invitation: result.rows[0] 
				});
				return;
			}

			res.status(400).json({ message: "Некорректные данные приглашения" });
			return;
		} 
		catch (error) {
			console.error("Ошибка при отправке приглашения в чат", error);
			res.status(500).json({ message: "Ошибка при отправке приглашения в чат" });
			return;
		} 
	}
	static async declineInvitationToChat(req: Request, res: Response) {
		try {
			const userId = userHelpers.getUserIdFromToken(req);
			const invitationId = req.body.invitationId;

			if (userId && invitationId) {
				const deletedFilesResult = await db.query<IChatInvitation>(
					`
						DELETE FROM chats_invitations
						WHERE id = $1 and user_id = $2
						RETURNING id, chat_id, user_id
					`,
					[invitationId, userId]
				);

				if (deletedFilesResult.rowCount !== 0) {
					res.status(200).json({ message: "Успешное отклонение приглашения в чат" });
					return;
				}
				
				res.status(400).json({ message: "Приглашение в чат не найдено" });
				return;
			}
		} 
		catch (error) {
			console.error("Ошибка при отклонении приглашения в чат", error);
			res.status(500).json({ message: "Ошибка при отклонении приглашения в чат" });
			return;
		} 
	}
}

export default ChatController;