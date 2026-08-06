import { Request, Response } from "express";
import { db } from "../../../db";
import { validateOnlyLettersAndNumbersStringValue } from "../../helpers/validation-helpers";
import { ensureUserExists } from "../../models/users/model-helpers";
import { IChatInvitation } from "../../models/chats_invitations/chats_invitations";
import { changeBasicChatInfo, checkChatMember, ensureChatExists, getChatInfoById } from "../../models/chats/model-helpers";
import { deleteInvitation, getInvitationInfoById } from "../../models/chats_invitations/model-helpers";
import { getChatMemberPermissions } from "../../helpers/chats-permissions-helpers";
import { addMemberToChat, removeMemberFromChat } from "../../models/chats_members/model-helpers";
import { IChatMessage } from "../../models/chats_messages/chats_messages";
import { insertFilesToChatsFiles } from "../../models/chats_files/chats-files-helpers";
import { broadcastMessage } from "../../websocket/websocket";
import fsHelpers, { IFile } from "../../helpers/fs-helpers";
import moment from "moment";
import userHelpers from "../../helpers/user-helpers";
import dotenv from "dotenv";
dotenv.config();

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
	static async changeChatAvatar(req: Request, res: Response) {
		const client = await db.getClient();

		try {
			await client.query("BEGIN");

			const { chatId } = req.body;
			const userId = userHelpers.getUserIdFromToken(req);
			const userPermissions = await getChatMemberPermissions(userId, chatId);
			
			if (!userPermissions.includes("edit_chat_info")) {
				await client.query("ROLLBACK");

				console.error("Доступ закрыт");
				res.status(403).json({ message: "Доступ закрыт" });
				return;
			}

			//Проверка, что переданный файл - изображение
			if (req.files && fsHelpers.areAllImages(req.files)) {
				//Проверка, что передано не более 1 файла
				if (req.files && Array.isArray(req.files?.files)) {
					await client.query("ROLLBACK");
					res.status(500).json({ message: "Ошибка при изменении информации о чате. Выбрано больше 1 файла" });
					return;
				}
				//Путь к обновленному файлу
				const imagePath = `/chat-files/${chatId}/avatar/`;
				//Получаем информацию о чате
				const chatInfo = await getChatInfoById(chatId);
				//Удаляем файл аватара чата из статики (если путь отличен от базового)
				if (chatInfo.image !== "/files/chat_base_avatar.png") {
					const deletedAvatarInfo = await fsHelpers.removeFiles([chatInfo.image]);
					//Если удаление прошло с ошибкой
					if (deletedAvatarInfo.status === 500) {
						await client.query("ROLLBACK");
						res.status(500).json({ message: "Ошибка при замене файла" });
						return;
					}
				}
				//Сохраняем файл в статику
				const uploadedFileInfo = await fsHelpers.uploadFiles(req.files, imagePath);
				//Если файл сохранить не удалось
				if (uploadedFileInfo.status === 500) {
					await client.query("ROLLBACK");
					res.status(500).json({ message: "Ошибка при сохранении файла" });
					return;
				}
				const uploadedFileUrl = uploadedFileInfo.filelist[0].url;
				//Сохраняем ссылку на обновленный файл в бд
				await db.query(
					`UPDATE chats SET image = $1 WHERE id = $2`,
					[uploadedFileUrl, chatId]
				);

				//Коммитим успешную транзакцию
				await client.query("COMMIT");
				res.status(200).json({ 
					message: "Успешное изменение аватара для чата", 
					updatedFileUrl: `${ process.env.HOST_URL }${uploadedFileUrl}`
				});
				return;
			}
			else {
				await client.query("ROLLBACK");
				res.status(500).json({ message: "Ошибка при изменении информации о чате. Некорректный тип файла" });
				return;
			}
		} 
		catch (error) {
			await client.query("ROLLBACK");

			console.error("Ошибка при изменении информации о чате", error);
			res.status(500).json({ message: "Ошибка при изменении информации о чате" });
			return;
		} 
		finally {
			client.release();
		}
	}
	static async getChats(req: Request, res: Response) {
		try {
			const userId = userHelpers.getUserIdFromToken(req);
			const chatId = Number(req.query.chatId) || null;
			const targetMessageId = Number(req.query.targetMessageId) || null;

			//Получение детальной информации о конкретном чате
			if (chatId) {
				// Общая часть запроса (без CTE, только основной SELECT)
				const baseQuery = `
					SELECT
						cm.id,
						cm.text,
						cm.date,
						cm.is_read AS "isRead",
						json_build_object(
							'id', u.id,
							'name', u."name",
							'surname', u.surname,
							'avatar', u.avatar
						) AS sender,
						COALESCE(
							json_agg(
								json_build_object(
									'name', cf.name,
									'size', cf.size,
									'type', cf.type,
									'url', cf.url
								)
								ORDER BY cf.id
							) FILTER (WHERE cf.id IS NOT NULL),
							'[]'::json
						) AS files
					FROM chats_messages cm
					LEFT JOIN chats_files cf ON cm.id = cf.message_id
					JOIN users u ON cm.sender_id = u.id
					WHERE cm.id IN (SELECT id FROM selected_ids)
					GROUP BY cm.id, u.id
					ORDER BY cm.id
				`;

				let queryText, queryParams;

				if (targetMessageId) {
					// Вариант с целевым сообщением (10 до + 10 после)
					queryText = `
						WITH
						target AS (
							SELECT id, chat_id
							FROM chats_messages
							WHERE id = $1
						),
						previous AS (
							SELECT id
							FROM chats_messages
							WHERE chat_id = (SELECT chat_id FROM target)
							AND id < (SELECT id FROM target)
							ORDER BY id DESC
							LIMIT 10
						),
						next AS (
							SELECT id
							FROM chats_messages
							WHERE chat_id = (SELECT chat_id FROM target)
							AND id > (SELECT id FROM target)
							ORDER BY id ASC
							LIMIT 10
						),
						selected_ids AS (
							SELECT id FROM target
							UNION
							SELECT id FROM previous
							UNION
							SELECT id FROM next
						)
						${baseQuery}
					`;
					queryParams = [targetMessageId];
				} else {
					// Вариант без целевого – последние 10 сообщений чата
					queryText = `
						WITH selected_ids AS (
							SELECT id
							FROM chats_messages
							WHERE chat_id = $1
							ORDER BY id DESC
							LIMIT 10
						)
						${baseQuery}
					`;
					queryParams = [chatId];
				}

				const chatSelectResult = await db.query(queryText, queryParams);
				res.status(200).json({
					message: "Успешное получение информации о чате",
					messages: chatSelectResult.rows
				});
				return;
			}
			//Получение общей информации о чатах
			else {
				const chatsSelectResult = await db.query(
					`
						SELECT
							chats.id,
							chats.name,
							chats.image,
							json_build_object(
								'id', last_msg.id,
								'text', last_msg.text,
								'date', last_msg.date,
								'sender_id', last_msg.sender_id,
								'is_read', last_msg.is_read,
								'reply_message_id', last_msg.reply_message_id
							) AS last_message
						FROM chats
						JOIN chats_members ON chats_members.chat_id = chats.id AND chats_members.user_id = $1
						LEFT JOIN LATERAL (
							SELECT
								id,
								text,
								date,
								sender_id,
								is_read,
								reply_message_id
							FROM chats_messages
							WHERE chat_id = chats.id
							ORDER BY date DESC
							LIMIT 1
						) last_msg ON true
					`,
					[userId]
				);
				res.status(200).json({ message: "Успешное получение информации о чатах", chats: chatsSelectResult.rows });
				return;	
			}
		} 
		catch (error) {
			console.error("Ошибка при получении информации о чатах", error);
			res.status(500).json({ message: "Ошибка при получении информации о чатах" });
			return;
		} 
	}
	static async sendMessage(req: Request, res: Response) {
		const client = await db.getClient();

		try {
			await client.query("BEGIN");
			const userId = userHelpers.getUserIdFromToken(req);
			const files = req.files || null;
			const { chatId, text, replyMessageId } = req.body;

			const message = {
				id: 0,
				text: text || "",
				date: moment(Date.now()).format("DD:MM:YYYY HH:mm:ss"),
				chat_id: Number(chatId),
				sender_id: Number(userId),
				is_read: false,
				files: [] as IFile[],
				repliedMessage: null
			};

			if (chatId && (text || files)) {
				const userChatPermissions = await getChatMemberPermissions(userId, chatId);

				//Если нет разрешения на отправку сообщений в чат
				if (!userChatPermissions.includes("send_messages")) {
					await client.query("ROLLBACK");
					res.status(403).json({ message: "Доступ закрыт" });
					return;
				}

				//Сохраняем сообщение в бд
				const insertResult = await client.query<IChatMessage>(
					`
						INSERT INTO chats_messages (text, date, chat_id, sender_id, is_read, reply_message_id) 
						VALUES ($1, $2, $3, $4, $5, $6) 
						RETURNING id, text, date, chat_id, sender_id, is_read, reply_message_id
					`,
					[
						message.text, 
						message.date, 
						message.chat_id, 
						message.sender_id, 
						message.is_read, 
						Number(replyMessageId) || null
					]
				);

				//Если сообщение не сохранено
				if (!insertResult.rows[0].id) {
					await client.query("ROLLBACK");
					res.status(500).json({ message: "Ошибка при сохранении сообщения" });
					return;
				}
				
				message.id = insertResult.rows[0].id;
				
				if (files) {
					//Сохраняем файлы в статику
					const savedFilesInfo = 
						(await (fsHelpers.uploadFiles(files, `/chat-files/${message.chat_id}/files`))).filelist || [];
					message.files = savedFilesInfo;

					//Сохраняем информацию о файлах в бд
					if (message.files.length > 0) {
						const modifiedFiles = message.files.map(file => { 
							return {
								...file, 
								message_id: message.id
							};
						});
						const createdFiles = await insertFilesToChatsFiles(client, modifiedFiles);
						
						if (createdFiles.length === 0) {
							await client.query("ROLLBACK");
							res.status(500).json({ message: "Ошибка при отправке сообщения. Ошибка при сохранении файлов" });
							return;
						}
	
						message.files = createdFiles;
					}
				}

				let repliedMessageInfo = null;
				const [senderInfo, chatMembersIds] = await Promise.all([
					db.query(
						"SELECT id, name, surname, avatar FROM users WHERE id = $1",
						[userId]
					),
					db.query(
						"SELECT user_id FROM chats_members WHERE chats_members.chat_id = $1",
						[message.chat_id]
					)
				]);

				if (replyMessageId !== null) {
					repliedMessageInfo = await client.query(
						`
							SELECT id, text, sender_id as "senderId" 
							FROM chats_messages 
							WHERE chat_id = $1 AND id = $2 FOR UPDATE
						`,
						[Number(message.chat_id), (Number(replyMessageId) || null)]
					);
					message.repliedMessage = repliedMessageInfo.rows[0];
				}

				broadcastMessage(chatMembersIds.rows.map(el => el.user_id), {
					type: "new_message_dialog",
					dialogId: message.chat_id,
					message: message,
					senderInfo: senderInfo.rows[0]
				});
				
				await client.query("COMMIT");
				res.status(200).json({ message: "Сообщение успешно отправлено" });
				return;
			}

			await client.query("ROLLBACK");
			res.status(400).json({ message: "Сообщение не должно быть пустым" });
			return;
		} 
		catch (error) {
			await client.query("ROLLBACK");

			console.error("Ошибка при отправке сообщения", error);
			res.status(500).json({ message: "Ошибка при отправке сообщения" });
			return;
		} 
		finally {
			client.release();
		}
	}
	static async deleteMessage(req: Request, res: Response) {
		const client = await db.getClient();

		try {
			await client.query("BEGIN");

			const { messagesIds, chatId } = req.body;
			const userId = userHelpers.getUserIdFromToken(req);

			if (messagesIds.length !== 0 && chatId) {
				const userChatPermissions = await getChatMemberPermissions(userId, chatId);

				//Если нет разрешения на удаление сообщений в чате
				if (!userChatPermissions.includes("delete_messages")) {
					await client.query("ROLLBACK");
					res.status(403).json({ message: "Доступ закрыт" });
					return;
				}

				//Удаляем ссылки на файлы статики из бд
				const deletedFilesResult = await client.query(
					`
                        DELETE FROM chats_files
                        WHERE message_id = ANY($1::int[])
                        RETURNING url
                    `,
					[messagesIds]
				);

				//Удаляем статику 
				const deletedFilesUrls = deletedFilesResult.rows.map(row => {
					return row.url;
				});
				const deleteFilesStatus = await fsHelpers.removeFiles(deletedFilesUrls);

				if (deleteFilesStatus.status === 500) {
					await client.query("ROLLBACK");
					res.status(500).json({ 
						message: "Ошибка при удалении сообщений. Ошибка при удалении медиа файлов" 
					});
					return;
				}

				//Удаляем сообщения из бд
				const deletedMessagesResult = await client.query(
					`
                        DELETE FROM chats_messages
                        WHERE chat_id = $1 AND id = ANY($2::int[]) and sender_id = $3
                    `,
					[chatId, messagesIds, userId]
				);

				const deletedCount = deletedMessagesResult.rowCount; 

				if (deletedCount === 0) {
					await client.query("ROLLBACK");
					res.status(500).json({ message: "Ошибка при удалении сообщений. Сообщения или диалог не найдены" });
					return;
				}

				const chatMembersIds = await db.query(
					"SELECT user_id FROM chats_members WHERE chats_members.chat_id = $1",
					[chatId]
				);
				
				broadcastMessage(chatMembersIds.rows.map(el => el.user_id), {
					type: "delete_message_dialog",
					dialogId: chatId,
					deletedMessagesIds: messagesIds
				});

				await client.query("COMMIT");
				res.status(200).json({ message: "Сообщение успешно удалено" });
				return;
			}

			await client.query("ROLLBACK");
			res.status(400).json({ message: "Данные о сообщении не должны быть пустыми" });
			return;
		} 
		catch (error) {
			await client.query("ROLLBACK");

			console.error("Ошибка при удалении сообщения", error);
			res.status(500).json({ message: "Ошибка при удалении сообщения" });
			return;
		} 
		finally {
			client.release();
		}
	}
	static async changeMessage(req: Request, res: Response) {
		const client = await db.getClient();

		try {
			await client.query("BEGIN");
			const { chatId, messageId, text } = req.body;
			const userId = userHelpers.getUserIdFromToken(req);

			const modifiedMessageInfo: { id: number, text: string, files: Partial<IFile>[] } = {
				id: messageId,
				text: text,
				files: []
			};

			if (chatId && messageId) {
				const userChatPermissions = await getChatMemberPermissions(userId, chatId);

				//Если нет разрешения на редактирование сообщений в чате
				if (!userChatPermissions.includes("edit_messages")) {
					await client.query("ROLLBACK");
					res.status(403).json({ message: "Доступ закрыт" });
					return;
				}

				//Если передан изменённый текст
				if (text) {
					const updatedMessage = await client.query(
						`
							UPDATE chats_messages
							SET text = $4
							WHERE chats_messages.sender_id = $1 and chats_messages.chat_id = $2 and chats_messages.id = $3;
						`,
						[userId, chatId, messageId, text]
					);
					//Если изменения не внеслись
					if (updatedMessage.rowCount === 0) {
						await client.query("ROLLBACK");
						res.status(500).json({ 
							message: "Ошибка при изменении сообщения. Ошибка записи данных" 
						});
						return;
					}
				}
				//Если необходимо удалить предыдущие файлы сообщения
				if (req.body.deleteMessageFiles) {
					//Удаляем ссылки на файлы статики из бд
					const deletedFilesResult = await client.query(
						`
							DELETE FROM chats_files
							WHERE message_id = $1
							RETURNING url
						`,
						[messageId]
					);	
					//Удаляем статику 
					const deletedFilesUrls = deletedFilesResult.rows.map(row => {
						return row.url;
					});

					const deleteFilesStatus = await fsHelpers.removeFiles(deletedFilesUrls);
					
					if (deleteFilesStatus.status === 500) {
						await client.query("ROLLBACK");
						res.status(500).json({ 
							message: "Ошибка при удалении сообщений. Ошибка при удалении предыдущих медиа файлов" 
						});
						return;
					}
				}
				//Если передали файлы на замену
				else if (req.files) {
					//Удаляем ссылки на файлы статики из бд
					const deletedFilesResult = await client.query(
						`
							DELETE FROM chats_files
							WHERE message_id = $1
							RETURNING url
						`,
						[messageId]
					);
										
					//Удаляем статику 
					const deletedFilesUrls = deletedFilesResult.rows.map(row => {
						return row.url;
					});
					const deleteFilesStatus = await fsHelpers.removeFiles(deletedFilesUrls);
					
					if (deleteFilesStatus.status === 500) {
						await client.query("ROLLBACK");
						res.status(500).json({ 
							message: "Ошибка при удалении сообщений. Ошибка при удалении предыдущих медиа файлов" 
						});
						return;
					}
					
					//Сохраняем новые файлы в статику
					const uploadedFiles = (await fsHelpers.uploadFiles(req.files, `/chat-files/${chatId}/files`));
					
					modifiedMessageInfo.files = uploadedFiles.filelist;
					
					if (uploadedFiles.status === 500) {
						await client.query("ROLLBACK");
						res.status(500).json({ message: "Ошибка при редактировании сообщения. Ошибка при сохранении файлов в статике" });
						return;
					}
					
					const modifiedFiles = uploadedFiles.filelist.map(file => { 
						return {
							...file, 
							message_id: messageId
						};
					});
					const createdFiles = await insertFilesToChatsFiles(client, modifiedFiles);
										
					if (createdFiles.length === 0) {
						await client.query("ROLLBACK");
						res.status(500).json({ message: "Ошибка при редактировании сообщения. Ошибка при сохранении файлов в базу" });
						return;
					}
				}

				const chatMembersIds = await db.query<{ user_id: number }>(
					"SELECT user_id FROM chats_members WHERE chats_members.chat_id = $1",
					[chatId]
				);

				broadcastMessage(chatMembersIds.rows.map(el => el.user_id), {
					type: "change_message_dialog",
					dialogId: chatId,
					message: modifiedMessageInfo
				});

				await client.query("COMMIT");
				res.status(200).json({ message: "Сообщение успешно изменено", modifiedMessageInfo });
				return;
			}

			await client.query("ROLLBACK");
			res.status(500).json({ message: "Сообщение или чат не найдены" });
		} 
		catch (error) {
			await client.query("ROLLBACK");
			console.error("Ошибка при изменении сообщения", error);
			res.status(500).json({ message: "Ошибка при изменении сообщения" });
		} 
		finally {
			client.release();
		}
	}
	static async readMessagesInCertainChat(req: Request, res: Response) {
		const client = await db.getClient();
		
		try {
			await client.query("BEGIN");

			const { chatId } = req.body;
			const userId = userHelpers.getUserIdFromToken(req);

			if (chatId) {
				
				const [isMember, chatMembersIds] = await Promise.all([
					checkChatMember(chatId, userId),
					db.query<{ user_id: number }>(
						"SELECT user_id FROM chats_members WHERE chats_members.chat_id = $1",
						[chatId]
					)
				]);

				if (isMember) {
					const updatedMessages = await db.query(
						` 
                            UPDATE chats_messages 
                            SET is_read = true 
                            WHERE chat_id = $1 and sender_id <> $2 and is_read <> true
                            RETURNING id as message_id, is_read as isread
                        `,
						[chatId, userId]
					);

					broadcastMessage(chatMembersIds.rows.map(el => el.user_id), {
						type: "read_message_dialog",
						dialogId: chatId,
						readMessages: updatedMessages.rows
					});

					res.status(200).json({ message: "Сообщения успешно прочитаны", readMessages: updatedMessages.rows });
					return;
				}
				else {
					res.status(403).json({ message: "Ошибка при прочтении сообщений. Вы не являетесь участником данного чата" });
					return;
				}
			}

			await client.query("ROLLBACK");
			res.status(400).json({ message: "Чат не найден" });
			return;
		} 
		catch (error) {
			await client.query("ROLLBACK");
			console.error("Ошибка прочтения сообщений:", error);
			res.status(500).json({ message: "Ошибка прочтения сообщений" });
		} 
		finally {
			client.release();
		}
	}
}

export default ChatController;