import { Request, Response } from "express";
import { db } from "../../../db";
import { validateOnlyLettersAndNumbersStringValue } from "../../helpers/validation-helpers";
import { ensureUserExists } from "../../models/users/model-helpers";
import { IChatInvitation } from "../../models/chats_invitations/chats_invitations";
import { changeBasicChatInfo, checkChatMember, ensureChatExists } from "../../models/chats/model-helpers";
import { deleteInvitation, getInvitationInfoById } from "../../models/chats_invitations/model-helpers";
import { getChatMemberPermissions } from "../../helpers/chats-permissions-helpers";
import { addMemberToChat, removeMemberFromChat } from "../../models/chats_members/model-helpers";
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
			const userId = userHelpers.getUserIdFromToken(req);
			const { memberId, chatId } = req.body;
			
			const userPermissions = await getChatMemberPermissions(userId, chatId);

			if (!userPermissions.includes("invite_member")) {
				res.status(403).json({ message: "Отказано в доступе" });
				return;
			}

			//Проверяем, что пользователь и чат существуют и, что данный пользователь - не участник чата
			const [userExists, chatExists, chatMemberExists] = await Promise.all([
				ensureUserExists(memberId),
				ensureChatExists(chatId),
				checkChatMember(chatId, memberId)
			]);

			if (userExists && chatExists && (chatMemberExists === false)) {
				const result = await db.query<IChatInvitation>(
					`
						INSERT INTO chats_invitations (chat_id, user_id) 
						VALUES ($1, $2) 
						RETURNING id, chat_id, user_id
					`,
					[chatId, memberId]
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
				const result = await deleteInvitation(db, invitationId, userId);

				if (result.status === 200) {
					res.status(200).json({ message: "Приглашение в чат успешно отклонено" });
					return;
				}

				res.status(400).json({ message: "Приглашение в чат не найдено или у вас недостаточно прав, чтобы его принять" });
				return;
			}
		} 
		catch (error) {
			console.error("Ошибка при отклонении приглашения в чат", error);
			res.status(500).json({ message: "Ошибка при отклонении приглашения в чат" });
			return;
		} 
	}
	static async acceptInvitationToChat(req: Request, res: Response) {
		const client = await db.getClient();

		try {
			await client.query("BEGIN");

			const userId = userHelpers.getUserIdFromToken(req);
			const invitationId = req.body.invitationId;
			const invitationInfo = (await getInvitationInfoById(invitationId)).invitationInfo;
			
			if (userId && invitationId && invitationInfo) {

				if (userId !== invitationInfo.user_id) {
					res.status(403).json({ message: "Отказано в доступе" });
					return;
				}

				const result = await deleteInvitation(client, invitationId, userId);

				if (result.status === 404 || result.status === 500) {
					await client.query("ROLLBACK");
					console.error("Ошибка при принятии приглашения в чат. Приглашение не найдено");
					res.status(500).json({ message: "Ошибка при принятии приглашения в чат. Приглашение не найдено" });
					return;
				}

				if (result.status === 200) {
					const insertResult = await addMemberToChat(invitationInfo.user_id, invitationInfo.chat_id);

					if (insertResult.status === 200) {
						await client.query("COMMIT");
						res.status(200).json({ message: "Приглашение в чат успешно принято" });
						return;
					}
					
					await client.query("ROLLBACK");
					res.status(insertResult.status).json({ message: "Ошибка при добавлении пользователя в чат" });
					return;
				}
			}
		} 
		catch (error) {
			await client.query("ROLLBACK");

			console.error("Ошибка при принятии приглашения в чат", error);
			res.status(500).json({ message: "Ошибка при принятии приглашения в чат" });
			return;
		} 
		finally {
			client.release();
		}
	}
	static async removeMemberFromChat(req: Request, res: Response) {
		try {
			const chatId = Number(req.query.chatId);
			const memberId = Number(req.query.memberId);
			const userId = userHelpers.getUserIdFromToken(req);
			const permissions = await getChatMemberPermissions(userId, chatId);

			if (permissions.includes("delete_member")) {
				const deletedResult = await removeMemberFromChat(memberId, chatId);
				
				if (deletedResult.status === 200) {
					res.status(200).json({ message: "Успешное удаления участника чата" });
					return;
				}
				
				res.status(400).json({ message: "Участник не найден" });
				return;
			}

			res.status(403).json({ message: "Недостаточно прав" });
			return;
		} 
		catch (error) {
			console.error("Ошибка при удалении участника чата", error);
			res.status(500).json({ message: "Ошибка при удалении участника чата" });
			return;
		} 
	}
	static async changeChatInfo(req: Request, res: Response) {
		try {
			const { chatId } = req.body;
			const userId = userHelpers.getUserIdFromToken(req);
			const userPermissions = await getChatMemberPermissions(userId, chatId);

			if (!userPermissions.includes("edit_chat_info")) {
				console.error("Доступ закрыт");
				res.status(403).json({ message: "Доступ закрыт" });
				return;
			}

			const updateChatInfoStatus = (await changeBasicChatInfo(req.body, chatId)).status;
			
			if (updateChatInfoStatus === 200) {
				res.status(200).json({ message: "Успешное изменение информации о чате" });
				return;
			}

			if (updateChatInfoStatus === 404) {
				res.status(404).json({ message: "Информация о чате не найдена" });
				return;
			}
		} 
		catch (error) {
			console.error("Ошибка при изменении информации о чате", error);
			res.status(500).json({ message: "Ошибка при изменении информации о чате" });
			return;
		} 
	}
}

export default ChatController;